import assert from "node:assert/strict";
import { test } from "node:test";
import { preCheck, postCheck } from "../src/policy/engine.js";
import { Config, ExecutionResult, TaskRequest } from "../src/core/types.js";

const baseConfig: Config = {
  server: { name: "mcp-conduit", version: "0.1.0", protocolVersion: "2024-11-05" },
  policy: { trackBinaryPaths: false, requireTestCommand: false },
  runner: { timeoutSeconds: 1 },
  providers: { codex: { binary: "codex", inputMode: "stdin", args: [] } },
  audit: { enabled: true, dir: ".mcp-conduit/audit" },
  logs: { enabled: true, dir: ".mcp-conduit/logs" }
};

function withPolicy(overrides: Partial<Config["policy"]>): Config {
  return { ...baseConfig, policy: { ...baseConfig.policy, ...overrides } };
}

function makeResult(diff: string, baselinePaths: string[] = [], postPaths: string[] = []): ExecutionResult {
  return {
    ok: true,
    taskId: "task-1",
    provider: "codex",
    prompt: "",
    git: {
      baseline: { status: "", diff: "", paths: baselinePaths },
      post: { status: "", diff, paths: postPaths }
    },
    invocation: { cmd: "", args: [] },
    errors: []
  };
}

test("preCheck requires testCommand when policy enabled", () => {
  const config = withPolicy({ requireTestCommand: true });
  const task: TaskRequest = { provider: "codex", instructions: "Do it." };
  const decision = preCheck(task, config);
  assert.equal(decision.ok, false);
  assert.ok(decision.errors.includes("testCommand is required by policy."));
});

test("postCheck reports allowlist violations as warnings", () => {
  const config = withPolicy({});
  const task: TaskRequest = {
    provider: "codex",
    instructions: "Edit files.",
    allowlist: ["allowed.txt"]
  };
  const diff = [
    "diff --git a/allowed.txt b/allowed.txt",
    "--- a/allowed.txt",
    "+++ b/allowed.txt",
    "diff --git a/extra.txt b/extra.txt",
    "--- a/extra.txt",
    "+++ b/extra.txt"
  ].join("\n");
  const result = makeResult(diff);
  const decision = postCheck(task, result, config);
  assert.equal(decision.ok, true);
  assert.equal(decision.errors.length, 0);
  assert.ok(decision.warnings.some((entry) => entry.includes("Allowlist violation: extra.txt")));
});

test("postCheck skips allowlist when worktree was dirty at start", () => {
  const config = withPolicy({});
  const task: TaskRequest = {
    provider: "codex",
    instructions: "Edit files.",
    allowlist: ["allowed.txt"]
  };
  const result = makeResult("diff --git a/allowed.txt b/allowed.txt", ["dirty.txt"]);
  const decision = postCheck(task, result, config);
  assert.equal(decision.ok, true);
  assert.equal(decision.errors.length, 0);
  assert.ok(
    decision.warnings.some((entry) => entry.includes("Allowlist check skipped because worktree was dirty"))
  );
});
