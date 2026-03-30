# Local Development

## Environment
- Node.js `>=18` is required; the current local setup uses Node `22.x`.
- Install dependencies with `npm install`.
- Runtime configuration is loaded from `.env`. Keep secrets and machine-specific values out of git.

## Common Workflows
- `npm run build`: compile TypeScript into `dist/`.
- `npm run start`: run from source with `ts-node`.
- `npm run start:built`: run the compiled build.
- `node dist/bin/cli.js start`: validate the packaged CLI path directly.
- `npm test`: run the main Jest suite.

## Local Packaging
Keep the tracked `package.json` version unchanged. For personal builds, use a local-only override such as `package.local.json` and exclude it via `.git/info/exclude`, not the tracked `.gitignore`.

Current local packaging pattern:
- public package: `lazy-gravity@0.5.5`
- local package: `lazy-gravity-local@0.5.5-local.YYMMDDHHMM`

Local version rule:
- Keep the public version from tracked `package.json` unchanged.
- Update `package.local.json` for each local build/install.
- Use a traceable timestamp suffix in local builds, for example `0.5.5-local.2603151617`.
- The suffix format is `YYMMDDHHMM` in your local timezone so every build can be traced back to its packaging time.

Use a staged package build when you need a second global install:
1. Build the repo with `npm run build`.
2. Merge `package.json` with `package.local.json` into a temporary staging directory.
3. Pack or install that staged directory as `lazy-gravity-local`.

Recommended command:
- `npm run local:pack`
- This updates `package.local.json` with a fresh `0.5.5-local.YYMMDDHHMM` style version, rebuilds `dist/`, stages the local package metadata, and writes the `.tgz` into the repo root.

This keeps contributor-facing metadata clean while allowing a separate local binary for development.
