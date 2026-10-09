# Compatibility-first roadmap

## Phase 1 — local node and MCP bridge

Delivered in this repository:

- Versioned `meshlink/v1` task contract.
- Single-node HTTP task lifecycle.
- Local YAML policy with deny-by-default, allow, and approval decisions.
- In-memory audit events and task store.
- MCP adapter for task discovery, submission, and status lookup.

## Phase 2 — secure cross-server delivery

Add, without changing existing v1 task fields:

- Signed agent identities and key rotation.
- HTTPS/mTLS or signed request verification.
- Static remote-agent registry and an outbound transport adapter.
- Persistent SQLite/PostgreSQL task and audit stores.
- Approval actor identity and signed approval records.

## Phase 3 — asynchronous collaboration

Add optional task events, retry policy, durable queues, expiry, cancellation, and progress artifacts. Existing synchronous clients retain their current result/status behavior.

## Phase 4 — interoperability

Add an A2A adapter, TypeScript/Python SDKs, richer agent cards, and capability discovery. A2A is an adapter at the boundary; MeshLink's policy and audit ownership stays local to every node.

## Phase 5 — operations

Add multi-node control-plane deployment, metrics, OpenTelemetry tracing, team RBAC, and a review UI. Direct node-to-node delivery remains available for environments that do not need a central control plane.
