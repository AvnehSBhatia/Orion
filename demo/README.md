# Demo product

A tiny fake product for trying the codebase agent's private-path rule. Nothing here runs.

- `src/features/checkout/` is public. Commit a change here and `npm run ctx:sync` sends its diff.
- `src/features/secret-pricing-engine/` and `src/features/unreleased-voice-mode/` are marked `+.` in the root `.gitignore`. They are not checked in. Create a file under one of them and commit it: the sync sends nothing and prints only a count of private files.

Pair it with the mock ingest server in `codebase-agent/` (`npm run mock` there) to see the exact payload. Steps are in `codebase-agent/README.md`.
