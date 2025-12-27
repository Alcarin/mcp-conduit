# Providers

Providers are the command-line apps for AI services. Authentication is done in
the AI service CLI (login or API keys), not in mcp-conduit. The server maps a
task into a CLI invocation and parses the CLI output into a standard result.
Most CLIs can use the built-in `json-cli` adapter via config.

## JSON CLI provider template

```json
{
  "type": "json-cli",
  "binary": "my-cli",
  "inputMode": "arg",
  "inputFlag": "--prompt",
  "args": ["--output-format", "json"],
  "model": "my-model",
  "modelFlag": "--model",
  "env": { "MY_ENV": "value" },
  "cwd": "/path/to/project",
  "timeoutMs": 120000,
  "healthCheck": {
    "versionArgs": ["--version"],
    "authArgs": ["--prompt", "ping", "--output-format", "json"],
    "authOutputMode": "json",
    "timeoutMs": 8000,
    "successExitCodes": [0]
  }
}
```

Field notes:

- `inputMode`: `arg` passes the prompt as a CLI argument; `stdin` pipes the
  prompt to stdin.
- `inputFlag`: if empty, the prompt is passed as a positional argument.
- `modelFlag`: if empty, the model must be passed via env or other args.
- `timeoutMs`: provider-specific override; otherwise `runner.timeoutSeconds`
  applies.

The JSON CLI adapter attempts to parse stdout as JSON; if it fails, it returns
`raw` output. The expected shape is a JSON object containing one or more of
`logs`, `tests`, `diff`, or `raw`.

## External providers directory

If `providersDir` is set, the server loads `<id>.json` files from that
directory at startup. The filename becomes the provider ID.

Providers defined directly in `mcp-conduit.config.json` override any same-id
providers loaded from `providersDir`.

## Custom provider adapters

When a CLI needs custom invocation or parsing, add a provider in
`src/providers/` and register it in `src/providers/index.ts`.

Minimal template:

```ts
import { LLMProvider } from "./base.js";
import { ProviderConfig, TaskRequest } from "../core/types.js";

export const MyProvider: LLMProvider = {
  id: "my-provider",
  displayName: "My Provider",
  buildInvocation(task: TaskRequest, config: ProviderConfig, prompt: string) {
    return {
      cmd: config.binary,
      args: ["--prompt", prompt],
      cwd: task.cwd
    };
  },
  parseResult(stdout: string, _stderr: string) {
    return { raw: stdout };
  }
};
```

## Provider health and caching

- `tools/list` runs health checks and caches provider availability.
- `providers_health` refreshes the cache (optionally for selected IDs).
- If a run hits auth errors, rate limits, or repeated idle timeouts, the
  provider is marked unavailable until `providers_health` is called.
