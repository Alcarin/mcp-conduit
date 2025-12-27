import { ProviderConfig, ProviderResult, TaskRequest } from "../core/types.js";
import { Invocation, LLMProvider } from "./base.js";

function buildArgs(config: ProviderConfig, prompt: string): { args: string[]; input?: string } {
  const args = [...(config.args ?? [])];
  const modelFlag = config.modelFlag ?? "--model";
  if (config.model && modelFlag && !args.includes(modelFlag)) {
    args.push(modelFlag, config.model);
  }
  if (config.inputMode === "arg") {
    const flag = config.inputFlag ?? "--prompt";
    if (flag.length > 0) {
      args.push(flag, prompt);
    } else {
      args.push(prompt);
    }
    return { args };
  }

  return { args, input: prompt };
}

function parseProviderResult(value: unknown): ProviderResult | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const hasKnownKey = "diff" in record || "logs" in record || "tests" in record || "raw" in record;
  if (hasKnownKey) {
    return record as ProviderResult;
  }
  if (typeof record.response === "string") {
    return { raw: record.response };
  }
  return undefined;
}

function parseJsonText(text: string): ProviderResult | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return parseProviderResult(JSON.parse(trimmed));
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return parseProviderResult(JSON.parse(match[0]));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function parseJsonLines(text: string): ProviderResult | undefined {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  let lastMatch: ProviderResult | undefined;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const result = parseProviderResult(parsed);
      if (result) {
        lastMatch = result;
      }
    } catch {
      continue;
    }
  }
  return lastMatch;
}

function parseOutput(stdout: string): ProviderResult {
  const fromJson = parseJsonText(stdout);
  if (fromJson) {
    return fromJson;
  }
  const fromJsonl = parseJsonLines(stdout);
  if (fromJsonl) {
    return fromJsonl;
  }
  return { raw: stdout };
}

export const JsonCliProvider: LLMProvider = {
  id: "json-cli",
  displayName: "JSON CLI",
  buildInvocation(task: TaskRequest, config: ProviderConfig, prompt: string): Invocation {
    const { args, input } = buildArgs(config, prompt);
    return {
      cmd: config.binary,
      args,
      input,
      cwd: task.cwd
    };
  },
  parseResult(stdout: string, _stderr: string): ProviderResult {
    return parseOutput(stdout);
  }
};
