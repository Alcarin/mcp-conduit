import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderConfig, TaskRequest } from "../src/core/types.js";
import { JsonCliProvider } from "../src/providers/json-cli.js";

test("json-cli buildInvocation uses positional prompt", () => {
  const config: ProviderConfig = {
    type: "json-cli",
    binary: "codex",
    inputMode: "arg",
    inputFlag: "",
    model: "gpt-5.1",
    args: ["exec"]
  };
  const task: TaskRequest = { provider: "codex", instructions: "", cwd: "/work" };

  const invocation = JsonCliProvider.buildInvocation(task, config, "PROMPT");
  assert.equal(invocation.cmd, "codex");
  assert.deepEqual(invocation.args, ["exec", "--model", "gpt-5.1", "PROMPT"]);
  assert.equal(invocation.input, undefined);
  assert.equal(invocation.cwd, "/work");
});

test("json-cli buildInvocation uses stdin input", () => {
  const config: ProviderConfig = {
    type: "json-cli",
    binary: "gemini",
    inputMode: "stdin",
    args: []
  };
  const task: TaskRequest = { provider: "gemini", instructions: "", cwd: "/repo" };

  const invocation = JsonCliProvider.buildInvocation(task, config, "PROMPT");
  assert.equal(invocation.cmd, "gemini");
  assert.deepEqual(invocation.args, []);
  assert.equal(invocation.input, "PROMPT");
});

test("json-cli parseResult reads provider json", () => {
  const result = JsonCliProvider.parseResult('{"logs":["ok"]}', "");
  assert.deepEqual(result, { logs: ["ok"] });
});

test("json-cli parseResult maps response field", () => {
  const result = JsonCliProvider.parseResult('{"response":"done"}', "");
  assert.deepEqual(result, { raw: "done" });
});

test("json-cli parseResult reads jsonl response", () => {
  const stdout = '{"type":"init"}\n{"response":"final"}\n';
  const result = JsonCliProvider.parseResult(stdout, "");
  assert.deepEqual(result, { raw: "final" });
});
