import { GitSnapshot, RunnerResult } from "../core/types.js";
import { runCommand } from "../runner/spawn.js";

const GIT_TIMEOUT_MS = 20000;

export async function captureGitSnapshot(
  cwd: string,
  options: { trackBinaryPaths?: boolean } = {}
): Promise<GitSnapshot> {
  const status = await runCommand("git", ["status", "--porcelain=v1"], { cwd, timeoutMs: GIT_TIMEOUT_MS });
  if (status.exitCode !== 0) {
    throw new Error(formatCommandError("git status", status));
  }

  const diff = await runCommand("git", ["diff", "--no-color"], { cwd, timeoutMs: GIT_TIMEOUT_MS });
  if (diff.exitCode !== 0) {
    throw new Error(formatCommandError("git diff", diff));
  }

  let binaryPaths: string[] | undefined;
  if (options.trackBinaryPaths) {
    const numstat = await runCommand("git", ["diff", "--numstat"], { cwd, timeoutMs: GIT_TIMEOUT_MS });
    if (numstat.exitCode !== 0) {
      throw new Error(formatCommandError("git diff --numstat", numstat));
    }
    binaryPaths = parseBinaryPaths(numstat.stdout);
  }

  return {
    status: status.stdout,
    diff: stripBinaryDiff(diff.stdout),
    paths: parseStatusPaths(status.stdout),
    ...(binaryPaths ? { binaryPaths } : {})
  };
}

function parseStatusPaths(output: string): string[] {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const paths: string[] = [];
  for (const line of lines) {
    if (line.length < 4) {
      continue;
    }
    const entry = line.slice(3).trim();
    if (!entry) {
      continue;
    }
    const arrowIndex = entry.lastIndexOf("->");
    if (arrowIndex !== -1) {
      paths.push(entry.slice(arrowIndex + 2).trim());
    } else {
      paths.push(entry);
    }
  }
  return paths;
}

function stripBinaryDiff(output: string): string {
  const lines = output.split(/\r?\n/);
  const filtered: string[] = [];
  let block: string[] = [];
  let inBlock = false;
  let isBinary = false;

  const flushBlock = () => {
    if (block.length > 0 && !isBinary) {
      filtered.push(...block);
    }
    block = [];
    isBinary = false;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (inBlock) {
        flushBlock();
      }
      inBlock = true;
      block = [line];
      continue;
    }

    if (!inBlock) {
      filtered.push(line);
      continue;
    }

    block.push(line);
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      isBinary = true;
    }
  }

  flushBlock();
  return filtered.join("\n");
}

function parseBinaryPaths(output: string): string[] {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const paths = new Set<string>();
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }
    const added = parts[0];
    const deleted = parts[1];
    if (added !== "-" || deleted !== "-") {
      continue;
    }
    const rawPath = parts.slice(2).join("\t").trim();
    if (!rawPath) {
      continue;
    }
    paths.add(normalizeRenamePath(rawPath));
  }
  return Array.from(paths);
}

function normalizeRenamePath(rawPath: string): string {
  if (rawPath.includes("{") && rawPath.includes("=>")) {
    return rawPath.replace(/\{[^}]*=>\s*([^}]+)\}/g, "$1").trim();
  }
  const arrowIndex = rawPath.lastIndexOf("=>");
  if (arrowIndex !== -1) {
    return rawPath.slice(arrowIndex + 2).trim();
  }
  return rawPath.trim();
}

function formatCommandError(label: string, result: RunnerResult): string {
  const details = result.stderr.trim() || result.stdout.trim();
  return details ? `${label} failed: ${details}` : `${label} failed.`;
}
