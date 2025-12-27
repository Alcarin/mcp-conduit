import { JsonValue } from "../core/types.js";

export type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: JsonValue;
  result?: JsonValue;
  error?: { code: number; message: string; data?: JsonValue };
};

export class JsonRpcConnection {
  private buffer = Buffer.alloc(0);
  private readonly onMessage: (msg: JsonRpcMessage) => void;
  private readonly maxHeaderBytes = 8192;

  constructor(onMessage: (msg: JsonRpcMessage) => void) {
    this.onMessage = onMessage;
    process.stdin.on("data", (chunk) => this.handleData(chunk));
  }

  send(message: JsonRpcMessage): void {
    const payload = JSON.stringify(message);
    const length = Buffer.byteLength(payload, "utf-8");
    const header = `Content-Length: ${length}\r\n\r\n`;
    process.stdout.write(header + payload);
  }

  private handleData(chunk: Buffer | string): void {
    const next = typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : chunk;
    this.buffer = Buffer.concat([this.buffer, next]);

    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        if (this.buffer.length > this.maxHeaderBytes) {
          this.buffer = Buffer.alloc(0);
        }
        return;
      }

      const headerRaw = this.buffer.slice(0, headerEnd).toString("ascii");
      const parsed = parseContentLength(headerRaw);
      if (!parsed.ok) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parsed.length;
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;
      if (this.buffer.length < bodyEnd) {
        return;
      }

      const body = this.buffer.slice(bodyStart, bodyEnd).toString("utf-8");
      this.buffer = this.buffer.slice(bodyEnd);

      try {
        const message = JSON.parse(body) as JsonRpcMessage;
        this.onMessage(message);
      } catch {
        // Ignore malformed JSON.
      }
    }
  }
}

function parseContentLength(headers: string): { ok: true; length: number } | { ok: false } {
  const lines = headers.split("\r\n");
  for (const line of lines) {
    const match = line.match(/^Content-Length:\s*(\d+)$/i);
    if (match) {
      const length = Number.parseInt(match[1], 10);
      if (!Number.isFinite(length) || length <= 0) {
        return { ok: false };
      }
      return { ok: true, length };
    }
    if (/^Content-Length:/i.test(line)) {
      return { ok: false };
    }
  }
  return { ok: false };
}
