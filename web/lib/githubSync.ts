import { API } from "@/lib/api/client";

/**
 * The workflow a repo adds as `.github/workflows/orion-sync.yml`. It downloads the codebase agent from this Orion
 * server (/api/downloads/ctx-sync.mjs) and runs it, so the repo needs no copy; ORION_TOKEN is a repository secret.
 */
export function syncWorkflow(branch = "main"): string {
  return `# Sends what changed on ${branch} to Orion, so the team's work items know what engineering shipped.
# Paths that a line starting with "+." in the root .gitignore marks never leave the runner.
name: Orion sync
on:
  push:
    branches: [${branch}]
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Sync changes to Orion
        run: |
          curl -fsSL "$BACKEND_URL/api/downloads/ctx-sync.mjs" -o "$RUNNER_TEMP/ctx-sync.mjs"
          node "$RUNNER_TEMP/ctx-sync.mjs"
        env:
          BACKEND_URL: ${API}
          ORION_TOKEN: \${{ secrets.ORION_TOKEN }}
          CTX_BASE_SHA: \${{ github.event.before }}
`;
}
