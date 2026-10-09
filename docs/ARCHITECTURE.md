# MeshLink architecture — Phase 1

MeshLink separates the user-facing tool surface from the node that owns security and execution:

```text
MCP-capable Agent → MeshLink MCP adapter → MeshLink Node → capability handler
```

The local dashboard is a read-only control-plane view served by the same node. It reads agent cards, task lifecycle, and audit events through the node's HTTP API; it does not bypass the policy boundary or expose mutation controls.

The node is the enforcement point. It creates a versioned task envelope, evaluates local policy, records an audit event, then invokes an installed capability handler only when allowed. A handler is local code owned by the node operator; external agents never receive shell or filesystem access automatically.

The MCP adapter is deliberately thin. It translates MCP tool calls into the stable MeshLink v1 HTTP task contract and does not make policy decisions. That separation lets future entry points—A2A, REST clients, SDKs, CLI, or a web UI—share the same node contract.

## Phase 1 request flow

1. An agent calls `mesh_send_task` through MCP.
2. The adapter sends a versioned request to the destination node and identifies the caller.
3. The node evaluates the caller/capability pair against its local deny-by-default policy.
4. A denied task is returned immediately; an approval task waits; an allowed task invokes its local handler.
5. The node returns a task result and preserves audit events for the task lifecycle.

## Compatibility rules

- `protocolVersion` is required for every task and currently equals `meshlink/v1`.
- Existing status values and required fields are immutable inside v1.
- Future fields must be optional; consumers must ignore unknown fields.
- MCP and future A2A adapters translate to the same `TaskRequest`/`Task` contracts.
- Policy versions are explicit. A newer policy evaluator must continue to understand version 1 documents.

## Interactive diagram

Interactive diagrams are generated from committed source and link each component to its supporting lines:

- [Agent task flow](../.archify/architecture-phase-1-20261009-130000/meshlink-phase-1.html)
- [Local control dashboard](../.archify/architecture-dashboard-20261009-131500/meshlink-dashboard.html)

Their JSON sources and validation receipts live alongside the HTML artifacts.
