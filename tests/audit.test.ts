import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildRunBasename } from "../src/audit/names.js";
import { writeAudit } from "../src/audit/store.js";
import { Config, ExecutionResult, TaskRequest } from "../src/core/types.js";

test("writeAudit persists payload with deterministic filename", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-conduit-audit-"));
  const auditDir = path.join(tempDir, "audit");
  const config: Config = {
    server: { name: "mcp-conduit", version: "0.1.0", protocolVersion: "2024-11-05" },
    policy: { trackBinaryPaths: false, requireTestCommand: false },
    runner: { timeoutSeconds: 1 },
    providers: { codex: { binary: "codex", inputMode: "stdin", args: [] } },
    audit: { enabled: true, dir: auditDir },
    logs: { enabled: true, dir: path.join(tempDir, "logs") }
  };
  const task: TaskRequest = { provider: "codex", instructions: "Do it." };
  const startedAt = "2025-12-26T12:34:56.789Z";
  const result: ExecutionResult = {
    ok: true,
    taskId: "task-123",
    provider: "codex",
    startedAt,
    prompt: "prompt",
    git: {
      baseline: { status: "", diff: "", paths: [] },
      post: { status: "", diff: "", paths: [] }
    },
    invocation: { cmd: "codex", args: [] },
    errors: []
  };

  writeAudit(config, task, result);

  const basename = buildRunBasename(result.provider, result.taskId, startedAt);
  const filePath = path.join(auditDir, `${basename}.json`);
  assert.ok(fs.existsSync(filePath));
  const payload = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  assert.equal(payload.task.provider, task.provider);
  assert.equal(payload.result.taskId, result.taskId);
  assert.equal(payload.result.startedAt, startedAt);
  assert.equal(typeof payload.timestamp, "string");
});
