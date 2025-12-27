import fs from "node:fs";
import path from "node:path";
import { Config, ExecutionResult, TaskRequest } from "../core/types.js";
import { buildRunBasename } from "./names.js";

export function writeAudit(config: Config, task: TaskRequest, result: ExecutionResult): void {
  if (!config.audit.enabled) {
    return;
  }
  if (task.auditEnabled === false) {
    return;
  }

  const baseDir = task.cwd ?? process.cwd();
  const dir = path.resolve(baseDir, config.audit.dir);
  fs.mkdirSync(dir, { recursive: true });

  const startedAt = result.startedAt ?? new Date().toISOString();
  const auditResult = result.startedAt ? result : { ...result, startedAt };
  const payload = {
    task,
    result: auditResult,
    timestamp: new Date().toISOString()
  };

  const basename = buildRunBasename(auditResult.provider, auditResult.taskId, startedAt);
  const filename = `${basename}.json`;
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2), "utf-8");
}
