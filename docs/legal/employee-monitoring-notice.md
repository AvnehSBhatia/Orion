# Before you start: what Orion records

**[Company] uses Orion to keep a shared, current picture of the team's work and to draft your daily time entries.** Please read this before you turn on capture. Nothing is sent to Orion until you accept this notice.

**What the Orion Mac app reads.**

- Text on screen in the front window of the apps you turn on. Every app starts off. Password managers, Keychain and System Settings can't be turned on.
- In browsers: the tab title and the page address, cut to the domain and path (no query strings). Page text only if [Company] allows it and you turn it on yourself. [browser page text]
- If you turn on Granola meeting notes, the finished notes on your Mac (your notes and the summary). Never the recording or the transcript.
- Which app and window you were in, and when.

Orion never takes screenshots. It doesn't record keystrokes, audio or your camera. It skips private and incognito windows and password fields. It skips banking sites and any sites or words you add to your skip list. Sites [Company] blocks for everyone: [excluded sites].

**Cleaned on your Mac first.** Before anything is saved, the app removes card numbers, Social Security numbers, and API keys and tokens. It also removes email addresses, phone numbers and street addresses unless you turn that off. You can also choose to hide people's names.

**The Outbox.** What the app captures waits in the Outbox on your Mac, where you can read, edit or delete it. Items you don't review are approved automatically after 30 minutes and then sent. You can turn auto-approve off, so nothing is sent until you approve it. While items wait, the app may send them to Orion only to write a short summary for you. That text is not stored.

**What Orion does with it.** AI models read your approved work to find work items (projects, tasks, blockers, who's on what) and to draft your daily time entries by client. The models run through OpenRouter, only at providers that keep nothing and don't train on it.

**Who sees it.**

- Everyone in [Company] sees the work items. They can describe what you worked on.
- The text from your Mac is visible only to you and [Company]'s Orion admins.
- Admins can view Orion as you. Each time is recorded in the audit log.
- You review your own time entries. Admins can export the entries you accept or edit (date, client, minutes, description) and see how many entries each person accepted, edited or rejected.

Orion does not score or rank people. Ask [contact] how [Company] uses this information.

**How long it's kept.** Text from your Mac: [snippet days]. Window titles, page addresses and times: [document days] in search, and they stay with your time records until deleted. Time entries and work items stay until deleted.

**Your controls.**

- Pause or turn off capture at any time from the Orion icon in the menu bar.
- Choose which apps are read, and change your skip list and what is removed.
- Review, edit or delete items in the Outbox before they're sent.
- Delete your data from the Mac app or from Orion's settings. Work items already built from it stay.
- Download a copy of your data from Orion's settings.
- Ask [contact] to see, correct or delete your data.

**If [Company] still uses the older Orion Chrome extension.** It records only the tabs, windows or screens you pick, while recording is on: the page address, title and visible text (never passwords), and screenshots when the content changes, at most every [interval] seconds. Its page text is visible to everyone in [Company] and kept [document days]. Screenshots are [screenshot visibility] and kept [screenshot days].

**More detail:** [link to privacy policy] · Questions: [contact]

<!--
Maintainer notes (not shown to users):
- The server serves this file as the monitoring notice (GET /api/auth/me and GET /v1/policy). server/src/auth/notice.ts
  fills the [bracketed] fields from the org's name and settings; BUILT_IN_NOTICE there must match this file (a test checks).
- Changing this text does not ask anyone to accept again. An admin does that by bumping the notice version in the admin UI.
- Keep the short fallback in web/components/auth/ConsentScreen.tsx in line with this text.
-->
