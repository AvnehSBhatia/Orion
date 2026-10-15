# Orion production-readiness checklist

Audit of commit `5dc89ac` (branch `avneh`), 2026-10-14. What was done:

- Ran the backend (`server`, :3041) on a copy of `server/data`, with `EMBED_PROVIDER=openrouter` and the chat and extract models `google/gemini-2.5-flash-lite`, from the dev `.env`.
- Ran the web app (`web`, :3040).
- Drove it with Playwright at 1440px and 390px as three accounts: an admin in `northwind` (8,958 sources), a member in `northwind`, and an admin in a brand-new empty org `freshco`.
- Probed the API with curl.
- Ran `vitest`, `tsc`, `eslint` and `npm audit`.

Screenshots are in [`docs/audit/`](audit/).

Each item gives: what to do, why it matters, where, size (S/M/L) and priority. **P0** blocks the first paying customer or a public box. **P1** comes before broad launch. **P2** can come later.

Baseline that already works:
- Server tests: 211/211 pass.
- codebase-agent tests: 15/15 pass.
- `tsc --noEmit` passes in all four packages, all `strict`.
- `npm audit --omit=dev`: 0 vulnerabilities in server and web.
- Cross-org reads return 403 (verified).
- Org ids are regex-validated, so they can't be used for path traversal.
- No `dangerouslySetInnerHTML`; web links are filtered to http(s).

---

## P0 for the first box

1. **Forged commits and cards:** add the acting-as check on `POST /api/ingest/code`. A member posted a card as another user. It showed in everyone's live ticker and in chat answers ("The spoofed card feature shipped today", [`30-mobile-no-preference-after-ask-20s.png`](audit/30-mobile-no-preference-after-ask-20s.png)).
2. **Raw captures:** decide who can see other people's raw captures (page text, screenshots) and enforce it. Today every member can read every colleague's captures.
3. **Request protection:**
   - CSRF Origin check (a cross-origin `text/plain` PATCH changed the org profile).
   - Require `EXTENSION_IDS`.
   - Refuse to start with `AUTH_DISABLED` in production.
   - Force Secure cookies.
   - Security headers.
4. **Abuse and cost:**
   - Body-size caps before `req.json()`.
   - Per-token and per-org rate limits on ingest, chat, ask and MCP.
   - Per-org LLM budget and usage tracking.
   - OpenRouter timeout and retry. Chat failed on 3 of 4 tries during this audit with `NGHTTP2_ENHANCE_YOUR_CALM`, and nothing retried.
5. **Privacy:**
   - OpenRouter `data_collection: "deny"` and pinned providers.
   - Strip sensitive form values and URL query strings in the extension.
   - Per-site exclusions.
   - An employee-monitoring notice and consent screen.
   - Retention and deletion (user, org, captures).
   - Disk encryption.
   - Privacy policy, DPA and subprocessor list.
6. **Ops:**
   - Deploy artifacts (Dockerfile or systemd, Caddy/nginx with TLS).
   - `/api/health`.
   - Prefetch the model and document box sizing.
   - Online SQLite backups with a restore drill.
   - Structured request logs.
   - CI on PRs.
7. **Accounts:**
   - Email on accounts.
   - Invite flow.
   - Password change and reset.
   - Admin account management (disable a user, revoke tokens).
   - A web page to issue a token and connect Claude Code.
8. **Web app:**
   - Never show sample data as if it were live.
   - Show offline and failed states honestly.
   - Let returning users skip the intro.
   - Navigation on phones.
   - Onboarding for an empty org.
   - Keyboard-accessible nav.
   - Remove the swarm, demo and auto-switch code.
9. **Extension:**
   - ~~Rename it from "Constellation" to Orion.~~ Done.
   - Icons.
   - Web Store policy package.
   - Production backend default, HTTPS only.
   - Stop on 401 and back off on 429/5xx.
10. **Tests:** authz tests for every route.

---

## 1. Web UI and UX

### Sign-in ([`01-signin-1440.png`](audit/01-signin-1440.png), [`01-signin-390.png`](audit/01-signin-390.png), [`02-signin-bad-password-1440.png`](audit/02-signin-bad-password-1440.png))

- [ ] **Add the missing account links:** "Forgot password", "Request access / sign up", SSO, and links to the privacy policy and terms. **Why:** a locked-out user has no way back except a CLI run by the operator. **Where:** `web/components/AuthGate.tsx` `LoginForm`. **Size** S (UI only; needs the reset backend in §3). **P0**
- [ ] **Fix the error copy and wiring.** The raw lowercase server string "wrong username or password" shows in body color, isn't styled as an error, and isn't tied to the inputs (`aria-describedby`, `aria-invalid`). Use sentence case, error color and a field association. **Where:** `AuthGate.tsx`, `server/src/auth/service.ts`. **Size** S. **P1**
- [ ] **Make keyboard focus visible on inputs.** They have `outline-none`; the only cue is a border change from `#2e2e2e` to `#ededed`. Add a `focus-visible` ring that meets WCAG 2.4.7/2.4.11. **Where:** `AuthGate.tsx` `field` class. **Size** S. **P1**
- [ ] **Fix the extra alert region.** Two `role=alert` nodes exist after an error, one of them empty (the route announcer plus the message), so screen readers announce oddly. **Where:** `AuthGate.tsx`. **Size** S. **P2**
- [ ] **Replace the blank loading screen.** While `/api/auth/me` is pending the page is solid black (`<div className="min-h-dvh bg-bg" />`). Show the logo or a spinner. **Where:** `AuthGate.tsx:43`. **Size** S. **P2**
- [ ] **Brand the page:** a favicon from Orion art (the default `app/favicon.ico` is in place), OG metadata, and remove the Next/Vercel starter SVGs. **Where:** `web/app/`, `web/public/{next,vercel,file,globe,window}.svg`. **Size** S. **P1**

### First load and the intro ([`03-northwind-first-load-1440.png`](audit/03-northwind-first-load-1440.png), [`06-ask-streaming-1440.png`](audit/06-ask-streaming-1440.png))

- [ ] **Let returning users skip the intro.**
  - **Problem:**
    - Every page load starts in `phase="hero"` (the black-hole hero).
    - The dashboard is reachable only by sending a question, which then plays a 6.4s scroll-scrubbed intro ("Four kinds of work.").
    - Scrolling the wheel 12 times did not enter the app.
    - A returning user can't get to their dashboard without asking something.
  - **Fix:** skip the intro after the first visit (stored flag), add a "Go to dashboard" control, and land signed-in users on the app.
  - **Where:** `web/components/AppShell.tsx` (`phase` state, `sendFromMap`, scrub effect at about lines 600–720).
  - **Size** M. **P0**
- [ ] **Fix the phone intro, which appears to get stuck.** At 390px with touch emulation the app was still in the blurred intro 20s after asking, and the answer floated over a dimmed hero ([`30-mobile-no-preference-after-ask-20s.png`](audit/30-mobile-no-preference-after-ask-20s.png)). With reduced motion it worked ([`30-mobile-reduce-after-ask-20s.png`](audit/30-mobile-reduce-after-ask-20s.png)). Verify on a real iOS or Android device, and skip the scrub on touch devices. **Where:** `AppShell.tsx` scrub effect. **Size** M. **P0**
- [ ] **Stop clipping the subtitle at 390px.** "Hi Audit. Ask what your team is" is cut off (seen on the 390px signed-in hero). **Where:** `components/ui/ruixen-moon-chat.tsx`. **Size** S. **P1**
- [ ] **Remove the demo leftovers from the production bundle**, or gate them behind a build flag:
  - The "demo" org shows as a "sample" in the org picker and is chosen by `defaultOrg`.
  - The page auto-switches to any newly created org ("X just came online. Switched to it.", `pickOrg`).
  - It auto-follows the founder user (`DEFAULT_USER`).
  - `?demo=1` key handling (`useDemoKeys`), `DemoCaption`, and `lib/demoScript.ts`.

  **Why:** in a multi-tenant product, switching someone's view on its own is confusing, and it's a footgun if an admin can see several orgs. **Where:** `AppShell.tsx:200-260`, `lib/live.ts:183`, `lib/demo.ts`, `components/DemoCaption.tsx`. **Size** M. **P0**
- [ ] **Remove the offline fake-data fallback.** When the first `/api/orgs` poll fails, the page draws the bundled sample `STARS` and answers chat from sample data (`answer(text)`, the "No backend: answer from the sample data so the page still demos" path). A customer would see made-up projects as if they were real. **Where:** `AppShell.tsx` (`offline ? STARS`, `ask()`), `lib/stars.ts`. **Size** S. **P0**

### Dashboard, chat and ask ([`07-ask-answer-dashboard-1440.png`](audit/07-ask-answer-dashboard-1440.png), [`10-reshape-dashboard-1440.png`](audit/10-reshape-dashboard-1440.png), [`11-chat-answer-1440.png`](audit/11-chat-answer-1440.png), [`27-slow-model-6s-1440.png`](audit/27-slow-model-6s-1440.png))

- [ ] **Make chat failures actionable.** Chat failed 3 of 4 times in this run. The user sees "Orion is unreachable (model provider failed). Try again." in a one-line pill, with no retry button and the internal error text included. Add a retry button, friendlier copy, and a different message for "the model failed" versus "the server is down". **Where:** `AppShell.tsx` `ask()` catch, `components/ChatPanel.tsx`. **Size** S. **P0**
- [ ] **Add progress, cancel and a timeout for slow answers.** With chat delayed 25s, the reply area showed only a blinking caret ([`27`](audit/27-slow-model-6s-1440.png)). Add a "thinking…" state, a Stop button (abort the fetch), and a client-side timeout. **Where:** `AppShell.tsx` `ask()`, `lib/orion.ts` `chatStream`. **Size** S. **P1**
- [ ] **Stop the chat dock covering content.** The reply pill, quick actions and composer float over the dashboard list and the map's bottom labels at 1440, hiding rows and nodes ([`07`](audit/07-ask-answer-dashboard-1440.png), [`09-view-map-1440.png`](audit/09-view-map-1440.png)). Reserve space or make the dock collapsible. **Where:** `AppShell.tsx` dock (`--dock`), `components/StarMap.tsx`. **Size** M. **P1**
- [ ] **Make "Reset to my role" more prominent.** "Focus my dashboard on blocked work" persisted server-side a "Blocked work" dashboard that showed 0 in scope while 154 items were at risk ([`10`](audit/10-reshape-dashboard-1440.png)). It stuck across sessions, and the only way back was the small "Reset to my role" button. Also show *why* it's empty ("no item is marked blocked; 154 are at risk"). **Where:** `server/src/steer/dashboard.ts`, `web/components/dashboard/DynamicDashboard.tsx`. **Size** M. **P1**
- [ ] **Rewrite internal jargon in the UI copy:** "Total nodes", "Sellable nodes", "Nodes by domain", "222 NODES · 8959 SOURCES", "ROLE 1m", "Northwind Audit Admin Dashboard" ([`07`](audit/07-ask-answer-dashboard-1440.png)). Use "projects" or "work items" and a readable title. **Where:** `server/src/steer/dashboard.ts` (titles), `web/components/dashboard/widgets.tsx`, `cards.tsx`. **Size** S. **P1**
- [ ] **Fix the wrong empty-state copy.** "Waiting for the first capture" appears in an org with 8,960 sources (Activity card, [`10`](audit/10-reshape-dashboard-1440.png)). "Quiet for the last 2 minutes" (Who feeds what) is a demo-scale window. **Where:** `web/components/dashboard/widgets.tsx`, `web/components/context/Lanes.tsx`. **Size** S. **P1**
- [ ] **Filter garbage extraction output.** Node detail shows "What to do: Update 230.", "Update 257.", and "What to read: DuckDuckGo – Protection. Privacy. Peace of mind." ([`12-node-detail-1440.png`](audit/12-node-detail-1440.png), [`07`](audit/07-ask-answer-dashboard-1440.png)). Validate `nextStep` and `read` in `llm/extract.ts` (minimum length, no bare numbers, drop search-engine and new-tab pages) and add an eval case. **Where:** `server/src/llm/extract.ts`, `server/src/eval/`. **Size** M. **P1**
- [ ] **Persist conversations server-side.** History lives only in `sessionStorage` (`orion:chat:<org>:<user>`), so it's lost when the tab closes and isn't cleared on sign-out (verified that the key remains after sign-out). Store it server-side per user and clear client storage on sign-out. **Where:** `AppShell.tsx` conversation effects, `AuthGate.tsx` logout. **Size** M. **P1**
- [ ] **Clean up reply formatting:** stray space before the period ("shipped today ."). **Where:** `server/src/llm/chat.ts` citation renumbering. **Size** S. **P2**

### Map, Context, Blocked, node detail ([`09-view-map-1440.png`](audit/09-view-map-1440.png), [`09-view-context-1440.png`](audit/09-view-context-1440.png), [`09-view-blocked-1440.png`](audit/09-view-blocked-1440.png), [`12-node-detail-1440.png`](audit/12-node-detail-1440.png))

- [ ] **Fix map label collisions:** hub labels are clipped behind nodes ("GINEERING", "MARKETIN…"), project labels are truncated ("Configurable environm…", "10 technical talks I'…"), and only 5 per hub are visible ("+96 MORE"). **Where:** `components/StarMap.tsx`. **Size** M. **P1**
- [ ] **Make the Blocked view's empty state honest.** With 0 blocked items it shows "No links yet. Chains appear when captures mention…" and "No topics yet", even though Context shows 8 chains and 29 topics for the same org. Say "Nothing is blocked" and link to at-risk work. **Where:** `AppShell.tsx` (`view === "blocked"`), `components/context/*`. **Size** S. **P1**
- [ ] **Keep "Sign out" from overlapping the node-detail sidebar.** It's a fixed bottom-left button that sits on top of the sidebar's project list and the mobile composer ([`12`](audit/12-node-detail-1440.png), [`30-mobile-reduce-after-ask-20s.png`](audit/30-mobile-reduce-after-ask-20s.png)). Move it into a user menu in the header. **Where:** `AuthGate.tsx:58`. **Size** S. **P0** (it's the only sign-out control)
- [ ] **Source viewer:** the scripted run couldn't reach it from the dashboard (no stable selector for citations). Add `data-testid`s, then verify it traps focus (it is `role=dialog`) and returns focus on close. **Where:** `components/SourceViewer.tsx`. **Size** S. **P1**

### Empty org and onboarding ([`20-empty-org-hero-1440.png`](audit/20-empty-org-hero-1440.png), [`21-empty-org-after-ask-1440.png`](audit/21-empty-org-after-ask-1440.png), [`22-empty-org-context-1440.png`](audit/22-empty-org-context-1440.png))

- [ ] **Build a first-run checklist for an empty org.**
  - **Problem:** a new admin gets the same hero, then a "Freshco Newbie Dashboard" full of zeros, "Nothing here yet", and chat answering "I don't have enough information". The Context empty state says "Run the swarm and this fills in" (dev copy, `AppShell.tsx:915`).
  - **Fix:** a checklist with these steps:
    - Install the extension (Web Store link), then sign in.
    - Invite teammates.
    - Connect Claude Code (show a token and the `claude mcp add` line).
    - Add the CI workflow.
    - Set the org profile.
  - Show progress, and hide the empty charts until there's data.
  - **Where:** new `web/components/Onboarding.tsx`, `AppShell.tsx`.
  - **Size** L. **P0**
- [ ] **Use real display names.** The org shows as "freshco" and the person as "newbie" because `account.ts` uses ids as names. Collect the org display name and person name at creation. **Where:** `server/scripts/account.ts`, signup route. **Size** S. **P1**

### Errors and offline ([`24-backend-down-at-load-1440.png`](audit/24-backend-down-at-load-1440.png), [`25-backend-down-mid-session-1440.png`](audit/25-backend-down-mid-session-1440.png), [`26-backend-down-ask-1440.png`](audit/26-backend-down-ask-1440.png), [`28-session-expired-1440.png`](audit/28-session-expired-1440.png))

- [ ] **Show an offline banner mid-session.** When the backend goes away, polls fail silently. The header keeps showing "LIVE · 222 NODES" with stale data ([`26`](audit/26-backend-down-ask-1440.png)) and nothing says the data is stale. Add a "Reconnecting… last updated 2 min ago" banner and drop the LIVE dot. **Where:** `lib/orion.ts` `usePoll`, `AppShell.tsx` `LiveStatus`. **Size** S. **P0**
- [ ] **Polish the down-at-load message.** It reads "Could not reach the Orion server: Failed to fetch" and shows the raw error ([`24`](audit/24-backend-down-at-load-1440.png)). Add friendly copy, automatic retry with backoff, and a status page link. **Where:** `AuthGate.tsx:44`. **Size** S. **P1**
- [ ] Session expiry is handled well: the page returns to sign-in with "Your session ended. Sign in again." ([`28`](audit/28-session-expired-1440.png)). **Keep it**, and add preserving the unsent composer text. **Size** S. **P2**
- [ ] **Silence noisy 401s:** every load logs 2–5 `401 (Unauthorized)` console errors before sign-in, because polls start before auth resolves. **Where:** `AuthGate.tsx`, `lib/orion.ts`. **Size** S. **P2**
- [ ] **Add a branded 404 and error page.** The default Next 404 shows at `/anything`. **Where:** `web/app/not-found.tsx`, `web/app/error.tsx`. **Size** S. **P1**

### Responsive (390px) ([`07-ask-answer-dashboard-390.png`](audit/07-ask-answer-dashboard-390.png), [`10-reshape-dashboard-390.png`](audit/10-reshape-dashboard-390.png), [`30-mobile-reduce-after-ask-20s.png`](audit/30-mobile-reduce-after-ask-20s.png))

- [ ] **Give phones a way to navigate.** The nav (Home / Map / Context / Blocked / Ask) is `max-sm:hidden` with no menu to replace it, so Map, Context and Blocked can't be reached on a phone. **Where:** `AppShell.tsx:837`. **Size** S. **P0**
- [ ] **Keep the quick-action chips on screen at 390px.** They scroll off to the right ("F…" cut off). The composer and Sign out overlap. **Where:** `AppShell.tsx` dock. **Size** S. **P1**
- [ ] **Fix the 10s black screen after reshaping on a phone.** With full motion, the screen sat black with only a progress line for about 10s ([`10-reshape-dashboard-390.png`](audit/10-reshape-dashboard-390.png)). **Where:** `AppShell.tsx` entering phase. **Size** M. **P1**
- [ ] No horizontal overflow at 390 (scrollWidth equals innerWidth). Keep it that way with a visual regression test. **P2**

### Accessibility

- [ ] **Make the nav real links or buttons.**
  - The nav items are `<span>`s from `RandomLetterSwap`.
  - The accessible text reads "H H o o m m e e" (duplicated letters for the animation).
  - There's no `aria-current`.
  - In the hero phase only the composer, 3 chips and Sign out are tabbable: no nav, org picker or person picker.

  Use `<a>` or `<button>` with `aria-current="page"`, put the animated letters in `aria-hidden`, and keep the real label in the accessible name. **Where:** `components/ui/random-letter-swap.tsx`, `m-random-letter-swap-1.tsx`, `AppShell.tsx` `onNav`. **Size** S. **P0**
- [ ] **Fix low contrast:** `--faint: #5a5a5a` on `#000` is about 2.9:1, under the 4.5:1 AA minimum. It's used for Sign out, "Enter to send" and secondary labels. Raise it to at least `#767676`. **Where:** `web/app/globals.css:9`. **Size** S. **P1**
- [ ] **Label the composer.** The textarea has no `<label>` or `aria-label` (placeholder only) and `outline-none`. **Where:** `components/ui/ruixen-moon-chat.tsx`, `components/ui/textarea.tsx`. **Size** S. **P1**
- [ ] **Add a skip link and landmarks:** a `<main>` landmark, a skip-to-content link, and a heading order (the app has no `h1` once the hero is gone). **Where:** `AppShell.tsx`, `app/layout.tsx`. **Size** S. **P1**
- [ ] **Give the map a text equivalent.** It's a canvas and SVG `role=group` with star buttons (tabbable once in the app) and has no list view. Context and Blocked partly cover it. Run an axe pass and a VoiceOver walkthrough. **Where:** `components/StarMap.tsx`. **Size** M. **P1**
- [ ] **Respect reduced motion everywhere.** The WebGL black hole and the GSAP scrub should stop under `prefers-reduced-motion`; the app does switch to `phase="app"` there (good), but the background shader keeps animating. The page also logs "GPU stall due to ReadPixels" in Chromium. **Where:** `components/ui/black-hole.tsx`. **Size** S. **P1**
- [ ] **Add automated a11y checks:** `@axe-core/playwright` in the e2e suite (§6). **Size** S. **P1**

### Multi-user view

- [ ] **Remove or restrict the "Viewing as" person picker.** It lets any member switch to any colleague and load their dashboard, feed and brief, and it triggers paid dashboard builds saved under the colleague's name (see §3). Restrict it to admins, label it clearly as impersonation, and audit-log it. **Where:** `AppShell.tsx` person `Picker`, server read routes. **Size** S. **P0**

---

## 2. Backend and infrastructure

### Deploy

- [ ] **Add deploy artifacts:** a Dockerfile or systemd units for `server` and `web`, a Caddy or nginx config with TLS, `client_max_body_size ~3m`, and one domain or sibling subdomains. Today the README's "Deploy on one box" is all there is. **Where:** repo root, `README.md`. **Size** M. **P0**
- [ ] **Add `GET /api/health`:** check the DB opens, auth.db opens, the embedder is ready and the OpenRouter key is present. Today it's a 404. **Where:** `server/app/api/health/route.ts`. **Size** S. **P0**
- [ ] **Prefetch the model and document box sizing.** The EmbeddingGemma ONNX model (~522MB) downloads on first use. Run `npm run embed-models` in the build onto a persistent `MODEL_CACHE_DIR`. An image embed peaks at about 2GB RAM inside the API process. Document the minimum box (for example 4 vCPU / 8GB) and an OOM-restart policy. **Where:** `server/scripts/embed-models.ts`, `server/src/llm/gemma.ts`, README. **Size** S. **P0**
- [ ] **Pin Node and native modules:** add `engines` and `.nvmrc` (better-sqlite3, onnxruntime and sharp are native), use `npm ci` only, and stop using carets for `next` in `server/package.json` (web pins it). **Size** S. **P1**
- [ ] **Validate env at boot.** Fail fast without `OPENROUTER_API_KEY`, with `COOKIE_SECURE!=true` in production, with `AUTH_DISABLED=true` in production, or with `UI_ORIGIN` still on localhost. **Where:** `server/src/config.ts`. **Size** S. **P0**
- [ ] **Fix inconsistent ports and defaults.** server dev is :3001; `docs/mcp.md` and the extension default say :3000; `web/.env.example` comments say "repo root". **Where:** `docs/mcp.md`, `extension/src/settings.ts`, `web/.env.example`. **Size** S. **P1**
- [ ] **Stop seeding the `demo` org in production.** It's created and seeded on first touch whatever the environment. **Where:** `server/src/server/deps.ts:26,45`, `server/src/contract/schemas.ts:9`. **Size** S. **P1**
- [ ] **Clean up hackathon names:** "Constellation" in `web/README.md` and the extension manifest, `data/constellation.db` (an orphan file in DATA_DIR), and "Team A/B/C" in the READMEs. **Size** S. **P1**

### SQLite

- [ ] **Add online backups:** schedule `db.backup()` / `VACUUM INTO` or run Litestream for `orgs/*.db` and `auth.db`, ship them off-box, and do a monthly restore drill. Using `cp` on a live WAL DB isn't safe. **Where:** new `server/scripts/backup.ts`, ops doc. **Size** M. **P0**
- [ ] **Add schema versioning:** numbered migrations keyed on `PRAGMA user_version` (0 today). The current setup is `CREATE TABLE IF NOT EXISTS` plus additive `addColumns`. **Where:** `server/src/db/store.ts:516-538`, `server/src/auth/db.ts:31-55`. **Size** M. **P1**
- [ ] **Handle concurrent processes.** Set `busy_timeout` and `synchronous=NORMAL` explicitly. Handles are cached per process in `globalThis`, and the in-memory limiter and background jobs assume one process, so document "one `next start` process" or move the shared state into the DB. The `account.ts` CLI writes alongside the live server. **Where:** `server/src/db/store.ts:517`, `server/src/server/deps.ts`. **Size** S. **P1**
- [ ] **Add retention and handle disk growth.**
  - Measured on `northwind.db` (71.9MB): 764 extension captures from about 2 hours kept 10.8MB of JPEG (avg 14.5KB). Embeddings take 26MB.
  - Nothing ever deletes sources or screenshots, and there's no VACUUM.
  - Projection: about 7MB of screenshots per employee per day, so roughly 10GB a month for 50 seats.
  - Fix: a screenshot TTL, a source TTL, VACUUM, and a disk alert.
  - **Where:** `server/src/db/store.ts`, `server/src/ingest/pipeline.ts`.
  - **Size** M. **P0**
- [ ] **Sweep expired sessions.** They're only deleted when presented. **Where:** `server/src/auth/db.ts:110`. **Size** S. **P2**

### Background jobs

- [ ] **Make background jobs durable.**
  - Maintenance, retrain, clusters, digests, prune and post-ingest refresh are all in-memory `setTimeout`s and promise chains inside the Next process.
  - Seen in this run: "Extraction skipped (502: model provider failed). Storing the source without graph changes." The capture was stored permanently with no graph update and is never retried.
  - Also seen: "refresh after ingest failed … embedding provider failed".
  - Fix: a jobs table (or a "dirty since" marker), a retry queue for failed extraction and embedding, re-run on boot, and visibility into jobs.
  - **Where:** `server/src/pseudo/maintain.ts:93-118`, `server/src/ingest/pipeline.ts:123-157`.
  - **Size** M. **P1** (extraction retry: **P0**, or data is silently lost)
- [ ] **Chunk embedding batches.** OpenRouter rejected a batch: "The total text input size exceeds 8 MB" (400). Split batches by bytes. **Where:** `server/src/llm/embed.ts`. **Size** S. **P0**
- [ ] **Shut down gracefully:** on SIGTERM, drain in-flight ingests and close the SQLite handles. **Where:** `server/src/server/deps.ts`. **Size** S. **P2**

### Limits, timeouts, LLM cost

- [ ] **Add timeouts and retries to OpenRouter calls.** Use an `AbortSignal` timeout (for example 30s for chat, 60s for extraction) and exponential backoff on 429, 5xx and HTTP/2 stream errors. Today `fetch` has no timeout, and the only retries are for "reasoning mandatory" and bad JSON. In this run `NGHTTP2_ENHANCE_YOUR_CALM` and `ECONNRESET` failed chat, ask, extraction and maintenance outright. `maxDuration` does nothing under `next start`. **Where:** `server/src/llm/openrouter.ts:48-122`, `server/src/llm/embed.ts:75`. **Size** S. **P0**
- [ ] **Add a per-org LLM budget.** Read `usage` from each OpenRouter response, store tokens and cost per org per day, enforce a cap and a kill switch, and show it to admins. One shared key, no limits. **Where:** `server/src/llm/*`, new `usage` table. **Size** M. **P0**
- [ ] **Add rate limits beyond login.**
  - Per token, user and org on `/api/ingest/capture` (the extension posts every 5s per source per employee), `/api/ingest/code`, `/api/chat`, `/api/dashboard/ask`, `/api/mcp` and `/api/auth/signup`.
  - The login limiter is in memory per process.
  - **Where:** `server/src/auth/ratelimit.ts`, `server/src/server/http.ts` `route()`.
  - **Size** M. **P0**
- [ ] **Cap request bodies before parsing.** A 20MB capture body was buffered in full and hung for 60s. Check `Content-Length` or stream with a byte cap before `req.json()`, and add `.max()` to `title`, `url`, `diff` and `redactions`. **Where:** `server/src/server/http.ts` `scopedBody`, `server/src/contract/schemas.ts:18-55`. **Size** S. **P0**
- [ ] **Keep heavy image work off the request path.** Keep `INGEST_IMAGES=light` in production and move pruning, OCR and image embeds to a worker process, so interactive requests don't wait behind CPU-bound embeds. **Where:** `server/src/ingest/pipeline.ts:133`. **Size** M. **P1**

### Observability

- [ ] **Log structured requests:** a JSON line per request with request id, org, user, route, status and latency, using a wrapper in `route()`. Today there are 26 bare `console.*` calls. **Where:** `server/src/server/http.ts`. **Size** S. **P0**
- [ ] **Add error tracking** (Sentry or similar) in server and web. Unhandled errors return "internal error" and the stack goes only to stdout. **Size** S. **P1**
- [ ] **Add metrics:** ingest rate per org, extraction latency and failure rate, embed queue depth, LLM spend, DB size per org, and extension heartbeats (last capture per user). **Size** M. **P1**
- [ ] **Stop logging captured content.** Logs include up to 500 characters of provider bodies and model output, which can contain captured page content. **Where:** `server/src/llm/openrouter.ts:79,122`, `server/src/llm/chat.ts:251`. **Size** S. **P1**
- [ ] **Set up an uptime monitor and alerting** on `/api/health`, disk usage, and the backup job. **Size** S. **P1**

### CI and dependencies

- [ ] **Run CI on every PR:** server `vitest`, `tsc` in all four packages, web `eslint`, both `next build`s, the extension build, and codebase-agent tests. The only workflow today is `.github/workflows/ctx-sync.yml`, which triggers on `main` (the main branch is `team-a/extension`). **Where:** `.github/workflows/ci.yml`. **Size** M. **P0**
- [ ] **Automate dependency updates** with Dependabot or Renovate, plus `npm audit` in CI. **Size** S. **P1**

---

## 3. Security, privacy and compliance

### Who can call what

All routes go through `route()` in `server/src/server/http.ts`. Cross-org access returns 403 (verified).

| Route | Problem |
|---|---|
| `POST /api/ingest/code` | **No acting-as check.** A member posted a card attributed to another user (verified). |
| `GET /api/sources/[id]`, `/image`, `/activity`, `/context`, MCP `read_document` / `get_source` | Any member reads every colleague's raw page text and screenshots. |
| `GET /api/feed`, `brief`, `context`, `dashboard` | `userId` can be any colleague. A dashboard GET for someone else runs and saves a paid LLM build. |
| `POST /api/chat`, `dashboard`, `dashboard/ask`, `ingest/capture`, `users` | Acting-as check is present. |
| `PATCH /api/orgs/[id]`, `POST /api/auth/accounts` | Admin-only (verified). |
| `/api/mcp` | Bearer token or cookie. Under `AUTH_DISABLED`, org and user come from the URL or headers. |

- [ ] **Add the acting-as check to code ingest.** `commitAuthor` trusts `body.userId`. **Where:** `server/app/api/ingest/code/route.ts:11`, `server/src/ingest/pipeline.ts:269`. **Size** S. **P0**
- [ ] **Define who sees raw captures.** For example, the owner and admins see raw sources and screenshots, and the whole org sees extracted nodes. Enforce it in routes and MCP tools. **Size** M. **P0**
- [ ] **Limit `userId` on read routes to the caller or an admin.** `scopedQuery({user:true})` only fills in a default; it doesn't enforce it. **Where:** `server/app/api/{feed,brief,context,dashboard}/route.ts`. **Size** S. **P1**
- [ ] **Block CSRF.** On cookie-authenticated writes, require `Content-Type: application/json` and check `Origin` / `Sec-Fetch-Site` against `UI_ORIGIN`. A `text/plain` PATCH with `Origin: https://evil.example` changed the org profile (verified). `SameSite=Lax` doesn't stop sibling subdomains, which is the deployment the README recommends. **Where:** `server/src/server/http.ts:84-98`. **Size** S. **P0**
- [ ] **Lock down CORS for extensions.** With `EXTENSION_IDS` empty, any `chrome-extension://` origin gets credentialed CORS (verified). Require it whenever auth is on. **Where:** `server/src/server/http.ts:26`, `config.extensionIds`. **Size** S. **P0**
- [ ] **Refuse to start with `AUTH_DISABLED=true`** when `NODE_ENV=production` or the server binds beyond localhost. **Where:** `server/src/config.ts`, `app/api/mcp/route.ts:25`, `app/api/orgs/route.ts:16`. **Size** S. **P0**
- [ ] **Set security headers:** CSP, HSTS, `frame-ancestors`/X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. None are set today. **Where:** `server/next.config.ts`, `web/next.config.ts` `headers()`, or the proxy. **Size** S. **P0**
- [ ] **Force `COOKIE_SECURE` in production** and use a `__Host-` cookie prefix. **Where:** `server/src/auth/request.ts:38`. **Size** S. **P0**

### Sessions, passwords, accounts

- [ ] **Self-service password change, emailed reset and admin reset.** Today these exist only as `scripts/account.ts password`. **Size** M. **P0**
- [ ] **Add email to accounts and an invite flow:** an emailed one-time link with an expiry, so admins don't pick plaintext passwords. Usernames are global with one org each. Admin account creation accepts an existing `userId`, which adds a second login to an existing person. **Where:** `server/src/auth/db.ts:35-42`, `server/src/auth/service.ts:52`. **Size** M. **P0**
- [ ] **Admin API and console for accounts:** list accounts, disable or delete one (revoking its tokens), promote or demote admins, list and revoke org tokens. Today `/api/auth/accounts` only supports POST. **Size** M. **P0**
- [ ] **Harden sessions.** Add an idle timeout and rotation on login, and stop returning the raw session token in the login JSON. Sessions currently last a fixed 30 days. **Where:** `server/src/auth/db.ts:16`, `app/api/auth/login/route.ts:15`. **Size** S. **P1**
- [ ] **Harden API tokens:** expiry, scopes (ingest-only for the extension, read-only for MCP) and last-used time. The extension's "Sign out" doesn't revoke its token. **Where:** `server/src/auth/db.ts:93`, `extension/src/options.ts:59`. **Size** M. **P1**
- [ ] **Rework the login limiter.** 10 wrong passwords lock out the real user (a cheap DoS, verified). Without `TRUST_PROXY` all clients share one IP bucket. Spraying many usernames is unlimited, and counts reset on restart. Count per username and per IP, and persist the counts. **Where:** `server/src/auth/ratelimit.ts`, `server/src/auth/request.ts:47`. **Size** M. **P1**
- [ ] **Password policy:** keep the 8-character minimum and add a breached and common-password check ("aaaaaaaa" was accepted). Add SSO/SAML and 2FA for enterprise. **Size** S (policy) / L (SSO). **P1**
- [ ] **Audit log:** logins and failures, token create and revoke, account changes, org edits, impersonation ("viewing as"), exports and deletions. **Where:** a new `audit` table in auth.db. **Size** M. **P1**
- [ ] **Raise the scrypt cost** for new hashes (N=2^17). **Where:** `server/src/auth/crypto.ts`. **Size** S. **P2**

### Data lifecycle

- [ ] **Retention per org,** configurable (for example raw sources and screenshots N days, nodes kept), with a scheduled purge and VACUUM. **Size** M. **P0**
- [ ] **Deletion:** a user deletes their own captures (one, a time range, or all); an admin deletes a user and everything derived (embeddings, touches, `source_changes`); an org can be deleted. Today the only path is a whole-org reset at `store.ts:1203`. **Size** L. **P0**
- [ ] **Export:** per user (GDPR Art. 15 / CCPA right to know) and per org (offboarding). **Size** M. **P1**
- [ ] **Encrypt at rest:** disk-level encryption on the box and `chmod 700 DATA_DIR`. Screenshots and page text are stored in plaintext SQLite. **Size** S. **P0**

### Third parties and capture

- [ ] **Use OpenRouter's privacy settings.** Send `provider: { data_collection: "deny" }` and pin allowed providers (no providers that train on or log prompts; decide whether China-hosted DeepSeek endpoints are allowed). Today requests send only `require_parameters`. **Where:** `server/src/llm/openrouter.ts:60`, `server/src/llm/chat.ts`. **Size** S. **P0**
- [ ] **Document what leaves the box.**
  - **Extraction:** the full URL (with query strings), the title, up to 60k characters of page text (including typed form values), the org profile, and the author's name and role (`llm/extract.ts:51-63,230`).
  - **Chat:** context excerpts and history.
  - **Embeddings:** page text, if `EMBED_PROVIDER=openrouter` (the current dev `.env`), goes to Google.
  - **Screenshots:** stay local (Gemma only).

  This goes into the privacy policy and the subprocessor list. **Size** S. **P0**
- [ ] **Scrub in the extension before upload.** `content.ts:21` copies every non-password input's live value. Skip `autocomplete=cc-*`, `one-time-code`, and fields that look like an SSN, IBAN or token. Strip URL query strings and fragments. **Where:** `extension/src/content.ts`, `extension/src/background.ts:289`. **Size** M. **P0**
- [ ] **Per-site exclusions:** a denylist managed by the admin plus a personal one, blocking banking, health, HR, password-manager and webmail domains by default, plus a "pause for N minutes" control. Never capture incognito, and write that policy down. **Where:** `extension/src/background.ts:181-268`, `extension/src/capture.ts:46`, org settings. **Size** M. **P0**
- [ ] **Enforce redaction on the server.** Today `redactions` are only recorded ("already painted by the extension", `contract/types.ts:195`). Add org-defined masking patterns, applied before the LLM sees the text. **Size** M. **P1**

### Compliance

- [ ] **Monitoring notice and consent.** Show a first-run notice in the extension with text the admin sets (what's captured, who sees it, retention), require explicit acknowledgement, keep a visible recording indicator, and make pause one click. The manifest description is the only notice today. Covers NY Civ. Rights §52-c, CT, DE, GDPR Art. 13/88, and EU works councils. **Where:** `extension/static/{popup,capture,options}.html`. **Size** M. **P0**
- [ ] **Legal documents:** a privacy policy, terms, a DPA template, the subprocessor list (OpenRouter and its routed providers, plus the host) and a data residency statement. **Size** M. **P0**
- [ ] **A DPIA template for customers.** Systematic employee monitoring triggers GDPR Art. 35. **Size** S. **P1**
- [ ] **A CCPA notice at collection** for California employees. **Size** S. **P1**
- [ ] **SOC 2 prep:**
  - Access reviews (needs the admin console).
  - Audit log.
  - Backups plus a restore test.
  - Change management through CI.
  - Vulnerability scanning.
  - Incident response runbook.
  - Encryption at rest.
  - Vendor review of OpenRouter.

  **Size** L. **P1**
- [ ] **Secrets:** inject them through systemd credentials or a secret manager instead of a plaintext `server/.env`, and document how to rotate the OpenRouter key. **Size** S. **P1**

---

## 4. Product

- [ ] **Org creation:** a self-serve or sales-assisted signup UI. `POST /api/auth/signup` exists behind `ALLOW_SIGNUP` but has no web form, so orgs are created with `scripts/account.ts` today. **Size** M. **P1** (CLI is fine for customer #1 if an operator runs it)
- [ ] **Invite teammates from the web:** an admin page that sends invites and shows pending and accepted ones. Today it's admin `POST /api/auth/accounts` with no UI. **Size** M. **P0**
- [ ] **A "Connect Claude Code" page:** issue a scoped token in the UI and show a copyable `claude mcp add --transport http orion https://<host>/api/mcp --header "Authorization: Bearer …"`, plus Cursor and Codex variants and a test-connection button. Today tokens come from the CLI or a hand-written curl. **Where:** `server/app/api/auth/tokens/route.ts`, new web page, `docs/mcp.md`. **Size** M. **P0**
- [ ] **Extension install flow:** a Web Store link in onboarding, the production backend URL as the default (or `chrome.storage.managed` for enterprise force-install with org and URL pinned), and sign-in that confirms the org. **Where:** `extension/src/settings.ts` (default is now `http://localhost:3001`; production URL still needed), `extension/src/options.ts`. **Size** M. **P0**
- [ ] **Admin console:** members, roles, deactivate, tokens, capture settings (exclusions, retention, screenshot on or off, notice text), org profile (`PATCH /api/orgs/[id]` exists with no UI), and usage and spend. **Size** L. **P1**
- [ ] **Personal settings:** what's captured, pause, my exclusions, my data (view, delete, export), and password. **Size** M. **P1**
- [ ] **Billing and plans:** seat counting, Stripe, and plan limits tied to the LLM caps. Manual invoicing is fine for the first customer. **Size** L. **P1**
- [ ] **Notifications:** email or Slack digests, "extension stopped capturing" and "token revoked" alerts to the user, and LLM budget alerts to the admin. **Size** M. **P2**
- [ ] **Customer setup for the codebase agent:** a guide to install it in a repo (copy the workflow, set `BACKEND_URL`, `ORION_ORG_ID` and `ORION_TOKEN`). The workflow triggers only on `main`, the org defaults to `demo`, and the README says "(Team B)". **Where:** `codebase-agent/README.md`, `.github/workflows/ctx-sync.yml`, `codebase-agent/src/ctx-sync.ts:6,64`. **Size** S. **P1**
- [ ] **Docs and support:** a public docs site (getting started, extension, MCP, CI, security and privacy FAQ), a support email or in-app help link, and a status page. **Size** M. **P1**

### Chrome extension and Web Store

- [x] **Rename to Orion.** Done in the extension cleanup (5af64f7). The manifest said "Constellation" and logs said `[constellation]`. **Where:** `extension/static/manifest.json`, `extension/src/background.ts`. **Size** S. **P0**
- [ ] **Add icons and store assets:** 16, 48 and 128px `icons` in the manifest (none today), store screenshots and a promo tile. **Size** S. **P0**
- [ ] **Web Store policy package:**
  - Privacy policy URL.
  - Single-purpose statement.
  - A justification for each permission: `<all_urls>`, `scripting`, `desktopCapture`, `activeTab`, `alarms`, `storage`.
  - The Limited Use disclosure (page HTML, form values and screenshots go to the server and the LLM).

  Consider `optional_host_permissions` instead of `<all_urls>`, since users pick their tabs. **Size** M. **P0**
- [ ] **Allow only HTTPS backends** (localhost excepted), so tokens and captures never travel in cleartext. **Where:** `extension/src/settings.ts:6`, `extension/src/options.ts:40`. **Size** S. **P0**
- [ ] **Handle errors properly.** On 401, stop capturing and ask the user to sign in again. On 429 or 5xx, back off and keep a small offline queue. Today it keeps posting every 5s after a revoked token and only sets `lastError`. **Where:** `extension/src/background.ts:186-210,298-317`. **Size** S. **P0**
- [ ] **Revoke the token on sign-out:** call `DELETE /api/auth/tokens/[id]`. **Where:** `extension/src/options.ts:59-62`. **Size** S. **P1**
- [ ] **Persistent redaction rules.** "Hide something" works only while capturing is stopped. **Where:** `extension/src/popup.ts`. **Size** M. **P2**
- [ ] **Version handshake:** the backend checks extension version compatibility and tells the user to update. The version is set by hand (0.6.1). **Size** S. **P2**

---

## 5. Code quality and tests

- [ ] **Route authz tests:** for each `server/app/api/**/route.ts`, cover signed out (401), cross-org (403), member vs admin, acting-as, and the happy path. There are no route handler tests today; follow the pattern in `server/src/auth/auth.test.ts:141`. **Size** M. **P0**
- [ ] **Fix the web lint failures:** `npx eslint .` reports 9 errors and 2 warnings, and lint should then gate CI.
  - setState in an effect: `AppShell.tsx:1032`, `AuthGate.tsx:34`, `StarDashboard.tsx:67,73,432`, `dashboard/Constellation.tsx:122,220`.
  - A ref written during render: `AppShell.tsx:319`, `lib/orion.ts:312`.
  - Unused variables: `AppShell.tsx:159`, `StarDashboard.tsx:38`.

  **Size** S. **P1**
- [ ] **Split `AppShell.tsx`** (1,316 lines). It mixes polling, demo mode, the intro scrub, chat and layout; break it into hooks and components before more features land. **Size** M. **P1**
- [ ] **Add web unit tests** (there are none): `lib/orion.ts` (401 dispatch, stream parsing), `AuthGate`, `ChatPanel`, `lib/live.ts`. **Size** M. **P1**
- [ ] **Add extension tests** (there are none): `readPage` stripping passwords and values, `unchanged()` change detection, `post()` error mapping, and a Playwright run with the unpacked extension against `extension/mock/server.mjs`. **Size** M. **P1**
- [ ] **Add an end-to-end suite** in CI (Playwright is already in `stress/`). Turn the audit scripts behind `docs/audit/` into specs covering sign-in, an empty org, ask, reshape and reset, map, node detail and source viewer, backend down, session expiry, 390px nav, and axe. **Size** M. **P1**
- [ ] **Turn on `noUncheckedIndexedAccess`** in server at least, and run root `typecheck` from CI with extension and codebase-agent dependencies installed (they have no node_modules in a fresh checkout). **Size** S. **P2**
- [ ] **Add an extraction quality gate:** grow `npm run eval` with cases for junk next steps ("Update 230.") and irrelevant reads (search-engine pages), and run it on model or prompt changes. **Where:** `server/src/eval/`, `server/scripts/eval.ts`. **Size** M. **P1**
