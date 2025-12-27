# Overview

mcp-conduit is a local Model Context Protocol (MCP) server that orchestrates
LLM CLIs inside a project directory. It enforces policies, captures audit
payloads and run logs, and runs LLMs through local CLI tools. Authentication is
done separately in the AI service CLI (login or API keys), not in mcp-conduit,
before running the server.

## Core idea

Modern LLM-based development often suffers from:

- high cost due to API token usage
- context saturation that lowers reliability
- monolithic agents that try to do everything

mcp-conduit addresses these with a delegation-first architecture:

- one orchestrator
- many specialized sub-agents
- minimal prompts and clear boundaries

## What it does

- receives structured tasks from an orchestrator
- builds concise prompts with constraints
- invokes local LLM CLIs in the repo
- captures git diffs, run logs, and test results
- enforces guardrails before changes are accepted
- returns auditable, machine-readable outputs

It delegates execution to the configured CLI.

## Key characteristics

### No direct API integration

All model interactions happen through local CLI tools. This keeps cost
predictable and avoids vendor lock-in.

### Subscription-leveraging execution

Providers are interchangeable as long as a CLI interface exists. The MCP
focuses on execution, not on model hosting.

### Prompt minimization

Each task prompt is small and specific. Agents can read files directly from
Disk when needed, keeping prompt size low.

### Policy-enforced execution

Pre- and post-checks enforce constraints such as test requirements and
allowlist advisory checks. Policies are enforced by code.

### Orchestrator-friendly

The MCP is designed to be called by higher-level orchestrators that handle
scope and planning.

## Typical workflow

1. The orchestrator defines a micro-task.
2. The MCP builds a concise task prompt.
3. A CLI agent runs inside the project directory.
4. The MCP captures diffs, run logs, and optional tests.
5. Results are returned for review and integration.

## Audit, logs, and rollback

Audit payloads and run logs are stored under `.mcp-conduit/` by default (relative
to the task cwd) and can be customized via `audit.dir` and `logs.dir`. See
`docs/audit.md` for details.

## What this project is not

- not an AI model
- not a code generation API
- not a SaaS platform
- not a replacement for human architectural decisions

It is a force multiplier, not a decision maker.

## Intended audience

- independent developers
- small teams
- non-profits
- open-source maintainers
- anyone building complex systems with limited resources

## License intent

The project is licensed under MPL-2.0 to keep the core open while allowing
commercial integrations.
