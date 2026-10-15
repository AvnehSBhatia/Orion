# Next steps (handoff, 2026-10-14)

Production work is tracked in [production-checklist.md](production-checklist.md). This file covers the unfinished cleanup.

## Server cleanup

Done: routes are thin (logic in `server/src/`, SSE and NDJSON through `http/stream.ts`), stale comments fixed, `server/src/README.md` written, root README layout updated. Still open: drop `export` from exports nothing imports.

## Web cleanup (not started in the repo)

Plan:
1. Split `web/lib/` into `api/types.ts`, `api/client.ts` (resources grouped, one fetch helper plus a stream opener; every call with `credentials: "include"`), plus `usePoll`, `time`, `format`, `storage`, `domain`, `status`, `chat`, `defaults`.
2. Move demo code (`lib/demo.ts`, `lib/demoScript.ts`, `DemoCaption`) to `web/demo/`.
3. Split `AppShell.tsx` into hooks (workspace, dashboard spec, conversation, ask, intro scroll, toasts) and views in `components/shell/`.
4. Split `StarMap`, `dashboard/Constellation`, `DynamicDashboard` by feature folder (`map/`, `dashboard/constellation/`, `chat/`, `context/`, `viewer/`, `auth/`, `ui/`).

Confirmed dead code: `StarDashboard.tsx` Spotlight (`spot`/`zoomed`/`scale`/`origin`, `onAnswer`); `lib/stars.ts` `teach()`, `Lesson`, `SUGGESTIONS`; `lastId` in AppShell; `saveDashboard` in `lib/orion.ts`; `useDemo()` `goTo`/`toggleHidden`/`total`; `public/{file,globe,next,vercel,window}.svg`.

Duplicates to merge: `useNow`, `DOMAIN_LABEL`, `since()`, `clip`, `isUrl`/`isHttp`, two `ago` formats ("4s ago" in `lib/live.ts` vs "4s" in `dashboard/shared.tsx`), Constellation's own source fetch, the `"orion.org"` storage key (3 places). Keep as is: the two `DOMAINS` arrays (different order on purpose) and the two `initials()` helpers (different rules).

Lint baseline: 9 errors, 2 warnings (AppShell, AuthGate, StarDashboard, Constellation, `orion.ts`). Fix `web/README.md` (still "Constellation", wrong port).

Verify with before/after Playwright screenshots of the main views (clock fixed, animations frozen) so the refactor is pixel-identical.
