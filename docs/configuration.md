# Configuration

## Location and precedence

The server resolves the config file in this order:

1. Explicit path passed to `loadConfig(...)` (used by tests)
2. `MCP_CONDUIT_CONFIG`
3. `./mcp-conduit.config.json`

If no file is found and no explicit path is provided, defaults are used.
If the file exists but is invalid, the server logs errors and exits on startup.
The repo ships `mcp-conduit.config.default.json`; copy it to
`mcp-conduit.config.json` for local edits (the copy is gitignored).

`providersDir` is resolved relative to the config file location (not the
working directory).

## Path resolution

Paths behave as follows:

- `audit.dir` and `logs.dir` are resolved relative to the task `cwd`.
- Absolute paths are used as-is (they do not get prefixed by `cwd`).

Example (relative):

```json
{
  "audit": { "dir": ".mcp-conduit/audit" },
  "logs": { "dir": ".mcp-conduit/logs" }
}
```

Example (absolute):

```json
{
  "audit": { "dir": "/var/log/mcp-conduit/audit" },
  "logs": { "dir": "/var/log/mcp-conduit/logs" }
}
```

On Windows, remember to escape backslashes in JSON:
`C:\\Logs\\mcp-conduit\\audit`.

## Minimal config example

```json
{
  "audit": { "enabled": true, "dir": ".mcp-conduit/audit" },
  "logs": { "enabled": true, "dir": ".mcp-conduit/logs" },
  "providers": {
    "codex": {
      "type": "json-cli",
      "binary": "codex",
      "inputMode": "arg",
      "inputFlag": "",
      "args": ["exec"],
      "model": "gpt-5.2-low",
      "healthCheck": {
        "versionArgs": ["--version"],
        "authArgs": ["login", "status"]
      }
    }
  }
}
```

See `mcp-conduit.config.default.json` for a more complete example.

## Defaults

Defaults come from `src/core/config.ts`:

- `server.name`: `mcp-conduit`
- `server.protocolVersion`: `2024-11-05`
- `policy.trackBinaryPaths`: `false`
- `policy.requireTestCommand`: `false`
- `runner.timeoutSeconds`: `120` (idle timeout)
- `runner.retry.maxAttempts`: `2`
- `runner.retry.delaySeconds`: `2`
- `audit.enabled`: `true`
- `audit.dir`: `.mcp-conduit/audit`
- `logs.enabled`: `true`
- `logs.dir`: `.mcp-conduit/logs`

## Policy options

- `policy.trackBinaryPaths`: when `true`, record binary file paths in audit
  snapshots. Binary diffs are still excluded from textual diffs.
- `policy.requireTestCommand`: when `true`, `run_task` must include
  `testCommand` or the pre-check fails.

Allowlist checks are advisory; violations are reported in `policyWarnings` but
do not fail the task.

## Runner options

- `runner.timeoutSeconds`: idle timeout (no stdout/stderr activity).
- `runner.timeoutMs`: optional millisecond override (converted to seconds).
- `runner.retry.maxAttempts`: total attempts (minimum 1).
- `runner.retry.delaySeconds`: delay between attempts.

## Audit options

- `audit.enabled`: toggle audit persistence.
- `audit.dir`: directory for JSON audit payloads (relative to task cwd).

## Logs options

- `logs.enabled`: toggle run log persistence.
- `logs.dir`: directory for run logs (relative to task cwd).

Audit and logs are independent. If you want no on-disk persistence, set both
`audit.enabled` and `logs.enabled` to `false`.

Per request, `auditEnabled: false` disables audit logging even when global
`audit.enabled` is true. `logsEnabled: false` disables run logs even when
`logs.enabled` is true.

## Providers

- `providersDir`: optional directory containing `<id>.json` provider configs.
  Files are loaded at startup. Providers defined directly in the config file
  override any same-id providers loaded from `providersDir`.
- `providers`: map of provider IDs to provider configs.

Provider config fields and templates are documented in `docs/providers.md`.

## Per-request overrides (`run_task`)

The tool input allows request-level overrides:

- `allowlist`: list of allowed paths for policy checks
- `cwd`: working directory for the provider invocation
- `env`: extra environment variables
- `dryRun`: when `true`, no CLI execution is performed
- `auditEnabled`: disable audit for this task only
- `logsEnabled`: disable run logs for this task only
- `testCommand`: shell command to run after the provider invocation

When `dryRun` is enabled, tests are marked as skipped and no CLI is executed.
