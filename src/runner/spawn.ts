import spawn from "cross-spawn";
import fs from "node:fs";
import { Invocation } from "../providers/base.js";
import { RunnerResult } from "../core/types.js";

type CommandOptions = {
  cwd?: string;
  env?: Record<string, string>;
  input?: string;
  timeoutMs: number;
  shell?: boolean;
  logFile?: string;
};

export function runCommand(cmd: string, args: string[], options: CommandOptions): Promise<RunnerResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: "pipe",
      shell: options.shell ?? false
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let logStream: fs.WriteStream | undefined;
    if (options.logFile) {
      try {
        logStream = fs.createWriteStream(options.logFile, { flags: "a" });
        logStream.on("error", () => {
          logStream = undefined;
        });
      } catch {
        logStream = undefined;
      }
    }
    const idleTimeoutMs = Math.max(0, options.timeoutMs);

    let idleTimer: NodeJS.Timeout | undefined;
    const clearIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
    };
    const startIdleTimer = () => {
      if (idleTimeoutMs <= 0 || timedOut) {
        return;
      }
      idleTimer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, idleTimeoutMs);
    };
    const resetIdleTimer = () => {
      if (idleTimeoutMs <= 0 || timedOut) {
        return;
      }
      clearIdleTimer();
      startIdleTimer();
    };
    const writeLog = (label: "stdout" | "stderr", chunk: Buffer) => {
      if (!logStream) {
        return;
      }
      const text = chunk.toString();
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (i === lines.length - 1 && line.length === 0) {
          continue;
        }
        logStream.write(`[${label}] ${line}\n`);
      }
    };

    startIdleTimer();

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      writeLog("stdout", chunk);
      resetIdleTimer();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      writeLog("stderr", chunk);
      resetIdleTimer();
    });

    child.on("error", (err) => {
      clearIdleTimer();
      logStream?.end();
      reject(err);
    });

    child.on("close", (code, signal) => {
      clearIdleTimer();
      logStream?.end();
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
        durationMs: Date.now() - start,
        timedOut,
        signal
      });
    });

    if (options.input && child.stdin) {
      child.stdin.write(options.input);
      child.stdin.end();
    }
  });
}

export function runInvocation(invocation: Invocation, timeoutMs: number, logFile?: string): Promise<RunnerResult> {
  return runCommand(invocation.cmd, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    input: invocation.input,
    timeoutMs,
    logFile
  });
}

export function runShellCommand(command: string, cwd: string, timeoutMs: number): Promise<RunnerResult> {
  return runCommand(command, [], { cwd, timeoutMs, shell: true });
}
