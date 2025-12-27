import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function frame(message: JsonRpcMessage): string {
  const payload = JSON.stringify(message);
  const length = Buffer.byteLength(payload, "utf-8");
  return `Content-Length: ${length}\r\n\r\n${payload}`;
}

const tsxBin = path.resolve("node_modules", "tsx", "dist", "cli.mjs");

function startServer(env?: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [tsxBin, "src/server.ts"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...(env ?? {}) }
  });
  return child;
}

function collectResponses(
  child: ReturnType<typeof startServer>,
  expected: number,
  timeoutMs = 12000
): Promise<JsonRpcMessage[]> {
  return new Promise((resolve, reject) => {
    const responses: JsonRpcMessage[] = [];
    let buffer = Buffer.alloc(0);

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) {
          return;
        }
        const header = buffer.slice(0, headerEnd).toString("ascii");
        const match = header.match(/^Content-Length:\s*(\d+)$/im);
        if (!match) {
          buffer = buffer.slice(headerEnd + 4);
          continue;
        }
        const length = Number.parseInt(match[1], 10);
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + length;
        if (buffer.length < bodyEnd) {
          return;
        }
        const body = buffer.slice(bodyStart, bodyEnd).toString("utf-8");
        buffer = buffer.slice(bodyEnd);
        responses.push(JSON.parse(body) as JsonRpcMessage);
        if (responses.length === expected) {
          cleanup();
          resolve(responses);
          return;
        }
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const onExit = () => {
      if (responses.length < expected) {
        cleanup();
        reject(new Error("Server exited before collecting expected responses."));
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for responses."));
    }, timeoutMs);

    child.stdout?.on("data", onData);
    child.on("error", onError);
    child.on("exit", onExit);
  });
}

async function sendAndCollect(
  child: ReturnType<typeof startServer>,
  message: JsonRpcMessage,
  timeoutMs = 12000
): Promise<JsonRpcMessage> {
  const waitForResponse = collectResponses(child, 1, timeoutMs);
  child.stdin?.write(frame(message));
  const [response] = await waitForResponse;
  return response;
}

function writeConfig(fakeProvider: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-conduit-config-"));
  const file = path.join(dir, "config.json");
  const config = {
    audit: { enabled: false, dir: path.join(dir, "audit") },
    logs: { enabled: true, dir: path.join(dir, "logs") },
    providers: { fake: fakeProvider }
  };
  fs.writeFileSync(file, JSON.stringify(config), "utf-8");
  return file;
}

function buildFakeProvider(script: string, env?: Record<string, string>) {
  const provider: Record<string, unknown> = {
    type: "json-cli",
    binary: process.execPath,
    inputMode: "stdin",
    args: ["-e", script],
    healthCheck: { versionArgs: ["--version"] }
  };
  if (env) {
    provider.env = env;
  }
  return provider;
}

function initRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-conduit-repo-"));
  runGit(dir, ["init"]);
  return dir;
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, stdio: "ignore" });
  if (result.error) {
    throw result.error;
  }
  assert.equal(result.status, 0, `git ${args.join(" ")} failed`);
}

test("tools/list reports available providers", async () => {
  const script = "console.log(JSON.stringify({logs:['ok']}));";
  const configPath = writeConfig(buildFakeProvider(script));
  const child = startServer({ MCP_CONDUIT_CONFIG: configPath });

  await sendAndCollect(child, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" }
  });
  const listResponse = await sendAndCollect(child, { jsonrpc: "2.0", id: 2, method: "tools/list" }, 15000);
  await sendAndCollect(child, { jsonrpc: "2.0", id: 3, method: "shutdown" });
  child.stdin?.write(frame({ jsonrpc: "2.0", method: "exit" }));

  const tools = (listResponse.result as any).tools as any[];
  const runTool = tools.find((tool) => tool.name === "run_task");
  assert.ok(runTool);
  assert.ok(runTool.providerStatus.available.includes("fake"));
  assert.ok(runTool.inputSchema.properties.provider.enum.includes("fake"));

  const [code] = (await once(child, "exit")) as [number];
  assert.equal(code, 0);
});

test("run_task dryRun returns skipped test results", async () => {
  const repoDir = initRepo();
  const script = "console.log(JSON.stringify({logs:['ok']}));";
  const configPath = writeConfig(buildFakeProvider(script));
  const child = startServer({ MCP_CONDUIT_CONFIG: configPath });

  await sendAndCollect(child, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" }
  });
  const runResponse = await sendAndCollect(child, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "run_task",
      arguments: {
        provider: "fake",
        instructions: "Dry run.",
        cwd: repoDir,
        dryRun: true
      }
    }
  }, 15000);
  await sendAndCollect(child, { jsonrpc: "2.0", id: 3, method: "shutdown" });
  child.stdin?.write(frame({ jsonrpc: "2.0", method: "exit" }));

  const result = runResponse.result as any;
  assert.equal(result.ok, true);
  assert.ok(result.result.logs.some((entry: string) => entry.includes("dryRun enabled")));
  assert.equal(result.test.skipped, true);
  assert.equal(result.test.note, "dryRun enabled");
  assert.equal(result.runner, undefined);

  const [code] = (await once(child, "exit")) as [number];
  assert.equal(code, 0);
});

test("run_task executes provider and captures git changes", async () => {
  const repoDir = initRepo();
  const filePath = path.join(repoDir, "note.txt");
  fs.writeFileSync(filePath, "baseline", "utf-8");
  runGit(repoDir, ["add", "note.txt"]);
  runGit(repoDir, ["config", "user.email", "test@example.com"]);
  runGit(repoDir, ["config", "user.name", "Test User"]);
  runGit(repoDir, ["commit", "-m", "init"]);

  const script = [
    "const fs = require('fs');",
    "const file = process.env.MCP_TEST_FILE;",
    "process.stdin.setEncoding('utf8');",
    "let data = '';",
    "process.stdin.on('data', chunk => { data += chunk; });",
    "process.stdin.on('end', () => {",
    "  fs.writeFileSync(file, 'updated', 'utf8');",
    "  console.log(JSON.stringify({ logs: ['ok'] }));",
    "});",
    "process.stdin.resume();"
  ].join("");

  const configPath = writeConfig(buildFakeProvider(script, { MCP_TEST_FILE: filePath }));
  const child = startServer({ MCP_CONDUIT_CONFIG: configPath });

  await sendAndCollect(child, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" }
  });
  const runResponse = await sendAndCollect(child, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "run_task",
      arguments: {
        provider: "fake",
        instructions: "Update note.",
        cwd: repoDir
      }
    }
  }, 20000);
  await sendAndCollect(child, { jsonrpc: "2.0", id: 3, method: "shutdown" });
  child.stdin?.write(frame({ jsonrpc: "2.0", method: "exit" }));

  const result = runResponse.result as any;
  assert.equal(result.ok, true);
  assert.ok(result.result.logs.includes("ok"));
  assert.ok(result.git.post.paths.includes("note.txt"));
  assert.equal(fs.readFileSync(filePath, "utf-8"), "updated");

  const [code] = (await once(child, "exit")) as [number];
  assert.equal(code, 0);
});
