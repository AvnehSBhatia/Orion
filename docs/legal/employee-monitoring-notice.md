> **DRAFT — needs review by counsel.** Not legal advice. This is the default text the Orion extension shows before recording starts. Each customer should adapt it, add their own legal basis and contact, and check local rules: works council or union consultation in the EU, written notice and acknowledgment in New York (Civil Rights Law §52-c), Connecticut and Delaware, a CCPA notice at collection in California, and a DPIA under GDPR Art. 35. Bumping the org's `consentVersion` asks everyone to accept again.

# Before you start: what Orion records

**[Company] uses Orion to keep a shared, up-to-date picture of the team's work.** Please read this before turning on recording.

**What's recorded.** Only the browser tabs, windows or screens you pick, and only while recording is on:

- the page address, title and visible text, including text you type into forms (never passwords)
- screenshots when the content changes, at most every [5] seconds

Orion doesn't record keystrokes as you type, audio, your camera, incognito windows, or anything you didn't pick. These sites are never recorded: [list, e.g. banking, health, HR, personal email].

**What it's used for.** Orion turns what you work on into work items (projects, tasks, blockers, who's on what) that your team can see, search and ask questions about. [Company] does not use Orion to [measure productivity / time-track / make disciplinary decisions] — [edit to match your policy].

**Who sees it.**

- Your colleagues see the work items and page text.
- **Screenshots** are visible only to you and [Company]'s Orion admins [unless changed: "to everyone in the organization"].
- To build work items, page text and titles are processed by AI models through OpenRouter. Those providers don't keep or train on it.

**How long it's kept.** Screenshots: [14] days. Page text: [90] days. Work items stay until deleted.

**Your controls.**

- Pause or stop recording at any time from the Orion icon. A badge shows when recording is on.
- Remove a tab or window from what's shared.
- Delete your own captures in Orion's settings.
- Ask [contact] to see, correct or delete your data.

**More detail:** [link to privacy policy] · Questions: [contact name / email]

---

[ ] I've read this notice and understand what Orion records.

**[ Accept and continue ]**   [ Not now ]

<!--
Implementation notes for the extension (not shown to users):
- Show on first run and whenever GET /api/capture/policy reports a consent version the user hasn't accepted.
- Recording stays disabled until POST /api/auth/consent { version } succeeds; capture endpoints return 403 "consent required" otherwise.
- Keep "Not now" as a real choice: nothing is captured, the user can come back later.
- Store nothing locally that implies consent; the server's acceptedAt is the record (it also lands in the audit log).
-->
