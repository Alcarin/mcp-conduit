# MCP clients

This server is launched by an existing MCP client. The examples below use the
official docs for each client.

## Common server commands

Most MCP clients let you set:

- command (binary to execute)
- args (arguments to the command)
- env (extra environment variables)
- cwd (working directory)

Recommended commands:

- Build: `node dist/server.js` (after `npm run build`)
- Dev: `npm run dev`

Providers are the command-line apps for the AI services you want to use (for
example, Codex, Gemini, Claude).
Authentication is done in the AI service CLI (login or API keys), not in
mcp-conduit.

Copy `mcp-conduit.config.default.json` to `mcp-conduit.config.json` for local
edits (the local file is gitignored).

If your `mcp-conduit.config.json` is outside the repo root, set
`MCP_CONDUIT_CONFIG` in the server env. On Windows, escape backslashes in JSON
strings (for example, `C:\\Users\\you\\...`).

## Antigravity (Google)

1) Open the MCP Store (the "..." menu in the agent panel).
2) Click "Manage MCP Servers" then "View raw config".
3) Add an entry for `mcp-conduit` in `mcp_config.json`.
4) Restart Antigravity.

Example `mcp_config.json`:

```json
{
  "mcpServers": {
    "mcp-conduit": {
      "command": "node",
      "args": ["/path/to/mcp-conduit/dist/server.js"],
      "env": {
        "MCP_CONDUIT_CONFIG": "/path/to/mcp-conduit/mcp-conduit.config.json"
      }
    }
  }
}
```

Notes:

- Antigravity uses `serverUrl` (not `url`) for HTTP/SSE servers.
- Config file location:
  - Windows: `C:\Users\<USERNAME>\.gemini\antigravity\mcp_config.json`
  - macOS/Linux: `~/.gemini/antigravity/mcp_config.json`

Docs:

- https://antigravity.google/docs/tools/mcp
- https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-antigravity.md

## Codex CLI

Codex reads config from `~/.codex/config.toml` (or the IDE extension settings).

Example:

```toml
[mcp_servers.mcp-conduit]
command = "node"
args = ["dist/server.js"]
cwd = "/path/to/mcp-conduit"
env = { MCP_CONDUIT_CONFIG = "/path/to/mcp-conduit/mcp-conduit.config.json" }
```

Docs:

- https://developers.openai.com/codex/local-config/
- https://developers.openai.com/codex/mcp

## Gemini CLI

Gemini reads MCP config from `~/.gemini/settings.json` (user) or
`.gemini/settings.json` (project).

Example:

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

Command line:

```bash
gemini mcp add -s user mcp-conduit node /path/to/mcp-conduit/dist/server.js
gemini mcp add -s user -e MCP_CONDUIT_CONFIG=/path/to/mcp-conduit/mcp-conduit.config.json mcp-conduit node /path/to/mcp-conduit/dist/server.js
gemini mcp list
gemini mcp remove mcp-conduit
```

Docs:

- https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md

## Claude Desktop

1) Open Settings in Claude Desktop.
2) Go to the Developer tab.
3) Click "Edit Config" to open `claude_desktop_config.json`.
4) Add your MCP server entry and save.
5) Restart Claude Desktop.

Config file locations:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Example:

```json
{
  "mcpServers": {
    "mcp-conduit": {
      "command": "node",
      "args": ["/path/to/mcp-conduit/dist/server.js"],
      "env": {
        "MCP_CONDUIT_CONFIG": "/path/to/mcp-conduit/mcp-conduit.config.json"
      }
    }
  }
}
```

Docs:

- https://modelcontextprotocol.io/docs/develop/connect-local-servers

## Cursor

Create `.cursor/mcp.json` in your project for project-specific tools, or
`~/.cursor/mcp.json` in your home directory for tools available everywhere.

Example:

```json
{
  "mcpServers": {
    "mcp-conduit": {
      "command": "node",
      "args": ["/path/to/mcp-conduit/dist/server.js"],
      "env": {
        "MCP_CONDUIT_CONFIG": "/path/to/mcp-conduit/mcp-conduit.config.json"
      }
    }
  }
}
```

Docs:

- https://cursor.com/docs/context/mcp

## Client vs provider

- MCP clients (Antigravity, Cursor, Claude Desktop, Gemini CLI, Codex CLI)
  connect to this server over stdio.
- Provider CLIs (the command-line apps for AI services like Codex, Gemini,
  Claude) are executed by this server when configured in
  `mcp-conduit.config.json` (see `docs/providers.md`).
