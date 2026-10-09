# Publishing MeshLink

MeshLink is published from GitHub Actions through [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/). It uses GitHub's short-lived OpenID Connect (OIDC) identity instead of a long-lived `NPM_TOKEN` secret.

## One-time setup

1. Make sure the `@meshlink-ai/meshlink` package belongs to the `meshlink-ai` npm organization. The initial `1.0.0` release is published manually with npm 2FA; later releases use GitHub Actions.
2. In [npm package settings](https://www.npmjs.com/package/@meshlink-ai/meshlink/access), add a **GitHub Actions** trusted publisher:
   - Owner: `rozaqabdul656`
   - Repository: `MeshLink`
   - Workflow filename: `publish.yml`
   - Allowed action: **Publish packages**
3. Use GitHub-hosted runners. GitHub Actions is not supported for npm trusted publishing from a self-hosted runner.

The workflow already has the required permissions: `contents: read` and `id-token: write`. Do **not** add an `NPM_TOKEN` GitHub secret: npm exchanges the job's short-lived GitHub OIDC identity for publish access.

## Release process

Update the version and let npm create the matching Git tag:

```bash
npm version patch
git push --follow-tags
```

The `v*` tag triggers `.github/workflows/publish.yml`. The workflow validates that `v<package.json version>` is the pushed tag, runs the type check and tests, builds the package, then runs `npm publish`.

Use `npm version minor` or `npm version major` for larger releases. Do not create a tag by hand with a version that differs from `package.json`; the workflow will deliberately reject it.

## Retry a failed release

If a release job fails, open **Actions → Publish npm package**, select the failed run for the release tag, and choose **Re-run jobs** after fixing the cause. The workflow safely skips a version that is already available on npm. Bump the version when the package itself needs to change.
