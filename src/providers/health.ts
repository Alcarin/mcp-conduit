import { Config, ProviderConfig } from "../core/types.js";
import { runCommand } from "../runner/spawn.js";

export type ProviderHealthStatus = {
  id: string;
  ok: boolean;
  reason?: string;
};

const DEFAULT_TIMEOUT_MS = 15000;

export async function checkProviderHealth(id: string, config: ProviderConfig): Promise<ProviderHealthStatus> {
  const healthCheck = config.healthCheck ?? {};
  const successExitCodes = new Set(healthCheck.successExitCodes ?? [0]);
  const timeoutMs = healthCheck.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = config.cwd ?? process.cwd();
  const env = config.env;

  const versionArgs = healthCheck.versionArgs ?? ["--version"];
  if (versionArgs.length > 0) {
    const versionResult = await safeRun(config.binary, versionArgs, cwd, env, timeoutMs);
    if (!versionResult.ok) {
      return { id, ok: false, reason: versionResult.reason };
    }
    if (!successExitCodes.has(versionResult.exitCode ?? 0)) {
      return { id, ok: false, reason: `version check failed (exit ${versionResult.exitCode})` };
    }
  }

  const authArgs = healthCheck.authArgs ?? [];
  if (authArgs.length > 0) {
    const authResult = await safeRun(config.binary, authArgs, cwd, env, timeoutMs);
    if (!authResult.ok) {
      return { id, ok: false, reason: authResult.reason };
    }
    if (!successExitCodes.has(authResult.exitCode ?? 0)) {
      return { id, ok: false, reason: `auth check failed (exit ${authResult.exitCode})` };
    }

    const authOutputMode = healthCheck.authOutputMode ?? "text";
    if (authOutputMode !== "text") {
      const errorMessage = extractAuthError(authResult.stdout, authOutputMode);
      if (errorMessage) {
        return { id, ok: false, reason: errorMessage };
      }
    }
  }

  return { id, ok: true };
}

export async function checkProvidersHealth(config: Config): Promise<ProviderHealthStatus[]> {
  const entries = Object.entries(config.providers);
  const checks = entries.map(([id, providerConfig]) => checkProviderHealth(id, providerConfig));
  return Promise.all(checks);
}

type SafeRunResult = {
  ok: boolean;
  reason?: string;
  stdout: string;
  exitCode?: number;
};

async function safeRun(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string> | undefined,
  timeoutMs: number
): Promise<SafeRunResult> {
  try {
    const result = await runCommand(cmd, args, { cwd, env, timeoutMs });
    if (result.timedOut) {
      return { ok: false, reason: "health check timed out", stdout: result.stdout, exitCode: result.exitCode };
    }
    return { ok: true, stdout: result.stdout, exitCode: result.exitCode };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      return { ok: false, reason: "binary not found in PATH", stdout: "" };
    }
    return { ok: false, reason: error.message ?? "health check failed", stdout: "" };
  }
}

function extractAuthError(stdout: string, mode: "json" | "jsonl"): string | undefined {
  if (mode === "json") {
    const parsed = parseJson(stdout.trim());
    return parsed ? errorMessageFromJson(parsed) : undefined;
  }

  const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (const line of lines) {
    const parsed = parseJson(line);
    if (!parsed) {
      continue;
    }
    const message = errorMessageFromJson(parsed);
    if (message) {
      return message;
    }
  }
  return undefined;
}

function parseJson(text: string): Record<string, unknown> | undefined {
  if (!text) {
    return undefined;
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function errorMessageFromJson(parsed: Record<string, unknown>): string | undefined {
  const error = parsed.error;
  if (!error) {
    if (parsed.type === "error" && typeof parsed.message === "string") {
      return parsed.message;
    }
    return undefined;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && !Array.isArray(error)) {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") {
      return record.message;
    }
    if (typeof record.type === "string") {
      return record.type;
    }
  }
  return "auth check failed";
}
