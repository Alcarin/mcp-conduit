import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Config, ProviderConfig } from "./types.js";

function getPackageVersion(): string {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const packagePath = path.resolve(dir, "..", "..", "package.json");
    const raw = fs.readFileSync(packagePath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const DEFAULT_CONFIG: Config = {
  server: {
    name: "mcp-conduit",
    version: getPackageVersion(),
    protocolVersion: "2025-11-25"
  },
  policy: {
    trackBinaryPaths: false,
    requireTestCommand: false
  },
  runner: {
    timeoutSeconds: 120,
    retry: {
      maxAttempts: 2,
      delaySeconds: 2
    }
  },
  providers: {
    codex: {
      type: "json-cli",
      binary: "codex",
      inputMode: "arg",
      inputFlag: "",
      args: ["exec"],
      healthCheck: {
        versionArgs: ["--version"],
        authArgs: ["login", "status"]
      }
    },
    gemini: {
      type: "json-cli",
      binary: "gemini",
      inputMode: "arg",
      inputFlag: "--prompt",
      args: ["--output-format", "json"],
      healthCheck: {
        versionArgs: ["--version"],
        authArgs: ["--prompt", "ping", "--output-format", "json"],
        authOutputMode: "json"
      }
    }
  },
  audit: {
    enabled: true,
    dir: ".mcp-conduit/audit"
  },
  logs: {
    enabled: true,
    dir: ".mcp-conduit/logs"
  }
};

export function loadConfig(configPath?: string): Config {
  const { resolvedPath, explicit } = resolveConfigPath(configPath);

  if (!fs.existsSync(resolvedPath)) {
    if (explicit) {
      throw new Error(`Config file not found: ${resolvedPath}`);
    }
    return DEFAULT_CONFIG;
  }

  const raw = fs.readFileSync(resolvedPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in config: ${(err as Error).message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("Invalid config: root must be an object.");
  }

  const errors = validateOverrides(parsed, new Set(Object.keys(DEFAULT_CONFIG.providers)));
  if (errors.length > 0) {
    throw new Error(`Invalid config:\n${errors.map((entry) => `- ${entry}`).join("\n")}`);
  }

  const merged = mergeConfig(DEFAULT_CONFIG, parsed as Partial<Config>);
  const providersDir = resolveProvidersDir(parsed as Partial<Config>, resolvedPath);
  if (providersDir) {
    const externalProviders = loadProviderConfigsFromDir(providersDir, new Set(Object.keys(DEFAULT_CONFIG.providers)));
    merged.providers = { ...externalProviders, ...merged.providers };
    merged.providersDir = providersDir;
  }

  return merged;
}

function resolveConfigPath(configPath?: string): { resolvedPath: string; explicit: boolean } {
  if (configPath && configPath.trim().length > 0) {
    return { resolvedPath: path.resolve(configPath), explicit: true };
  }
  const envPath = process.env.MCP_CONDUIT_CONFIG;
  if (envPath && envPath.trim().length > 0) {
    return { resolvedPath: path.resolve(envPath), explicit: true };
  }
  return { resolvedPath: path.resolve(process.cwd(), "mcp-conduit.config.json"), explicit: false };
}

function mergeConfig(base: Config, overrides: Partial<Config>): Config {
  const mergedProviders: Record<string, ProviderConfig> = { ...base.providers };
  if (overrides.providers) {
    for (const [id, override] of Object.entries(overrides.providers)) {
      const baseProvider = base.providers[id];
      mergedProviders[id] = { ...(baseProvider ?? {}), ...(override as ProviderConfig) };
    }
  }

  return {
    server: { ...base.server, ...overrides.server },
    providersDir: overrides.providersDir ?? base.providersDir,
    policy: { ...base.policy, ...overrides.policy },
    runner: mergeRunner(base.runner, overrides.runner),
    providers: mergedProviders,
    audit: { ...base.audit, ...overrides.audit },
    logs: { ...base.logs, ...overrides.logs }
  };
}

function mergeRunner(base: Config["runner"], overrides?: Partial<Config["runner"]>): Config["runner"] {
  const overrideRecord = (overrides ?? {}) as Record<string, unknown>;
  const timeoutSeconds = resolveRunnerTimeoutSeconds(overrideRecord, base.timeoutSeconds);
  const retry = mergeRunnerRetry(base.retry, overrideRecord.retry);
  return {
    timeoutSeconds,
    ...(retry ? { retry } : {})
  };
}

function resolveRunnerTimeoutSeconds(overrides: Record<string, unknown>, fallback: number): number {
  if (typeof overrides.timeoutSeconds === "number") {
    return overrides.timeoutSeconds;
  }
  if (typeof overrides.timeoutMs === "number") {
    return Math.ceil(overrides.timeoutMs / 1000);
  }
  return fallback;
}

function mergeRunnerRetry(
  base: Config["runner"]["retry"] | undefined,
  overrideValue: unknown
): Config["runner"]["retry"] | undefined {
  if (!isRecord(overrideValue)) {
    return base;
  }
  const override = overrideValue as Record<string, unknown>;
  const merged = { ...(base ?? {}) };
  if (typeof override.maxAttempts === "number") {
    merged.maxAttempts = override.maxAttempts;
  }
  if (typeof override.delaySeconds === "number") {
    merged.delaySeconds = override.delaySeconds;
  }
  return merged;
}

function validateOverrides(value: Record<string, unknown>, baseProviders: Set<string>): string[] {
  const errors: string[] = [];

  if ("server" in value) {
    const server = value.server;
    if (!isRecord(server)) {
      errors.push("server must be an object");
    } else {
      if ("name" in server && typeof server.name !== "string") {
        errors.push("server.name must be a string");
      }
      if ("version" in server && typeof server.version !== "string") {
        errors.push("server.version must be a string");
      }
      if ("protocolVersion" in server && typeof server.protocolVersion !== "string") {
        errors.push("server.protocolVersion must be a string");
      }
    }
  }

  if ("policy" in value) {
    const policy = value.policy;
    if (!isRecord(policy)) {
      errors.push("policy must be an object");
    } else {
      if ("trackBinaryPaths" in policy && typeof policy.trackBinaryPaths !== "boolean") {
        errors.push("policy.trackBinaryPaths must be a boolean");
      }
      if ("requireTestCommand" in policy && typeof policy.requireTestCommand !== "boolean") {
        errors.push("policy.requireTestCommand must be a boolean");
      }
    }
  }

  if ("runner" in value) {
    const runner = value.runner;
    if (!isRecord(runner)) {
      errors.push("runner must be an object");
    } else {
      if ("timeoutSeconds" in runner && typeof runner.timeoutSeconds !== "number") {
        errors.push("runner.timeoutSeconds must be a number");
      }
      if ("timeoutMs" in runner && typeof runner.timeoutMs !== "number") {
        errors.push("runner.timeoutMs must be a number");
      }
      if ("retry" in runner) {
        const retry = runner.retry;
        if (!isRecord(retry)) {
          errors.push("runner.retry must be an object");
        } else {
          if ("maxAttempts" in retry && typeof retry.maxAttempts !== "number") {
            errors.push("runner.retry.maxAttempts must be a number");
          }
          if ("delaySeconds" in retry && typeof retry.delaySeconds !== "number") {
            errors.push("runner.retry.delaySeconds must be a number");
          }
        }
      }
    }
  }

  if ("providersDir" in value && typeof value.providersDir !== "string") {
    errors.push("providersDir must be a string");
  }

  if ("audit" in value) {
    const audit = value.audit;
    if (!isRecord(audit)) {
      errors.push("audit must be an object");
    } else {
      if ("enabled" in audit && typeof audit.enabled !== "boolean") {
        errors.push("audit.enabled must be a boolean");
      }
      if ("dir" in audit && typeof audit.dir !== "string") {
        errors.push("audit.dir must be a string");
      }
    }
  }

  if ("logs" in value) {
    const logs = value.logs;
    if (!isRecord(logs)) {
      errors.push("logs must be an object");
    } else {
      if ("enabled" in logs && typeof logs.enabled !== "boolean") {
        errors.push("logs.enabled must be a boolean");
      }
      if ("dir" in logs && typeof logs.dir !== "string") {
        errors.push("logs.dir must be a string");
      }
    }
  }

  if ("providers" in value) {
    const providers = value.providers;
    if (!isRecord(providers)) {
      errors.push("providers must be an object");
    } else {
      for (const [id, provider] of Object.entries(providers)) {
        const providerPath = `providers.${id}`;
        if (!isRecord(provider)) {
          errors.push(`${providerPath} must be an object`);
          continue;
        }
        const requiresAll = !baseProviders.has(id);
        validateProvider(provider, providerPath, requiresAll, errors);
      }
    }
  }

  return errors;
}

function validateProvider(
  provider: Record<string, unknown>,
  providerPath: string,
  requiresAll: boolean,
  errors: string[]
): void {
  if (requiresAll) {
    if (typeof provider.binary !== "string") {
      errors.push(`${providerPath}.binary must be a string`);
    }
    if (typeof provider.inputMode !== "string") {
      errors.push(`${providerPath}.inputMode must be a string`);
    }
    if (!isStringArray(provider.args)) {
      errors.push(`${providerPath}.args must be an array of strings`);
    }
  }

  if ("type" in provider && typeof provider.type !== "string") {
    errors.push(`${providerPath}.type must be a string`);
  }
  if ("binary" in provider && typeof provider.binary !== "string") {
    errors.push(`${providerPath}.binary must be a string`);
  }
  if ("inputMode" in provider) {
    if (typeof provider.inputMode !== "string") {
      errors.push(`${providerPath}.inputMode must be a string`);
    } else if (provider.inputMode !== "stdin" && provider.inputMode !== "arg") {
      errors.push(`${providerPath}.inputMode must be 'stdin' or 'arg'`);
    }
  }
  if ("inputFlag" in provider && typeof provider.inputFlag !== "string") {
    errors.push(`${providerPath}.inputFlag must be a string`);
  }
  if ("modelFlag" in provider && typeof provider.modelFlag !== "string") {
    errors.push(`${providerPath}.modelFlag must be a string`);
  }
  if ("model" in provider && typeof provider.model !== "string") {
    errors.push(`${providerPath}.model must be a string`);
  }
  if ("args" in provider && !isStringArray(provider.args)) {
    errors.push(`${providerPath}.args must be an array of strings`);
  }
  if ("env" in provider && !isStringRecord(provider.env)) {
    errors.push(`${providerPath}.env must be an object of string values`);
  }
  if ("cwd" in provider && typeof provider.cwd !== "string") {
    errors.push(`${providerPath}.cwd must be a string`);
  }
  if ("timeoutMs" in provider && typeof provider.timeoutMs !== "number") {
    errors.push(`${providerPath}.timeoutMs must be a number`);
  }
  if ("healthCheck" in provider) {
    const healthCheck = provider.healthCheck;
    if (!isRecord(healthCheck)) {
      errors.push(`${providerPath}.healthCheck must be an object`);
    } else {
      if ("versionArgs" in healthCheck && !isStringArray(healthCheck.versionArgs)) {
        errors.push(`${providerPath}.healthCheck.versionArgs must be an array of strings`);
      }
      if ("authArgs" in healthCheck && !isStringArray(healthCheck.authArgs)) {
        errors.push(`${providerPath}.healthCheck.authArgs must be an array of strings`);
      }
      if ("authOutputMode" in healthCheck && typeof healthCheck.authOutputMode !== "string") {
        errors.push(`${providerPath}.healthCheck.authOutputMode must be a string`);
      }
      if ("timeoutMs" in healthCheck && typeof healthCheck.timeoutMs !== "number") {
        errors.push(`${providerPath}.healthCheck.timeoutMs must be a number`);
      }
      if ("successExitCodes" in healthCheck && !isNumberArray(healthCheck.successExitCodes)) {
        errors.push(`${providerPath}.healthCheck.successExitCodes must be an array of numbers`);
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "number");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === "string");
}

function resolveProvidersDir(overrides: Partial<Config>, configPath: string): string | undefined {
  if (!overrides.providersDir || overrides.providersDir.trim().length === 0) {
    return undefined;
  }
  const baseDir = path.dirname(configPath);
  return path.resolve(baseDir, overrides.providersDir);
}


function loadProviderConfigsFromDir(dir: string, baseProviders: Set<string>): Record<string, ProviderConfig> {
  if (!fs.existsSync(dir)) {
    return {};
  }
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) {
    throw new Error(`providersDir is not a directory: ${dir}`);
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const providers: Record<string, ProviderConfig> = {};

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) {
      continue;
    }
    const id = path.basename(entry.name, ".json");
    const filePath = path.join(dir, entry.name);
    const raw = fs.readFileSync(filePath, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Invalid JSON in provider config (${entry.name}): ${(err as Error).message}`);
    }
    if (!isRecord(parsed)) {
      throw new Error(`Invalid provider config (${entry.name}): root must be an object`);
    }

    const errors: string[] = [];
    validateProvider(parsed, `providers.${id}`, !baseProviders.has(id), errors);
    if (errors.length > 0) {
      throw new Error(`Invalid provider config (${entry.name}):\n${errors.map((entryErr) => `- ${entryErr}`).join("\n")}`);
    }
    providers[id] = parsed as unknown as ProviderConfig;
  }

  return providers;
}
