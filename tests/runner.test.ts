import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCommand } from "../src/runner/spawn.js";

test("runCommand streams output to log file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-conduit-"));
  const logFile = path.join(dir, "run.md");
  const result = await runCommand(process.execPath, ["-e", "console.log('hi'); console.error('oops');"], {
    timeoutMs: 1000,
    logFile
  });
  assert.equal(result.exitCode, 0);
  const log = fs.readFileSync(logFile, "utf-8");
  assert.ok(log.includes("[stdout] hi"));
  assert.ok(log.includes("[stderr] oops"));
});

test("runCommand marks idle timeout", async () => {
  const result = await runCommand(process.execPath, ["-e", "setTimeout(() => {}, 2000);"], {
    timeoutMs: 100
  });
  assert.equal(result.timedOut, true);
});
