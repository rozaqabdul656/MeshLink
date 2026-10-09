# Publishing MeshLink

MeshLink is published from GitHub Actions through [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/). It uses GitHub's short-lived OpenID Connect (OIDC) identity instead of a long-lived `NPM_TOKEN` secret.

## One-time setup

1. Make sure the `meshlink` package on npm belongs to the intended npm account or organization. If this is the first release, publish the initial version manually from a trusted local machine with npm 2FA enabled.
2. In the npm package settings, add a **GitHub Actions** trusted publisher:
   - Owner: `rozaqabdul656`
   - Repository: `MeshLink`
   - Workflow filename: `publish.yml`
3. Keep the trusted publisher's first successful publish within npm's setup window. GitHub-hosted runners are required for this OIDC flow.

The workflow already has the required permissions: `contents: read` and `id-token: write`.

## Release process

Update the version and let npm create the matching Git tag:

```bash
npm version patch
git push --follow-tags
```

The `v*` tag triggers `.github/workflows/publish.yml`. The workflow validates that `v<package.json version>` is the pushed tag, runs the type check and tests, builds the package, then runs `npm publish`.

Use `npm version minor` or `npm version major` for larger releases. Do not create a tag by hand with a version that differs from `package.json`; the workflow will deliberately reject it.

## Manual retry

If a release needs a retry, open **Actions → Publish npm package → Run workflow**, select the exact release tag, and run it again after fixing the cause. npm will reject publishing an already-published version; bump the version if the package itself needs to change.
