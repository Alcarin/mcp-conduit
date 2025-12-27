import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

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

const tsxBin = resolve("node_modules", "tsx", "dist", "cli.mjs");

function startServer() {
  const child = spawn(process.execPath, [tsxBin, "src/server.ts"], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  return child;
}

function collectResponses(
  child: ReturnType<typeof startServer>,
  expected: number,
  timeoutMs = 8000
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

test("initialize/shutdown/exit happy path (partial write)", async () => {
  const child = startServer();
  const init = frame({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" }
  });
  const initFirst = init.slice(0, 10);
  const initSecond = init.slice(10);

  child.stdin?.write(initFirst);
  child.stdin?.write(initSecond);
  child.stdin?.write(frame({ jsonrpc: "2.0", id: 2, method: "shutdown" }));
  child.stdin?.write(frame({ jsonrpc: "2.0", method: "exit" }));

  const responses = await collectResponses(child, 2);
  assert.equal(responses[0].result && (responses[0].result as any).protocolVersion, "2024-11-05");
  assert.equal(responses[1].result, null);

  const [code] = (await once(child, "exit")) as [number];
  assert.equal(code, 0);
});

test("rejects unsupported protocol version", async () => {
  const child = startServer();
  child.stdin?.write(
    frame({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "9999-01-01" }
    })
  );
  child.stdin?.write(frame({ jsonrpc: "2.0", id: 2, method: "shutdown" }));
  child.stdin?.write(frame({ jsonrpc: "2.0", method: "exit" }));

  const responses = await collectResponses(child, 2);
  assert.equal(responses[0].error?.code, -32001);
  assert.equal((responses[0].error?.data as any)?.serverVersion, "2024-11-05");
  assert.equal(responses[1].result, null);

  const [code] = (await once(child, "exit")) as [number];
  assert.equal(code, 0);
});

test("invalid tool call schema returns detailed error", async () => {
  const child = startServer();
  child.stdin?.write(
    frame({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" }
    })
  );
  child.stdin?.write(
    frame({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: 123 }
    })
  );
  child.stdin?.write(frame({ jsonrpc: "2.0", id: 3, method: "shutdown" }));
  child.stdin?.write(frame({ jsonrpc: "2.0", method: "exit" }));

  const responses = await collectResponses(child, 3);
  assert.equal(responses[0].result && (responses[0].result as any).protocolVersion, "2024-11-05");
  assert.equal(responses[1].error?.code, -32602);
  assert.ok(Array.isArray(responses[1].error?.data && (responses[1].error?.data as any).errors));
  assert.equal(responses[2].result, null);

  const [code] = (await once(child, "exit")) as [number];
  assert.equal(code, 0);
});
