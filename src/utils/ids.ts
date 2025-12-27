export function makeTaskId(): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  return `task-${stamp}-${rand}`;
}
