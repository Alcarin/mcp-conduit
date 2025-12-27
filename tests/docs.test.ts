import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

function listDocFiles(): string[] {
  const files: string[] = [];
  const docsDir = path.resolve("docs");
  if (!fs.existsSync(docsDir)) {
    return files;
  }
  for (const entry of fs.readdirSync(docsDir)) {
    if (entry.toLowerCase().endsWith(".md")) {
      files.push(path.join(docsDir, entry));
    }
  }
  return files;
}

function extractJsonBlocks(content: string): string[] {
  const blocks: string[] = [];
  const regex = /```json\s*\r?\n([\s\S]*?)\r?\n```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

test("docs JSON snippets parse", () => {
  const files = [path.resolve("README.md"), ...listDocFiles()];
  const errors: string[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    const blocks = extractJsonBlocks(content);
    for (const block of blocks) {
      try {
        JSON.parse(block.trim());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${file}: ${message}`);
      }
    }
  }

  assert.equal(errors.length, 0, errors.join("\n"));
});
