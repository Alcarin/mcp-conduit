export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface TaskRequest {
  taskId?: string;
  provider: string;
  instructions: string;
  allowlist?: string[];
  cwd?: string;
  dryRun?: boolean;
  env?: Record<string, string>;
  auditEnabled?: boolean;
  logsEnabled?: boolean;
  testCommand?: string;
}

export interface GitSnapshot {
  status: string;
  diff: string;
  paths: string[];
  binaryPaths?: string[];
}

export interface ProviderResult {
  diff?: string;
  logs?: string[];
  tests?: { name: string; ok: boolean; output?: string }[];
  raw?: string;
}

export interface ExecutionResult {
  ok: boolean;
  taskId: string;
  provider: string;
  startedAt?: string;
  prompt: string;
  git: {
    baseline: GitSnapshot;
    post: GitSnapshot;
  };
  invocation: InvocationInfo;
  executionLog?: ExecutionLog;
  runner?: RunnerResult;
  test?: TestResult;
  result?: ProviderResult;
  policyIssues?: PolicyIssue[];
  policyWarnings?: string[];
  errors: string[];
}

export interface InvocationInfo {
  cmd: string;
  args: string[];
  cwd?: string;
  exitCode?: number;
  durationMs?: number;
}

export interface RunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut?: boolean;
  signal?: string | null;
}

export interface TestResult {
  command: string;
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  skipped?: boolean;
  note?: string;
}

export interface PolicyDecision {
  ok: boolean;
  errors: string[];
  warnings: string[];
  issues?: PolicyIssue[];
}

export interface PolicyIssue {
  code: string;
  message: string;
  phase: "pre" | "post";
  severity: "error" | "warning";
}

export interface Config {
  server: {
    name: string;
    version: string;
    protocolVersion: string;
  };
  providersDir?: string;
  policy: {
    trackBinaryPaths?: boolean;
    requireTestCommand?: boolean;
  };
  runner: {
    timeoutSeconds: number;
    retry?: {
      maxAttempts?: number;
      delaySeconds?: number;
    };
  };
  providers: Record<string, ProviderConfig>;
  audit: {
    enabled: boolean;
    dir: string;
  };
  logs: {
    enabled: boolean;
    dir: string;
  };
}

export interface ProviderConfig {
  type?: string;
  binary: string;
  inputMode: "stdin" | "arg";
  inputFlag?: string;
  modelFlag?: string;
  model?: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  healthCheck?: ProviderHealthCheck;
}

export interface ProviderHealthCheck {
  versionArgs?: string[];
  authArgs?: string[];
  authOutputMode?: "json" | "jsonl" | "text";
  timeoutMs?: number;
  successExitCodes?: number[];
}

export interface ProviderResultEnvelope {
  provider: string;
  rawOutput: string;
  parsed: ProviderResult;
}

export interface ExecutionLog {
  path: string;
  format: "markdown";
}

export interface ToolCallRequest {
  name: string;
  arguments: JsonValue;
}
