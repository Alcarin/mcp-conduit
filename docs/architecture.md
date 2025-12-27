# Architecture

## Goal

This project is a local MCP server that orchestrates LLM CLI agents in a project
directory. It enforces policies, builds concise task prompts, and returns
auditable results by running provider CLIs locally.
Authentication is done in the AI service CLI (login or API keys), not in
mcp-conduit.

## High-level flow

1. MCP client sends a JSON-RPC request over stdio.
2. The server validates the tool call and applies policy pre-checks.
3. A concise task prompt is assembled (task, constraints).
4. Baseline git status/diff is captured (dirty worktrees allowed).
5. The selected provider builds a CLI invocation in agent mode.
6. The CLI runs locally and returns stdout/stderr.
7. Post-run git diff is captured and optional tests are executed.
8. Output is validated by policy and an audit payload is persisted.

If tests are requested and fail, the result is marked unsuccessful unless the
failure is clearly unrelated to the agent's changes.

## Modules

- `src/server.ts`
  - JSON-RPC stdio server.
  - Implements `initialize`, `tools/list`, `tools/call`.
  - Routes tool calls to the execution pipeline.
  - Exposes `providers_health` to refresh cached provider availability.

- `src/core/config.ts`
  - Loads `mcp-conduit.config.json` or falls back to defaults.
  - Centralizes policy, provider, runner, and audit settings.

- `src/context/bundle.ts`
  - Builds the task prompt.
  - Renders the prompt template that providers receive.

- `src/policy/engine.ts`
  - Pre-checks task constraints and path safety.
  - Post-checks output (optional allowlist advisory checks).

- `src/providers/*`
  - Provider adapters for individual CLIs.
  - JSON CLI adapter covers most providers via config.

- `src/runner/spawn.ts`
  - Executes the CLI process with timeouts and captures output.

- `src/audit/store.ts`
  - Writes an audit trail containing request + response + timestamp.
  - Stores baseline and post-run diffs.

## Provider interface

Providers map a task into a CLI invocation. A minimal provider implements:

- `buildInvocation(...)` to produce a command, args, and optional stdin input.
- `parseResult(stdout, stderr)` to normalize output into:
  - `logs`, `tests`, or `raw` output (diffs are captured by the MCP).

This keeps most providers as config-only JSON CLI adapters and reserves code
changes for CLIs that need custom parsing or invocation.

## Extensibility points

- Add new provider configs under `providersDir` for JSON CLI adapters.
- Add new providers under `src/providers/` and register them in `index.ts` when
  custom logic is required.
- Extend the policy engine with custom rules (diff checks, test requirements).
- Add new tools beyond `run_task` by expanding `server.ts`.
- Change prompt format in `src/context/bundle.ts`.

## Message framing

The server uses JSON-RPC 2.0 over stdio with `Content-Length` framing
(LSP-style). This is compatible with most MCP clients.

## Configuration

`mcp-conduit.config.json` configures:

- policy limits (optional allowlist advisory checks, optional binary path tracking,
  optional test requirement)
- provider binaries, input modes, model selection, and health checks
- optional `providersDir` for loading external provider configs at startup
- runner idle timeouts and retry policy
- audit payload and run log directories

Behavior notes:

- Config path precedence is explicit path > `MCP_CONDUIT_CONFIG` > local
  `mcp-conduit.config.json`.
- Invalid JSON or type errors are reported to stderr and the server exits on
  startup.
- Provider health checks run on first `tools/list` and are cached until an
  explicit `providers_health` call; providers can be marked unavailable after
  auth failures, rate limits, or repeated idle timeouts.
- Allowlist checks are advisory: violations are reported in `policyWarnings` but
  do not fail the task.
- Binary diffs are filtered from audit output by default; optional tracking can
  record binary paths in `git.baseline.binaryPaths` and `git.post.binaryPaths`.
- When `policy.requireTestCommand` is true, tasks must supply `testCommand` or
  they fail pre-checks.
- `runner.timeoutSeconds` is an idle timeout based on stdout/stderr activity.
- Audit payloads are written to `<audit.dir>/<timestamp>__<provider>__<taskId>.json`
  (default `.mcp-conduit/audit`, relative to task cwd).
- Stdout/stderr are streamed to `<logs.dir>/<timestamp>__<provider>__<taskId>.md`
  (default `.mcp-conduit/logs`, relative to task cwd) when run logs are enabled.
- Providers can override `timeoutMs`, `cwd`, and `env` per provider.
- Providers can include a `model` field, mapped to provider-specific flags.
- Tool calls can disable audit logging per request via `auditEnabled: false`.
- Tool calls can disable run logs per request via `logsEnabled: false`.
- Task requests can optionally include `testCommand`; when omitted, tests are
  skipped and noted in the audit.

## Directory map

```
src/
  audit/names.ts
  audit/store.ts
  context/bundle.ts
  core/config.ts
  core/types.ts
  policy/engine.ts
  providers/
    base.ts
    health.ts
    index.ts
    json-cli.ts
  runner/spawn.ts
  utils/
    ids.ts
    jsonrpc.ts
  server.ts
```
