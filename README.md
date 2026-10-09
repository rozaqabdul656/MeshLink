# MeshLink

MeshLink is a self-hosted task mesh that lets independent AI agents communicate across environments without sharing a runtime or filesystem.

Phase 1 intentionally stays small: one HTTP node, capability-scoped tasks, deny-by-default policy, an MCP adapter, and an audit trail. Its public contract is versioned so later A2A, registry, queue, identity, and multi-node routing adapters can be added without changing Phase 1 task callers.

## What works today

- A MeshLink Node exposes `GET /health`, `GET /v1/agents`, `POST /v1/tasks`, `GET /v1/tasks/:id`, and `POST /v1/tasks/:id/approve`.
- Every task names a caller and capability. The destination node enforces local policy before running its handler.
- An MCP server exposes `mesh_find_agents`, `mesh_send_task`, and `mesh_get_task` to MCP-capable agent hosts.
- The included `service.diagnostics` capability is a safe sample handler. Connect Docker, logs, Kubernetes, or your own workflow adapter behind it.
- A local router-style control dashboard is served at `/` with live node status, agent cards, topology, task lifecycle, and audit events.

See [the Phase 1 architecture](docs/ARCHITECTURE.md) and [the compatibility roadmap](docs/ROADMAP.md).

## Quick start

```bash
npm install
npm run dev:node -- --name vps-observer --id vps-observer --port 8400 --policy examples/policy.yaml
```

In a second terminal, send a task:

```bash
curl -s http://127.0.0.1:8400/v1/tasks \
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
npm run dev:mcp -- --node http://127.0.0.1:8400 --caller agent://local-host
```

Point your MCP host at that command. The host receives these tools:

- `mesh_find_agents`
- `mesh_send_task`
- `mesh_get_task`

The MCP adapter is an entry point only. It cannot bypass policy on the receiving node.

## Dashboard

Open `http://127.0.0.1:8400/` while a node is running. The dashboard is deliberately read-only in Phase 1: it visualizes local state but cannot edit policies or approve actions. Those write operations require authenticated admin identities in Phase 2.

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

Phase 1's `x-meshlink-agent` header is a development identity placeholder, not cryptographic authentication. Do not expose this service publicly yet. Phase 2 will add signed identities, transport authentication, persistent audit storage, and remote agent registry/routing.

## License

[MIT](LICENSE)
