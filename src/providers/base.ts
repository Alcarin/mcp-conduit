import { InvocationInfo, ProviderConfig, ProviderResult, TaskRequest } from "../core/types.js";

export interface Invocation {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  input?: string;
}

export interface LLMProvider {
  id: string;
  displayName: string;
  buildInvocation(task: TaskRequest, config: ProviderConfig, prompt: string): Invocation;
  parseResult(stdout: string, stderr: string): ProviderResult;
}

export function toInvocationInfo(invocation: Invocation): InvocationInfo {
  return {
    cmd: invocation.cmd,
    args: invocation.args,
    cwd: invocation.cwd
  };
}
