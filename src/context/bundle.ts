import path from "node:path";
import { Config, TaskRequest } from "../core/types.js";

export function renderPrompt(task: TaskRequest, config: Config): string {
  const cwd = task.cwd ? path.resolve(task.cwd) : process.cwd();
  const allowlist = task.allowlist ?? [];
  const allowlistBlock =
    allowlist.length > 0 ? allowlist.map((entry) => `- ${entry}`).join("\n") : "- (none provided)";
  const testLine = task.testCommand
    ? `- Test command: ${task.testCommand}`
    : "- Test command: (none provided; skip)";

  return [
    "## 1.0 SYSTEM DIRECTIVE",
    "You are a delegated coding agent working directly in a local repository.",
    "Follow the task precisely and keep changes minimal.",
    "CRITICAL: Validate every command. If a command fails, fix it or report why.",
    "Do not commit, push, or modify git history.",
    "",
    "## 2.0 TASK",
    task.instructions.trim() || "(missing instructions)",
    "",
    "## 3.0 CONSTRAINTS",
    `- Working directory: ${cwd}`,
    testLine,
    "- Avoid unrelated refactors or formatting-only changes.",
    "- Allowlist (advisory):",
    allowlistBlock,
    "",
    "## 3.1 QUALITY BAR",
    "- Preserve existing project patterns and style.",
    "- Keep the diff minimal and focused on the task.",
    "- Do not introduce new dependencies unless required; explain if you do.",
    "",
    "## 4.0 EXECUTION PROTOCOL",
    "1) Inspect relevant files directly from disk.",
    "2) Implement the required changes.",
    "3) If a test command is provided, run it and fix failures.",
    "   If failures are clearly unrelated to your changes, explain why.",
    "4) Summarize changes and list tests run (or state they were skipped).",
    "",
    "## 5.0 OUTPUT",
    "Return a concise summary and the tests executed."
  ].join("\n");
}
