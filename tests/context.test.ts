import assert from "node:assert/strict";
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

test("renderPrompt includes template sections", () => {
  const task: TaskRequest = {
    provider: "codex",
    instructions: "Do the thing.",
    cwd: "/repo"
  };
  const prompt = renderPrompt(task, baseConfig);
  assert.ok(prompt.includes("## 1.0 SYSTEM DIRECTIVE"));
  assert.ok(prompt.includes("## 2.0 TASK"));
  assert.ok(prompt.includes("## 3.0 CONSTRAINTS"));
  assert.ok(prompt.includes("## 3.1 QUALITY BAR"));
  assert.ok(prompt.includes("## 4.0 EXECUTION PROTOCOL"));
  assert.ok(prompt.includes("## 5.0 OUTPUT"));
});
