# Audit and logs

mcp-conduit captures audit payloads and run logs so every task is traceable.

## Audit payloads

When audit is enabled, each run writes a JSON payload to:

- `.mcp-conduit/audit/<timestamp>__<provider>__<taskId>.json`

The payload includes the task request, result, timestamps, git snapshots, and
policy issues. The audit directory is resolved relative to the task cwd.

Per request, `auditEnabled: false` disables audit logging even when global
`audit.enabled` is true.

## Run logs

When run logs are enabled, stdout/stderr are streamed to:

- `.mcp-conduit/logs/<timestamp>__<provider>__<taskId>.md` (default)

Run logs include retry attempts, exit codes, and timeouts. The logs directory is
resolved relative to the task cwd and can be customized with `logs.dir`.

Per request, `logsEnabled: false` disables run logs even when global
`logs.enabled` is true.

## Configuration

Audit payloads and run logs are configured separately:

- `audit.enabled` controls audit payloads.
- `logs.enabled` controls run logs.

## Git snapshots and binary files

The MCP captures baseline and post-run git status/diffs even in dirty
worktrees. Binary diffs are excluded by default. If
`policy.trackBinaryPaths` is true, binary paths are tracked in
`git.baseline.binaryPaths` and `git.post.binaryPaths`.

## Rollback

Since the MCP does not create commits, you can roll back with standard git
commands, for example:

```
git restore .
```
