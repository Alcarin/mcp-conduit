import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./core/config.js";
import {
  Config,
  ExecutionLog,
  ExecutionResult,
  GitSnapshot,
  JsonValue,
  PolicyIssue,
  ProviderConfig,
  RunnerResult,
  TaskRequest,
  ToolCallRequest
} from "./core/types.js";
import { renderPrompt } from "./context/bundle.js";
import { postCheck, preCheck } from "./policy/engine.js";
import { checkProviderHealth, ProviderHealthStatus } from "./providers/health.js";
import { resolveProvider } from "./providers/index.js";
import { runInvocation, runShellCommand } from "./runner/spawn.js";
import { makeTaskId } from "./utils/ids.js";
import { toInvocationInfo } from "./providers/base.js";
import { buildRunBasename } from "./audit/names.js";
import { writeAudit } from "./audit/store.js";
import { captureGitSnapshot } from "./utils/git.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
}

const server = new Server(
  {
    name: config.server.name,
    version: config.server.version
  },
  {
    capabilities: {
      tools: {}
    }
  }
);
const providerStatusCache = new Map<string, CachedProviderStatus>();

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const providerStatuses = await getProviderStatuses(config);
  return {
    tools: [
      runTaskToolDefinition(providerStatuses),
      healthToolDefinition()
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments;

  if (toolName === "run_task") {
    const argsValidation = validateTaskRequest(args);
    if (!argsValidation.ok) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid tool arguments: ${argsValidation.errors.join(", ")}`);
    }
    const result = await runTask(argsValidation.value, config);
    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }

  if (toolName === "providers_health") {
    const argsValidation = validateProviderHealthRequest(args);
    if (!argsValidation.ok) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid tool arguments: ${argsValidation.errors.join(", ")}`);
    }
    const result = await runProvidersHealth(argsValidation.value, config);
    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

// --- Helper Functions (Preserved logic) ---

function runTaskToolDefinition(providerStatuses?: ProviderHealthStatus[]) {
  const summary = summarizeProviderStatuses(providerStatuses ?? []);
  const providerProperty: Record<string, JsonValue> = { type: "string" };
  if (summary.available.length > 0) {
    providerProperty.enum = summary.available;
  }

  const descriptionParts = [
    "Run a delegated task using a local LLM CLI with policy enforcement."
  ];
  descriptionParts.push("Use providers_health to refresh cached availability.");
  if (summary.available.length > 0) {
    descriptionParts.push(`Available providers: ${summary.available.join(", ")}.`);
  }
  if (summary.unavailable.length > 0) {
    descriptionParts.push(
      `Unavailable providers: ${summary.unavailable.map((entry) => `${entry.id} (${entry.reason})`).join(", ")}.`
    );
  }

  return {
    name: "run_task",
    description: descriptionParts.join(" "),
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        provider: providerProperty,
        instructions: { type: "string" },
        allowlist: { type: "array", items: { type: "string" } },
        cwd: { type: "string" },
        dryRun: { type: "boolean" },
        env: { type: "object", additionalProperties: { type: "string" } },
        auditEnabled: { type: "boolean" },
        logsEnabled: { type: "boolean" },
        testCommand: { type: "string" }
      },
      required: ["provider", "instructions"]
    },
    // providerStatus: summary // standard MCP tool definition doesn't support extra fields, removing to be safe
  };
}

function healthToolDefinition() {
  return {
    name: "providers_health",
    description: "Run provider health checks and refresh cached availability.",
    inputSchema: {
      type: "object",
      properties: {
        providers: { type: "array", items: { type: "string" } }
      }
    }
  };
}

type ProviderStatusSummary = {
  available: string[];
  unavailable: { id: string; reason: string }[];
};

function summarizeProviderStatuses(providerStatuses: ProviderHealthStatus[]): ProviderStatusSummary {
  const available: string[] = [];
  const unavailable: { id: string; reason: string }[] = [];
  for (const status of providerStatuses) {
    if (status.ok) {
      available.push(status.id);
    } else {
      unavailable.push({ id: status.id, reason: status.reason ?? "unavailable" });
    }
  }
  return { available, unavailable };
}

type ProviderHealthRequest = {
  providers?: string[];
};

async function runProvidersHealth(
  request: ProviderHealthRequest,
  config: Config
): Promise<{ providers: ProviderHealthStatus[] }> {
  const ids = request.providers && request.providers.length > 0
    ? request.providers
    : Object.keys(config.providers);
  const statuses: ProviderHealthStatus[] = [];
  for (const id of ids) {
    const providerConfig = config.providers[id];
    if (!providerConfig) {
      statuses.push({ id, ok: false, reason: "unknown provider" });
      continue;
    }
    const status = await refreshProviderStatus(id, providerConfig);
    statuses.push(status);
  }
  return { providers: statuses };
}

async function runTask(task: TaskRequest, config: Config): Promise<ExecutionResult> {
  const taskId = task.taskId ?? makeTaskId();
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const policyWarnings: string[] = [];
  const policyIssues: PolicyIssue[] = [];
  const emptySnapshot: GitSnapshot = { status: "", diff: "", paths: [] };

  const pre = preCheck(task, config);
  if (!pre.ok) {
    errors.push(...pre.errors);
  }
  policyWarnings.push(...pre.warnings);
  if (pre.issues && pre.issues.length > 0) {
    policyIssues.push(...pre.issues);
  }

  const providerConfig = config.providers[task.provider];
  const provider = resolveProvider(providerConfig);
  if (!provider || !providerConfig) {
    errors.push(`Unknown provider: ${task.provider}`);
  }

  const effectiveCwd = task.cwd ?? providerConfig?.cwd ?? process.cwd();
  const taskForExecution = { ...task, cwd: effectiveCwd };
  const prompt = renderPrompt(taskForExecution, config);
  
  if (!task.dryRun && providerConfig) {
    const cached = getCachedProviderStatus(task.provider);
    if (cached && !cached.ok) {
      errors.push(formatProviderHealthError(task.provider, providerConfig, cached.reason));
    }
  }

  let baseline = emptySnapshot;
  try {
    baseline = await captureGitSnapshot(effectiveCwd, { trackBinaryPaths: config.policy.trackBinaryPaths });
  } catch (err) {
    errors.push((err as Error).message);
  }

  if (errors.length > 0 || !provider || !providerConfig) {
    const failed: ExecutionResult = {
      ok: false,
      taskId,
      provider: task.provider,
      startedAt,
      prompt,
      git: { baseline, post: baseline },
      invocation: { cmd: "", args: [] },
      policyIssues: policyIssues.length > 0 ? policyIssues : undefined,
      policyWarnings,
      errors
    };
    writeAudit(config, taskForExecution, failed);
    return failed;
  }

  const invocation = provider.buildInvocation(taskForExecution, providerConfig, prompt);
  invocation.cwd = effectiveCwd;
  const effectiveEnv = { ...(providerConfig.env ?? {}), ...(task.env ?? {}) };
  if (Object.keys(effectiveEnv).length > 0) {
    invocation.env = effectiveEnv;
  }
  const invocationInfo = toInvocationInfo(invocation);

  let result: ExecutionResult = {
    ok: true,
    taskId,
    provider: task.provider,
    startedAt,
    prompt,
    git: { baseline, post: baseline },
    invocation: invocationInfo,
    policyIssues: policyIssues.length > 0 ? policyIssues : undefined,
    policyWarnings,
    errors: []
  };

  if (task.dryRun) {
    result.result = { logs: ["dryRun enabled: no CLI executed"], raw: "" };
    result.test = {
      command: task.testCommand ?? "",
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 0,
      skipped: true,
      note: "dryRun enabled"
    };
    writeAudit(config, taskForExecution, result);
    return result;
  }

  const timeoutMs = resolveRunnerTimeoutMs(providerConfig, config.runner);
  const timeoutSeconds = Math.ceil(timeoutMs / 1000);
  const testTimeoutMs = Math.max(0, config.runner.timeoutSeconds) * 1000;
  const retryPolicy = resolveRetryPolicy(config.runner.retry);
  const logDir = path.resolve(effectiveCwd, config.logs.dir);
  const executionLog = shouldWriteLogs(config, task)
    ? prepareExecutionLog(
        taskId,
        task.provider,
        effectiveCwd,
        logDir,
        timeoutSeconds,
        retryPolicy.maxAttempts,
        startedAt
      )
    : undefined;
  if (executionLog) {
    result.executionLog = executionLog;
  }

  let finalFailure: RunnerFailure | undefined;
  let attemptsUsed = 0;
  for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
    attemptsUsed = attempt;
    appendExecutionLog(executionLog, `\n## Attempt ${attempt}\n`);
    try {
      const runner = await runInvocation(invocation, timeoutMs, executionLog?.path);
      result.runner = runner;
      result.invocation.exitCode = runner.exitCode;
      result.invocation.durationMs = runner.durationMs;
      result.result = provider.parseResult(runner.stdout, runner.stderr);

      appendExecutionLog(executionLog, formatAttemptSummary(runner));

      const failure = classifyRunnerFailure(runner, providerConfig, task.provider, timeoutSeconds);
      if (!failure) {
        if (attempt > 1) {
          appendExecutionLog(executionLog, `\nSucceeded after ${attempt} attempts.\n`);
        }
        finalFailure = undefined;
        break;
      }

      appendExecutionLog(executionLog, `\n${failure.logMessage}\n`);
      if (!failure.retryable || attempt === retryPolicy.maxAttempts) {
        finalFailure = failure;
        break;
      }
      if (retryPolicy.delayMs > 0) {
        appendExecutionLog(executionLog, `Retrying in ${retryPolicy.delayMs / 1000}s...\n`);
        await sleep(retryPolicy.delayMs);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendExecutionLog(executionLog, `\n[error] ${message}\n`);
      finalFailure = {
        message,
        logMessage: message,
        retryable: false,
        category: "unknown"
      };
      break;
    }
  }

  if (finalFailure) {
    result.ok = false;
    result.errors.push(finalFailure.message);
    const marked = getProviderFailureMark(finalFailure, attemptsUsed, retryPolicy.maxAttempts);
    if (marked) {
      markProviderFailed(task.provider, marked.reason);
      result.errors.push(
        `Provider ${task.provider} marked unavailable. Run providers_health after resolving the issue.`
      );
      appendExecutionLog(executionLog, "Provider marked unavailable.\n");
    }
  }
  const invocationFailed = finalFailure !== undefined;

  try {
    result.git.post = await captureGitSnapshot(effectiveCwd, { trackBinaryPaths: config.policy.trackBinaryPaths });
  } catch (err) {
    result.ok = false;
    result.errors.push((err as Error).message);
  }

  if (task.testCommand) {
    if (!result.runner || invocationFailed) {
      result.test = {
        command: task.testCommand,
        ok: false,
        exitCode: -1,
        stdout: "",
        stderr: "",
        durationMs: 0,
        skipped: true,
        note: "Invocation failed; tests skipped."
      };
    } else {
      try {
        const testRun = await runShellCommand(task.testCommand, effectiveCwd, testTimeoutMs);
        result.test = {
          command: task.testCommand,
          ok: testRun.exitCode === 0,
          exitCode: testRun.exitCode,
          stdout: testRun.stdout,
          stderr: testRun.stderr,
          durationMs: testRun.durationMs
        };
        if (!result.test.ok) {
          result.ok = false;
          result.errors.push(`Tests failed (exit ${testRun.exitCode}).`);
        }
      } catch (err) {
        result.ok = false;
        result.errors.push((err as Error).message);
        result.test = {
          command: task.testCommand,
          ok: false,
          exitCode: -1,
          stdout: "",
          stderr: "",
          durationMs: 0,
          note: "Failed to execute test command."
        };
      }
    }
  } else {
    result.test = {
      command: "",
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 0,
      skipped: true,
      note: "No testCommand provided."
    };
  }

  const post = postCheck(taskForExecution, result, config);
  if (!post.ok) {
    result.ok = false;
    result.errors.push(...post.errors);
  }
  if (post.warnings.length > 0) {
    result.policyWarnings = [...(result.policyWarnings ?? []), ...post.warnings];
  }
  if (post.issues && post.issues.length > 0) {
    policyIssues.push(...post.issues);
  }
  if (policyIssues.length > 0) {
    result.policyIssues = policyIssues;
  }

  writeAudit(config, taskForExecution, result);
  return result;
}

// Validation Helpers (Updated types handled inline in tool handler, but validation logic preserved)

function validateTaskRequest(
  value: unknown
): { ok: true; value: TaskRequest } | { ok: false; errors: string[] } {
  if (!isRecord(value)) {
    return { ok: false, errors: ["arguments must be an object"] };
  }

  const errors: string[] = [];
  if (typeof value.provider !== "string") {
    errors.push("provider must be a string");
  }
  if (typeof value.instructions !== "string") {
    errors.push("instructions must be a string");
  }
  if (value.taskId !== undefined && typeof value.taskId !== "string") {
    errors.push("taskId must be a string");
  }
  if (value.cwd !== undefined && typeof value.cwd !== "string") {
    errors.push("cwd must be a string");
  }
  if (value.dryRun !== undefined && typeof value.dryRun !== "boolean") {
    errors.push("dryRun must be a boolean");
  }
  if (value.allowlist !== undefined && !isStringArray(value.allowlist)) {
    errors.push("allowlist must be an array of strings");
  }
  if (value.env !== undefined && !isStringMap(value.env)) {
    errors.push("env must be an object of string values");
  }
  if (value.auditEnabled !== undefined && typeof value.auditEnabled !== "boolean") {
    errors.push("auditEnabled must be a boolean");
  }
  if (value.logsEnabled !== undefined && typeof value.logsEnabled !== "boolean") {
    errors.push("logsEnabled must be a boolean");
  }
  if (value.testCommand !== undefined && typeof value.testCommand !== "string") {
    errors.push("testCommand must be a string");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const task: TaskRequest = {
    provider: value.provider as string,
    instructions: value.instructions as string
  };
  if (value.taskId !== undefined) {
    task.taskId = value.taskId as string;
  }
  if (value.cwd !== undefined) {
    task.cwd = value.cwd as string;
  }
  if (value.dryRun !== undefined) {
    task.dryRun = value.dryRun as boolean;
  }
  if (value.allowlist !== undefined) {
    task.allowlist = value.allowlist as string[];
  }
  if (value.env !== undefined) {
    task.env = value.env as Record<string, string>;
  }
  if (value.auditEnabled !== undefined) {
    task.auditEnabled = value.auditEnabled as boolean;
  }
  if (value.logsEnabled !== undefined) {
    task.logsEnabled = value.logsEnabled as boolean;
  }
  if (value.testCommand !== undefined) {
    task.testCommand = value.testCommand as string;
  }

  return { ok: true, value: task };
}

function validateProviderHealthRequest(
  value: unknown
): { ok: true; value: ProviderHealthRequest } | { ok: false; errors: string[] } {
  if (!isRecord(value)) {
    return { ok: false, errors: ["arguments must be an object"] };
  }

  const errors: string[] = [];
  if (value.providers !== undefined && !isStringArray(value.providers)) {
    errors.push("providers must be an array of strings");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const request: ProviderHealthRequest = {};
  if (value.providers !== undefined) {
    request.providers = value.providers as string[];
  }

  return { ok: true, value: request };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStringMap(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// isProtocolCompatible - REMOVED (Handled by SDK)

type RunnerFailureCategory = "timeout" | "auth" | "rate_limit" | "exit" | "unknown";

type RunnerFailure = {
  message: string;
  logMessage: string;
  retryable: boolean;
  category: RunnerFailureCategory;
};

type CachedProviderStatus = {
  status: ProviderHealthStatus;
  checkedAt: number;
  source: "health" | "runtime";
};

type ProviderFailureMark = {
  reason: string;
};

function resolveRunnerTimeoutMs(providerConfig: ProviderConfig, runner: Config["runner"]): number {
  if (typeof providerConfig.timeoutMs === "number") {
    return Math.max(0, providerConfig.timeoutMs);
  }
  return Math.max(0, runner.timeoutSeconds) * 1000;
}

function resolveRetryPolicy(retry: Config["runner"]["retry"] | undefined): { maxAttempts: number; delayMs: number } {
  const maxAttempts = retry?.maxAttempts ?? 1;
  const delaySeconds = retry?.delaySeconds ?? 0;
  return {
    maxAttempts: Math.max(1, Math.floor(maxAttempts)),
    delayMs: Math.max(0, delaySeconds) * 1000
  };
}

// Audit helpers
function shouldWriteAudit(config: Config, task: TaskRequest): boolean {
  if (!config.audit.enabled) {
    return false;
  }
  if (task.auditEnabled === false) {
    return false;
  }
  return true;
}

function shouldWriteLogs(config: Config, task: TaskRequest): boolean {
  if (!config.logs.enabled) {
    return false;
  }
  if (task.logsEnabled === false) {
    return false;
  }
  return true;
}

// Provider/Health Helpers

async function getProviderStatuses(config: Config): Promise<ProviderHealthStatus[]> {
  const entries = Object.entries(config.providers);
  const checks = entries.map(([id, providerConfig]) => getProviderStatus(id, providerConfig));
  return Promise.all(checks);
}

async function getProviderStatus(id: string, providerConfig: ProviderConfig): Promise<ProviderHealthStatus> {
  const cached = getCachedProviderStatus(id);
  if (cached) {
    return cached;
  }
  return refreshProviderStatus(id, providerConfig);
}

async function refreshProviderStatus(id: string, providerConfig: ProviderConfig): Promise<ProviderHealthStatus> {
  const status = await checkProviderHealth(id, providerConfig);
  cacheProviderStatus(id, status, "health");
  return status;
}

function getCachedProviderStatus(id: string): ProviderHealthStatus | undefined {
  const cached = providerStatusCache.get(id);
  if (!cached) {
    return undefined;
  }
  return cached.status;
}

function cacheProviderStatus(
  id: string,
  status: ProviderHealthStatus,
  source: CachedProviderStatus["source"]
): void {
  const now = Date.now();
  providerStatusCache.set(id, {
    status,
    checkedAt: now,
    source
  });
}

function markProviderFailed(id: string, reason: string): void {
  cacheProviderStatus(id, { id, ok: false, reason }, "runtime");
}

function getProviderFailureMark(
  failure: RunnerFailure,
  attemptsUsed: number,
  maxAttempts: number
): ProviderFailureMark | undefined {
  switch (failure.category) {
    case "auth":
      return { reason: failure.logMessage };
    case "rate_limit":
      return { reason: failure.logMessage };
    case "timeout":
      if (attemptsUsed > 1 && attemptsUsed >= maxAttempts) {
        return { reason: failure.logMessage };
      }
      return undefined;
    default:
      return undefined;
  }
}

function formatProviderHealthError(
  id: string,
  config: ProviderConfig,
  reason?: string
): string {
  if (reason && looksLikeAuthError(reason)) {
    return `Provider ${id} requires login. Run "${config.binary} login", then run providers_health.`;
  }
  if (reason && reason.trim().length > 0) {
    return `Provider ${id} unavailable: ${reason}. Run providers_health after resolving the issue.`;
  }
  return `Provider ${id} unavailable: health check failed. Run providers_health after resolving the issue.`;
}

function classifyRunnerFailure(
    runner: RunnerResult,
    config: ProviderConfig,
    provider: string,
    timeoutSeconds: number
): RunnerFailure | undefined {
    if (runner.timedOut) {
        return {
            message: `Task timed out after ${timeoutSeconds}s`,
            logMessage: `Alert: Task timed out after ${timeoutSeconds}s`,
            retryable: true,
            category: "timeout"
        };
    }
    if (runner.exitCode !== 0) {
        return {
            message: `Command failed with exit code ${runner.exitCode}`,
            logMessage: `Alert: Command failed with exit code ${runner.exitCode}`,
            retryable: false,
            category: "exit"
        };
    }
    return undefined; // Success
}

function prepareExecutionLog(
  taskId: string,
  providerId: string,
  cwd: string,
  logDir: string,
  timeoutSeconds: number,
  maxAttempts: number,
  startedAt: string
): ExecutionLog | undefined {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, `${buildRunBasename(providerId, taskId, startedAt)}.md`);
    const header = [
      "# Run log",
      `Task: ${taskId}`,
      `Provider: ${providerId}`,
      `Cwd: ${cwd}`,
      `Started: ${startedAt}`,
      `Idle timeout: ${timeoutSeconds}s`,
      `Max attempts: ${maxAttempts}`,
      ""
    ].join("\n");
    fs.writeFileSync(logPath, `${header}\n`, "utf-8");
    return { path: logPath, format: "markdown" };
  } catch {
    return undefined;
  }
}

function appendExecutionLog(log: ExecutionLog | undefined, text: string): void {
  if (!log) {
    return;
  }
  try {
    fs.appendFileSync(log.path, text, "utf-8");
  } catch {
    return;
  }
}

function formatAttemptSummary(runner: RunnerResult): string {
  const lines = [
    `- Exit code: ${runner.exitCode}`,
    `- Duration: ${runner.durationMs}ms`,
    `- Timed out: ${runner.timedOut ? "yes" : "no"}`
  ];
  if (runner.signal) {
    lines.push(`- Signal: ${runner.signal}`);
  }
  return `${lines.join("\n")}\n`;
}

// Exit Helpers
function formatExitDetail(runner: RunnerResult): string {
  if (runner.signal) {
    return `signal ${runner.signal}`;
  }
  return `exit ${runner.exitCode}`;
}

function looksLikeAuthError(text: string): boolean {
  const normalized = text.toLowerCase();
  const hints = [
    "login required",
    "not logged in",
    "please login",
    "please log in",
    "authentication failed",
    "auth check failed",
    "auth failed",
    "unauthorized",
    "token expired",
    "invalid token",
    "access denied"
  ];
  return hints.some((entry) => normalized.includes(entry));
}

function looksLikeRateLimit(text: string): boolean {
  const normalized = text.toLowerCase();
  const hints = [
    "rate limit",
    "too many requests",
    "quota exceeded",
    "exceeded quota",
    "429",
    "throttle"
  ];
  return hints.some((entry) => normalized.includes(entry));
}

async function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
