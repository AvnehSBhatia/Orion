# Orion web

The dashboard UI (Next.js 16, App Router). It talks to the backend in `server/` over HTTP with the session cookie.

```sh
cd web
npm install
cp .env.example .env.local   # NEXT_PUBLIC_ORION_API=http://localhost:3001
npm run dev                  # http://localhost:3000
```

Checks (CI runs the same): `npx next typegen && npx tsc --noEmit`, `npx eslint .`, `npm run build`.

## Layout

| Path | What it is |
|---|---|
| `app/` | Routes: `/` (the app), `/invite/[token]`, `/reset/[token]`, `/privacy`, plus the 404 and error pages. |
| `lib/api/` | `types.ts` (shapes from `server/src/contract/types.ts` and `docs/api-additions.md`) and `client.ts` (one fetch helper, one stream opener, every resource). |
| `lib/` | Small shared modules: `usePoll`, `time`, `format`, `storage`, `domain`, `status`, `chat`, `defaults`, `errors`, `stars` (graph to map data), `viewer` (open a source or node from anywhere). |
| `components/auth/` | Sign-in gate, session context, consent screen. |
| `components/shell/` | The app frame: header, navigation, account menu, chat dock, intro, and the hooks behind them. |
| `components/dashboard/` | The per-person dashboard (`constellation/` is the embedding view). |
| `components/map/`, `context/`, `project/`, `chat/`, `viewer/` | One folder per feature. |
| `components/settings/`, `components/admin/` | Account settings, Connect Claude Code, and the admin console. |
| `components/ui/` | Primitives shared by every feature. |
| `demo/` | The scripted pitch (Tab types prompts, captions). Built only with `NEXT_PUBLIC_ORION_DEMO=true`; otherwise `orion-demo` resolves to `demo/off.ts` and none of it ships. |
