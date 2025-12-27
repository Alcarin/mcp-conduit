# mcp-conduit

mcp-conduit is a local MCP server that orchestrates CLI-based LLM agents inside a
repo. It enforces policies, captures audit payloads and run logs, and runs LLMs
through local CLI tools. Authentication is done separately in the AI service
CLI (login or API keys), not in mcp-conduit, before running the server.

## Quickstart

Prerequisite: install and log in to the command-line app of the AI service you
want to use (for example, Codex, Gemini, or Claude; `codex login`).

1) Clone this repo.
2) Install deps: `npm install`
3) Copy `mcp-conduit.config.default.json` to `mcp-conduit.config.json` and edit it.
4) Build the server: `npm run build`
5) Add this to your MCP client config (replace the path, On Windows remember to
escape backslashes in JSON):

```json
{
  "mcpServers": {
    "mcp-conduit": {
      "command": "node",
      "args": ["dist/server.js"],
      "cwd": "/path/to/mcp-conduit"
    }
  }
}
```

For configuration and client-specific instructions, see `docs/configuration.md`
and `docs/clients.md`.

## Antigravity example (Google)

1) Open the MCP Store (the "..." menu in the agent panel).
2) Click "Manage MCP Servers" then "View raw config".
3) Add an entry for `mcp-conduit` in `mcp_config.json`.
4) Restart Antigravity.

```json
{
  "mcpServers": {
    "mcp-conduit": {
      "command": "node",
      "args": ["dist/server.js"],
      "cwd": "/path/to/mcp-conduit",
      "env": {
        "MCP_CONDUIT_CONFIG": "/path/to/mcp-conduit/mcp-conduit.config.json"
      }
    }
  }
}
```

Replace `/path/to/mcp-conduit` with the full path to your repo. On Windows,
escape backslashes in JSON (for example, `C:\\Users\\you\\...`).

More client examples are available in `docs/clients.md`.

## Docs

- `docs/README.md`
- `docs/overview.md`
- `docs/architecture.md`
- `docs/clients.md`
- `docs/configuration.md`
- `docs/providers.md`
- `docs/audit.md`
