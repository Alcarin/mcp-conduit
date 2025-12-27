import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/core/config.js";

function writeConfig(data: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-conduit-"));
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, JSON.stringify(data), "utf-8");
  return file;
}

function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const prev = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    fn();
  } finally {
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
}

test("loadConfig reads MCP_CONDUIT_CONFIG", () => {
  const file = writeConfig({ server: { name: "custom" } });
  withEnv("MCP_CONDUIT_CONFIG", file, () => {
    const config = loadConfig();
    assert.equal(config.server.name, "custom");
  });
});

test("loadConfig merges provider overrides", () => {
  const file = writeConfig({ providers: { codex: { binary: "codex-custom" } } });
  const config = loadConfig(file);
  assert.equal(config.providers.codex.binary, "codex-custom");
  assert.equal(config.providers.codex.inputMode, "arg");
  assert.equal(config.providers.codex.inputFlag, "");
  assert.deepEqual(config.providers.codex.args, ["exec"]);
});

test("loadConfig rejects invalid config", () => {
  const file = writeConfig({ policy: { requireTestCommand: "nope" } });
  assert.throws(() => loadConfig(file), /policy\.requireTestCommand/);
});
