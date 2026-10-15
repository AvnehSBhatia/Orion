# Chrome Web Store privacy practices

Answers for the store's **Privacy practices** tab. Keep these in step with the code; each claim names where it is enforced.

## Single purpose

Orion captures the app windows, screens, and Chrome tabs a user explicitly chooses and sends them to their organization's Orion server, which turns them into updates on the team's shared work map.

## Permission justifications

| Permission | Justification |
| --- | --- |
| `desktopCapture` | Lets the user pick app windows or whole screens to share through Chrome's own picker in the chooser window. Orion captures frames only from the sources picked there, and only while the user has capturing turned on. (`src/capture.ts`) |
| `activeTab` | Used by "Hide something": when the user opens the toolbar popup on a tab and asks to send it with parts blacked out, Orion takes one screenshot of that tab and reads its page text. No access to any other tab. (`src/popup.ts`, `src/background.ts`) |
| `scripting` | Injects a small, bundled script (`read-page.js`) into tabs the user ticked in the chooser, to copy the page's visible text and form values with sensitive fields removed. The script ships in the package; no remote code. (`src/background/read-page.ts`, `src/background/sources.ts`) |
| `storage` | Keeps the user's settings, sign-in token (local only, never synced), paused state, personal list of never-captured sites, the organization's capture policy, and recording status. (`src/settings.ts`, `src/privacy.ts`, `src/recording.ts`) |
| `alarms` | A 30 second watchdog restarts the capture loop if Chrome suspends the service worker mid-session, and a 5 minute alarm refreshes the organization's capture policy (enabled, excluded sites, interval). Both run only while capturing. (`src/background/recorder.ts`) |
| Host permission: the organization's Orion server (for example `https://orion.example.com/*`) | Sends captures, the sign-in request, and policy and consent calls to the one server the build is made for. Set at build time from `ORION_SERVER_URL`; nothing else is granted at install. (`build.mjs`) |
| Optional host permission: `<all_urls>` | Requested at runtime, from a click in the chooser, only when the user wants to share Chrome tabs. Needed to list tab titles, screenshot the ticked tab with `tabs.captureVisibleTab`, and read its page text. Orion only reads tabs the user ticked, skips sites the user or their organization excluded, and never reads anything while paused or stopped. Also used if the user points the extension at a different Orion server in settings. |

Remote code: **No.** All JavaScript is bundled into the package.

## Data usage

Data types collected (tick these in the form):

| Data type | Collected | What and why |
| --- | --- | --- |
| Personally identifiable information | Yes | Orion username and user id, to attribute captures to the signed-in user. |
| Authentication information | Yes | Password at sign-in only (exchanged for an API token, never stored); the API token, stored locally. |
| Website content | Yes | Screenshots, page text, titles, and form values of tabs the user chose to share; screenshots of chosen app windows and screens. |
| Web history | Yes | Addresses (without query strings or fragments) of tabs the user chose, while they are being captured. |
| User activity | No | No keystroke, click, or mouse logging. |
| Location, health, financial and payment info, personal communications | Not intentionally | Not collected on purpose. Payment, ID, and bank fields are stripped from page text, and users and admins can exclude sites. A shared window or screen can still show anything visible in it; the notice and README say so. |

### What is never sent

Enforced in `src/lib/sensitive.ts` and `src/background/read-page.ts` (tested in `test/read-page.test.ts`):

- Values of password and hidden inputs.
- Fields with `autocomplete` `cc-*`, `one-time-code`, `current-password`, or `new-password`.
- Fields whose name, id, or label looks like a card number, CVV, SSN or national id, IBAN or account number, password, PIN, one-time code, token, secret, or API key.
- URL query strings and fragments (`src/lib/url.ts`).
- Anything from a site in the organization's `excludedHosts` or the user's own blocked list: those tabs are not screenshotted or read at all (`src/background/sources.ts`).
- Anything while paused or stopped, and anything from incognito windows (`"incognito": "not_allowed"`).

### Where it goes

Captures go only to the organization's own Orion server over HTTPS (plain HTTP is refused except to localhost). That server processes them with an AI model to describe the work, under the organization's retention settings. Orion does not sell data or use it for advertising, credit, or anything unrelated to the single purpose.

## Certifications (tick all three)

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Limited Use disclosure

Put this on the privacy policy page linked from the listing:

> Orion's use of information received from the Chrome extension adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Page content, form values (with sensitive fields removed), and screenshots from the windows, screens, and tabs a user chooses are sent only to that user's organization's Orion server, where they are processed by an AI model to update the organization's work map. They are not sold, used for advertising, or used for any purpose other than this.

## Privacy policy URL

Required. Not written yet (see `docs/production-checklist.md`, "Legal documents"). Host it next to the web app, for example `https://<org-domain>/privacy`, and fill it in before submitting.
