# MeshLink

MeshLink is a self-hosted task mesh that lets independent AI agents communicate across environments without sharing a runtime or filesystem.

Phase 1 intentionally stays small: an HTTP node, capability-scoped tasks, deny-by-default policy, an MCP adapter, a remote agent registry, and an audit trail. Its public contract is versioned so later A2A, durable queues, signed identity, and richer multi-node routing can be added without changing Phase 1 task callers.

## What works today

- A MeshLink Node exposes `GET /health`, `GET /v1/agents`, `POST /v1/tasks`, `GET /v1/tasks/:id`, and `POST /v1/tasks/:id/approve`.
- Every task names a caller and capability. The destination node enforces local policy before running its handler.
- An MCP server exposes `mesh_find_agents`, `mesh_send_task`, and `mesh_get_task` to MCP-capable agent hosts.
- A local registry accepts remote Agent Cards and routes a capability-scoped MCP task to the first available matching remote node.
- The included `service.diagnostics` capability is a safe sample handler. Connect Docker, logs, Kubernetes, or your own workflow adapter behind it.
- A local router-style control dashboard is served at `/` with live node status, agent cards, topology, task lifecycle, and audit events.

See [the Phase 1 architecture](docs/ARCHITECTURE.md) and [the compatibility roadmap](docs/ROADMAP.md).

## Install globally

```bash
npm install -g meshlink
meshlink
```

🎉 Dashboard opens at `http://localhost:20128`.

## Release to npm

MeshLink publishes through GitHub Actions when a version tag is pushed. It uses npm Trusted Publishing (OIDC), so the repository never needs to store an `NPM_TOKEN` secret.

Before the first automated release, configure this once in the npm package settings:

- Trusted publisher: **GitHub Actions**
- GitHub owner: `rozaqabdul656`
- Repository: `MeshLink`
- Workflow filename: `publish.yml`

Then release a version whose tag matches `package.json` exactly:

```bash
npm version patch
git push --follow-tags
```

For example, version `0.1.1` must be released as tag `v0.1.1`. GitHub runs tests, builds the package, and publishes it to npm. See [the release guide](docs/PUBLISHING.md) for the first-release setup and troubleshooting.

Until the first npm release is published, install the current GitHub version instead:

```bash
npm install -g github:rozaqabdul656/MeshLink
meshlink
```

The default node is intentionally local-only and deny-by-default. Use `Ctrl+C` to stop it.

## From source

```bash
npm install
npm run dev:node -- --name vps-observer --id vps-observer --port 20128 --policy examples/policy.yaml
```

In a second terminal, send a task:

```bash
curl -s http://127.0.0.1:20128/v1/tasks \
  -H 'content-type: application/json' \
  -H 'x-meshlink-agent: agent://local-host' \
  --data '{
    "protocolVersion": "meshlink/v1",
    "targetCapability": "service.diagnostics",
    "input": { "instruction": "Investigate API 500" },
    "constraints": { "readOnly": true }
  }'
```

## Connect an MCP-capable agent

Run the adapter against a reachable MeshLink Node:

```bash
npm run dev:mcp -- --node http://127.0.0.1:20128 --caller agent://local-host
```

Point your MCP host at that command. The host receives these tools:

- `mesh_find_agents`
- `mesh_send_task`
- `mesh_get_task`

The MCP adapter is an entry point only. It cannot bypass policy on the receiving node.

## Install MeshLink in an AI agent

MeshLink has two roles:

- **Sender host**: an agent that calls MeshLink tools to delegate work. Examples: Codex, Claude Code, OpenCode, Hermes, or a custom agent.
- **Worker node**: a MeshLink Node near the repo, VPS, Docker host, or internal system that owns its own policy and capability handlers.

For every sender host, first build MeshLink once and keep the absolute checkout path available:

```bash
git clone https://github.com/rozaqabdul656/MeshLink.git
cd MeshLink
npm install
npm run build
```

Replace `/absolute/path/to/MeshLink` in the following examples with the actual cloned path. The MCP adapter only needs local access to a MeshLink Node; never put a VPS SSH key or a worker credential in an agent's MCP configuration.

### Codex CLI

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.meshlink]
command = "node"
args = ["/absolute/path/to/MeshLink/dist/cli.js", "mcp", "--node", "http://127.0.0.1:8400", "--caller", "agent://codex-host"]
```

Restart Codex, then ask it to use `mesh_find_agents` or `mesh_send_task`. Codex supports MCP server configuration through its CLI or `~/.codex/config.toml`. [OpenAI documentation](https://developers.openai.com/resources/docs-mcp)

### Claude Code

Create `.mcp.json` in the repository where Claude Code runs:

```json
{
  "mcpServers": {
    "meshlink": {
      "command": "node",
      "args": [
        "/absolute/path/to/MeshLink/dist/cli.js",
        "mcp",
        "--node", "http://127.0.0.1:8400",
        "--caller", "agent://claude-host"
      ]
    }
  }
}
```

Claude Code asks for approval before using project-scoped MCP servers. [Claude Code MCP configuration](https://docs.anthropic.com/en/docs/claude-code/mcp)

### OpenCode

Add this to `opencode.json` or `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "meshlink": {
        "type": "local",
        "command": [
          "node",
          "/absolute/path/to/MeshLink/dist/cli.js",
          "mcp",
          "--node", "http://127.0.0.1:8400",
          "--caller", "agent://opencode-host"
        ]
      }
    }
  }
}
```

OpenCode exposes the configured MCP tools to its agent runtime. [OpenCode MCP configuration](https://dev.opencode.ai/v2/docs/mcp-servers/)

### Hermes or a custom agent

If the Hermes runtime supports MCP, configure it to launch the same stdio command used above and give it a unique caller ID such as `agent://hermes`. If it does not support MCP, call the MeshLink Node HTTP API from its tool/runtime instead:

```ts
await fetch("http://127.0.0.1:8400/v1/tasks", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-meshlink-agent": "agent://hermes"
  },
  body: JSON.stringify({
    protocolVersion: "meshlink/v1",
    targetCapability: "service.diagnostics",
    input: { instruction: "Investigate API 500" },
    constraints: { readOnly: true }
  })
});
```

This direct HTTP example uses the current Phase 1 development identity header. It can route to a registered remote node, but do not expose this API to the public internet until signed identities, authenticated registration, and TLS are enabled.

### Calling a worker

Every sender gets the same MCP tools:

```text
mesh_find_agents
mesh_send_task
mesh_get_task
```

For example, a sender can ask MeshLink to delegate a read-only task:

```json
{
  "capability": "service.diagnostics",
  "instruction": "Investigate API 500 and return evidence only.",
  "readOnly": true
}
```

The receiving node, not the sender, decides whether that capability may run. To route across servers, register the worker's Agent Card on the sender-side node; see [remote routing](docs/REMOTE-ROUTING.md). Phase 1 uses a development identity header, so only run this across trusted/private networks.

### Worker-node adapter pattern

To make an agent such as Codex on a VPS receive tasks, run a MeshLink Node beside it and register a capability handler. The handler must pin the allowed working directory, sandbox, timeout, and tool permissions. MeshLink sends a task to the handler; it does **not** give a remote sender direct terminal access.

```text
MeshLink Node on VPS → capability handler → Codex CLI / SDK → allowed repository
```

The Codex worker adapter is not included in Phase 1 yet. Use `service.diagnostics` as the safe sample capability while building adapters for code-writing or deployment work.

## Dashboard

Open `http://127.0.0.1:20128/` while a node is running. The dashboard is deliberately read-only in Phase 1: it visualizes local state but cannot edit policies or approve actions. Those write operations require authenticated admin identities in Phase 2.

## Policy

Policy is local to each node and starts as deny-by-default:

```yaml
version: 1
default: deny
rules:
  - caller: agent://local-host
    capabilities: [service.diagnostics]
    decision: allow
  - caller: agent://local-host
    capabilities: [service.restart]
    decision: approval
```

`allow` runs an installed capability handler. `approval` stores the task as `awaiting_approval`; an operator must call its approval endpoint. Anything else is denied.

## Development

```bash
npm run check
npm test
npm run build
```

## Security status

Phase 1's `x-meshlink-agent` header is a development identity placeholder, not cryptographic authentication. Do not expose this service publicly yet. Phase 2 will add signed identities, authenticated registration, TLS/replay protection, and persistent task/audit storage.

## License

[MIT](LICENSE)
