# MeshLink

MeshLink is a self-hosted task mesh that lets independent AI agents communicate across environments without sharing a runtime or filesystem.

Phase 1 intentionally stays small: an HTTP node, capability-scoped tasks, deny-by-default policy, an MCP adapter, a remote agent registry, and an audit trail. Its public contract is versioned so durable queues and richer multi-node routing can be added without changing task callers.

## What works today

- A MeshLink Node exposes `GET /health`, `GET /v1/agents`, `POST /v1/tasks`, `GET /v1/tasks/:id`, and `POST /v1/tasks/:id/approve`.
- Every task names a caller and capability. The destination node enforces local policy before running its handler.
- An MCP server exposes `mesh_find_agents`, `mesh_send_task`, and `mesh_get_task` to MCP-capable agent hosts.
- A local registry accepts remote Agent Cards and routes a capability-scoped MCP task to the first available matching remote node.
- The included `service.diagnostics` capability is a safe sample handler. Connect Docker, logs, Kubernetes, or your own workflow adapter behind it.
- A local router-style control dashboard is served at `/` with live node status, agent cards, topology, task lifecycle, and audit events.

See [the Phase 1 architecture](docs/ARCHITECTURE.md) and [the compatibility roadmap](docs/ROADMAP.md).

## Quick start

```bash
npm install -g @meshlink-ai/meshlink
export MESHLINK_INSECURE_DEV_MODE=true # local-only quick start
meshlink
```

🎉 Dashboard opens at `http://localhost:20128`.

The published package is [@meshlink-ai/meshlink on npm](https://www.npmjs.com/package/@meshlink-ai/meshlink). Verify the installed CLI with:

```bash
meshlink --help
```

The default node listens only on `127.0.0.1:20128` and has a deny-by-default policy. For this local quick start, set `MESHLINK_INSECURE_DEV_MODE=true`; production and VPN nodes require signed identities described below. Use `Ctrl+C` to stop it.

## Run a hub with local and VPS nodes

MeshLink Phase 1 is designed for a trusted private network (for example
Tailscale or WireGuard). Run the registry/hub on the VPS, then let every
worker node register and renew itself. A leased Agent Card disappears if the
worker goes offline rather than leaving routing pointed at a stale laptop.

On the VPS, bind to its private VPN address, configure trusted Ed25519 peers and exact worker origins, then optionally protect registrations with a separate shared token:

```bash
export MESHLINK_DASHBOARD_PASSWORD='use-a-long-dashboard-password'
export MESHLINK_REGISTRATION_TOKEN='use-a-separate-long-registration-token'
export MESHLINK_ALLOWED_AGENT_ENDPOINTS='http://100.64.0.12:9001'
meshlink node start \
  --name mesh-hub --id mesh-hub --host 100.64.0.10 --port 8400 \
  --endpoint http://100.64.0.10:8400 --policy ./policy.yaml
```

On Agent B's local machine, expose only its VPN address and register with the
hub at startup. The node sends a heartbeat every 30 seconds and its 90-second
lease is renewed each time:

```bash
meshlink node start \
  --name agent-b-local --id agent-b-local --host 100.64.0.12 --port 9001 \
  --endpoint http://100.64.0.12:9001 --policy ./policy.yaml \
  --hub http://100.64.0.10:8400 \
  --registration-token "$MESHLINK_REGISTRATION_TOKEN"
```

The node's advertised `--endpoint` must be reachable from the hub and be listed exactly in `MESHLINK_ALLOWED_AGENT_ENDPOINTS`. Keep mesh traffic on a private VPN or TLS; signed identity does not encrypt the transport.

## Signed node-to-node requests

For a secured node, generate one Ed25519 keypair per sender and keep the private
key outside Git:

```bash
meshlink identity generate --kid codex-2026-01
```

Set the sender's `MESHLINK_AGENT_ID`, `MESHLINK_AGENT_KEY_ID`, and
base64-encoded `MESHLINK_AGENT_PRIVATE_KEY`. On the receiving node, set
`MESHLINK_TRUSTED_AGENTS` to a JSON array containing the sender's ID, key ID,
PEM public key, and least-privilege permissions. For example:

```json
[{"id":"agent://hermes","kid":"hermes-2026-01","publicKey":"-----BEGIN PUBLIC KEY-----...","permissions":["task.submit"]}]
```

Every request must carry a valid Ed25519 signature, a fresh timestamp, and a single-use request ID.
Unsigned, altered, stale, unknown-key, and replayed requests are rejected
before policy evaluation. Keep transport on a private VPN or TLS as well.

## Run a node

Give the node a stable name, ID, port, and policy file when it will serve other local tools or a worker adapter:

```bash
meshlink node start \
  --name vps-observer \
  --id vps-observer \
  --port 20128 \
  --policy ./policy.yaml
```

Save the following as `policy.yaml` to start. Each node owns its own policy—senders cannot bypass it.

```yaml
version: 1
default: deny
rules:
  - caller: agent://local-host
    capabilities: [service.diagnostics]
    decision: allow
```

## Send a task

With an allowed caller and the node running, call the local HTTP API:

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

Run the MCP adapter against a reachable MeshLink Node:

```bash
meshlink mcp --node http://127.0.0.1:20128 --caller agent://local-host
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

Install the global CLI on the sender host first. The MCP adapter only needs local access to a MeshLink Node; never put a VPS SSH key or a worker credential in an agent's MCP configuration.

### Codex CLI

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.meshlink]
command = "meshlink"
args = ["mcp", "--node", "http://127.0.0.1:8400", "--caller", "agent://codex-host"]
```

Restart Codex, then ask it to use `mesh_find_agents` or `mesh_send_task`. Codex supports MCP server configuration through its CLI or `~/.codex/config.toml`. [OpenAI documentation](https://developers.openai.com/resources/docs-mcp)

### Claude Code

Create `.mcp.json` in the repository where Claude Code runs:

```json
{
  "mcpServers": {
    "meshlink": {
      "command": "meshlink",
      "args": [
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
          "meshlink",
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

For a signed node, create this request with `signedHeaders` (or use the included MCP adapter), and give `agent://hermes` the `task.submit` scope. A plain caller header works only when the receiver explicitly runs in local insecure development mode.

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

The receiving node, not the sender, decides whether that capability may run. To route across servers, register the worker's Agent Card on the sender-side node; see [remote routing](docs/REMOTE-ROUTING.md). Use signed identities and a private VPN or TLS for every non-local deployment.

### Portable context handoff

`TaskRequest.context` and `TaskResult.context` carry a compact handoff envelope: a stable context ID, a bounded summary, and optional content-addressed artifact references (`sha256`). This lets Hermes brief Codex, Codex return a commit/artifact, and QA continue with that same evidence without receiving Hermes's full conversation history. Context is validated for size and artifact hash shape at the receiving node; the node never fetches an artifact URL merely because it appears in context.

### Worker-node adapter pattern

To make an agent such as Codex on a VPS receive tasks, run a MeshLink Node beside it and register a capability handler. The handler must pin the allowed working directory, sandbox, timeout, and tool permissions. MeshLink sends a task to the handler; it does **not** give a remote sender direct terminal access.

```text
MeshLink Node on VPS → capability handler → Codex CLI / SDK → allowed repository
```

### Sandboxed Hermes and QA workers

Use a worker profile when Hermes or QA should execute an explicitly allowlisted capability. The remote task selects only a capability name; it cannot provide a shell command, arguments, or working directory.

```bash
meshlink node start \
  --name hermes-worker --id hermes-worker --policy ./policy.yaml \
  --worker-profile ./examples/hermes-worker.yaml
```

The profile's `workdir`, static command, static arguments, timeout, output cap, and read-only posture are controlled locally. Use [`examples/hermes-worker.yaml`](examples/hermes-worker.yaml) or [`examples/qa-worker.yaml`](examples/qa-worker.yaml) as a starting point. Run the worker under a dedicated OS user or container with no cloud/SSH credentials for an OS-enforced filesystem and credential boundary; MeshLink's adapter deliberately never evaluates remote shell text.

## Dashboard

Set a local dashboard password before starting a node:

```bash
export MESHLINK_DASHBOARD_PASSWORD='replace-this-before-network-exposure'
npm run dev:node -- --name vps-observer --id vps-observer --port 8400 --policy examples/policy.yaml
```

Open `http://127.0.0.1:8400/` and sign in. If the variable is unset, local development falls back to `meshlink` and logs a warning. Never use that fallback on a network-exposed node. Sessions are in-memory, expire after one hour, and use `HttpOnly`/`SameSite=Strict` cookies; restart invalidates them.

## Security mode

MeshLink defaults to a signed, least-privilege network API. A network-exposed node requires `MESHLINK_TRUSTED_AGENTS` (trusted Ed25519 public keys plus explicit permissions) and `MESHLINK_DASHBOARD_PASSWORD`. Every `/v1` request is signed over the exact raw request body, time-bounded, and replay-protected.

An isolated local experiment must opt in explicitly:

```bash
export MESHLINK_INSECURE_DEV_MODE=true
```

Never use that flag on a node bound beyond loopback. Secure agent registration also requires exact endpoint allowlisting, which prevents arbitrary endpoint registration/SSRF:

```bash
export MESHLINK_ALLOWED_AGENT_ENDPOINTS='https://codex.mesh.example,https://qa.mesh.example'
```

Permissions are scoped per trusted peer: `task.submit`, `task.read`, `task.approve`, `audit.read`, `registry.read`, and `registry.write`. A task owner can read its own task; accessing other peers' tasks or approving a privileged task requires the corresponding explicit scope. Dashboard login remains separate from node-to-node authorization.

SQLite (`.meshlink/state.db`) is the default durable store and creates its versioned migration metadata before serving work. Supply `--storage /secure/path/meshlink.db` to relocate it. The current release is deliberately single-node persistence; use a managed Postgres-backed deployment only after its asynchronous shared-store adapter and lease semantics are introduced.

The dashboard escapes agent, task, and audit values as text. Unauthenticated dashboard pages redirect to `/login`; unauthenticated dashboard APIs return `401`, and the frontend redirects back to `/login` when a session expires. Dashboard sessions never authorize the node-to-node API.

Frontend API configuration is optional. `MESHLINK_DASHBOARD_API_BASE` defaults to same-origin (`""`) when unset. Set it only when serving the dashboard through a deliberate API proxy; values are emitted as JSON in a no-store config response, not interpolated into HTML.

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

## Contributing

Want to add a capability, adapter, integration, or improve the docs? See [CONTRIBUTING.md](CONTRIBUTING.md) for local development, tests, pull-request expectations, and the maintainer [npm release process](docs/PUBLISHING.md).

## Security status

Network use requires signed identities and scoped authorization. Durable task/audit storage, worker recovery, and portable context are the next implementation phases; do not claim crash recovery until their end-to-end tests pass.

## License

[MIT](LICENSE)
