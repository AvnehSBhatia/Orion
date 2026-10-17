> **Legacy.** These are the Chrome Web Store answers for the older Orion Chrome extension. Orion now captures through the Mac app, and the web app no longer offers the extension. Keep this only for organizations that still use the extension, and re-check it against `extension/static/manifest.json` before any new submission. The current texts are the privacy policy, the monitoring notice, the DPA, the subprocessor list and the security overview in this folder.

# Chrome Web Store privacy disclosures: Orion

## Single purpose

> Orion captures the browser tabs, windows and screens a user explicitly chooses and sends them to their organization's Orion workspace, which turns them into a shared map of the team's work.

## Permission justifications

| Permission | Justification |
|---|---|
| `host_permissions: <all_urls>` | The user can choose any tab to share with their team's workspace. To read the text of a chosen tab and take its screenshot, the extension needs access to that page. It reads only tabs the user selected, only while recording is on. [Consider `optional_host_permissions`, requested per site when the user picks a tab.] |
| `scripting` | Injects the content script that reads the visible text of a tab the user chose to share. |
| `activeTab` | Captures the tab the user is sharing when they start recording from the toolbar. |
| `desktopCapture` | Lets the user pick a desktop window or screen to share, using Chrome's own picker. Nothing is captured unless the user selects it there. |
| `storage` | Stores the extension's settings, the user's sign-in token for their Orion workspace, and the list of sources being shared. |
| `alarms` | Schedules periodic checks of shared sources for changes and refreshes the organization's capture policy. |

Remote code: **No.** All code ships in the package. The extension sends data to the user's Orion server but never loads or runs code from it.

## Data usage: what the extension collects

Check these boxes in the dashboard:

| Category | Collected? | What and why |
|---|---|---|
| Personally identifiable information | **Yes** | Username and sign-in token for the user's Orion account. Captured pages may contain names and emails that appear on them. |
| Authentication information | **Yes** | An API token for the user's Orion workspace. Passwords typed into pages are never read. |
| Website content | **Yes** | Text, HTML, title and screenshots of the tabs, windows and screens the user chooses to share, including text typed into form fields on those pages. |
| Web history | **Yes** | The addresses (URLs) of pages the user chose to share. [Confirm: query strings and fragments are removed.] Not the browsing history of other tabs. |
| User activity | **Yes** | When a shared page changes, so a new capture is taken. No keystroke logging, mouse tracking or clickstream. |
| Personal communications | **Only if shared** | If the user chooses to share a tab showing email or chat, its content is captured. Admins can exclude such sites, and webmail is excluded by default [at launch]. |
| Health, financial and payment information | **No, not intended** | Not collected intentionally. Banking and health sites are excluded by default [at launch]. Payment card fields are skipped [confirm]. |
| Location | **No** | |

## Certifications

Check all three:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Limited Use disclosure

Put this in the privacy policy and on the listing:

> Orion's use of information received from the Chrome extension adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Captured page content (text, HTML, form contents) and screenshots are sent only to the user's organization's Orion server. To extract work items and answer questions, page text is processed by AI model providers through OpenRouter, with data collection denied so providers don't store or train on it. Data isn't sold, used for advertising, or used to train AI models. People at Orion read it only with the customer's permission, for security, or when the law requires it.

## Privacy policy URL

`https://[domain]/privacy`, published from `docs/legal/privacy-policy.md`.

## Listing text notes

- Say plainly that it's a workplace tool installed at an employer's request. Say that it records chosen tabs and screens, and that admins of the user's organization can see the captures.
- Mention the consent screen and pause control.
- Don't describe it as productivity tracking.
