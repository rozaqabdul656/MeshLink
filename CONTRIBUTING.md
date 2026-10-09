# Contributing to MeshLink

Thanks for helping improve MeshLink. Phase 1 is deliberately small and security-first: changes should preserve capability scoping, local deny-by-default policy, and the versioned `meshlink/v1` task contract.

## Local development

Requirements:

- Node.js 22 or later
- npm 10 or later

Clone the repository and install its locked dependencies:

```bash
git clone https://github.com/rozaqabdul656/MeshLink.git
cd MeshLink
npm ci
```

Run a development node with the example policy:

```bash
npm run dev:node -- \
  --name local-dev \
  --id local-dev \
  --port 20128 \
  --policy examples/policy.yaml
```

In another terminal, run the MCP adapter:

```bash
npm run dev:mcp -- --node http://127.0.0.1:20128 --caller agent://local-host
```

## Before opening a pull request

Run the complete local gate:

```bash
npm run check
npm test
npm run build
```

Keep pull requests focused. Add or update tests for behavior changes, document public API or policy changes, and never add credentials, private keys, or real infrastructure endpoints to the repository.

## Good first contributions

- New safe capability adapters with explicit input validation and policy examples
- Agent-host integration guides
- Dashboard accessibility and observability improvements
- Remote-routing test cases and documentation
- Clear issue reports with reproduction steps

## Security-sensitive changes

Do not expose a MeshLink node to the public internet in Phase 1. The `x-meshlink-agent` header is a development identity placeholder, not cryptographic authentication. For a vulnerability report, open a private security advisory rather than publishing exploit details in a public issue.

## Maintainer releases

The npm package is released only by the GitHub Actions workflow with npm Trusted Publishing. Follow [docs/PUBLISHING.md](docs/PUBLISHING.md); do not publish from a local machine or add an `NPM_TOKEN` repository secret.
