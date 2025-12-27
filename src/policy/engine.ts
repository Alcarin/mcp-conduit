import path from "node:path";
import { Config, ExecutionResult, PolicyDecision, PolicyIssue, TaskRequest } from "../core/types.js";

export function preCheck(task: TaskRequest, config: Config): PolicyDecision {
  const errors: string[] = [];
  const warnings: string[] = [];
  const issues: PolicyIssue[] = [];

  const addError = (code: string, message: string) => {
    errors.push(message);
    issues.push({ code, message, phase: "pre", severity: "error" });
  };

  if (!task.instructions || task.instructions.trim().length === 0) {
    addError("POLICY_INSTRUCTIONS_REQUIRED", "Missing instructions.");
  }

  if (config.policy.requireTestCommand && task.testCommand === undefined) {
    addError("POLICY_TEST_COMMAND_REQUIRED", "testCommand is required by policy.");
  }

  const allowlist = task.allowlist ?? [];
  for (const entry of allowlist) {
    if (path.isAbsolute(entry)) {
      addError("POLICY_ALLOWLIST_ABSOLUTE", `Allowlist path must be relative: ${entry}`);
    }
    const normalized = path.normalize(entry);
    if (normalized.startsWith("..")) {
      addError("POLICY_ALLOWLIST_ESCAPE", `Allowlist path escapes workspace: ${entry}`);
    }
  }

  if (task.testCommand !== undefined && task.testCommand.trim().length === 0) {
    addError("POLICY_TEST_COMMAND_EMPTY", "testCommand must be a non-empty string.");
  }

  return { ok: errors.length === 0, errors, warnings, issues };
}

export function postCheck(task: TaskRequest, result: ExecutionResult, config: Config): PolicyDecision {
  const errors: string[] = [];
  const warnings: string[] = [];
  const issues: PolicyIssue[] = [];
  const addWarning = (code: string, message: string) => {
    warnings.push(message);
    issues.push({ code, message, phase: "post", severity: "warning" });
  };
  const diff = result.git.post.diff ?? "";
  const allowlistEntries = task.allowlist ?? [];
  if (allowlistEntries.length > 0) {
    const allowlist = new Set(allowlistEntries);
    const baselinePaths = new Set(result.git.baseline.paths);
    if (baselinePaths.size > 0) {
      addWarning(
        "POLICY_ALLOWLIST_DIRTY_BASELINE",
        "Allowlist check skipped because worktree was dirty at task start."
      );
    } else {
      const touched = result.git.post.paths.length > 0 ? result.git.post.paths : extractDiffPaths(diff);
      for (const file of touched) {
        if (!allowlist.has(file)) {
          addWarning("POLICY_ALLOWLIST_VIOLATION", `Allowlist violation: ${file}`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, issues };
}

function extractDiffPaths(diff: string): string[] {
  const paths = new Set<string>();
  const lines = diff.split("\n");
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const parts = line.split(" ");
      if (parts.length >= 4) {
        const bPath = parts[3].replace(/^b\//, "");
        paths.add(bPath);
      }
    }
  }
  return Array.from(paths);
}
