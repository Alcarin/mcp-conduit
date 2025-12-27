import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { renderPrompt } from "../src/context/bundle.js";
import { Config, TaskRequest } from "../src/core/types.js";

const baseConfig: Config = {
  server: { name: "mcp-conduit", version: "0.1.0", protocolVersion: "2024-11-05" },
  policy: { trackBinaryPaths: false, requireTestCommand: false },
  runner: { timeoutSeconds: 1 },
  providers: { codex: { binary: "codex", inputMode: "stdin", args: [] } },
  audit: { enabled: true, dir: ".mcp-conduit/audit" },
  logs: { enabled: true, dir: ".mcp-conduit/logs" }
};

test("renderPrompt interpolates cwd, test command, and allowlist", () => {
  const cwd = path.join("tmp", "repo");
  const task: TaskRequest = {
    provider: "codex",
    instructions: "Update files.",
    cwd,
    testCommand: "npm test",
    allowlist: ["src/index.ts", "README.md"]
  };

  const prompt = renderPrompt(task, baseConfig);
  assert.ok(prompt.includes(`- Working directory: ${path.resolve(cwd)}`));
  assert.ok(prompt.includes("- Test command: npm test"));
  assert.ok(prompt.includes("- Allowlist (advisory):"));
  assert.ok(prompt.includes("- src/index.ts"));
  assert.ok(prompt.includes("- README.md"));
});
