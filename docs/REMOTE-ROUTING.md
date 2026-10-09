# Remote routing

MeshLink nodes can keep remote Agent Cards and route capability-scoped tasks.

Register a remote node:

```sh
curl -X POST http://127.0.0.1:8400/v1/agents \
  -H 'content-type: application/json' \
  --data '{"protocolVersion":"meshlink/v1","id":"node-b","name":"Node B","endpoint":"http://127.0.0.1:9001","capabilities":["service.diagnostics"],"status":"available"}'
```

Find available nodes:

```sh
curl 'http://127.0.0.1:8400/v1/agents/capability?capability=service.diagnostics'
```

The MCP adapter queries that endpoint, selects the first available matching Agent Card, and sends the task to its endpoint. If no remote match exists, it sends to configured local node.

## Security boundary

Phase 1 registration and task delivery still use the development `x-meshlink-agent` header. Do not expose this API to an untrusted network. Signed Ed25519 identities, authenticated registration, TLS, and replay protection belong to Phase 2.
