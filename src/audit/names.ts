function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function buildRunBasename(provider: string, taskId: string, startedAt: string): string {
  const safeProvider = sanitizeSegment(provider || "provider");
  const safeTaskId = sanitizeSegment(taskId || "task");
  const safeTimestamp = sanitizeSegment(startedAt.replace(/[:.]/g, "-"));
  return `${safeTimestamp}__${safeProvider}__${safeTaskId}`;
}
