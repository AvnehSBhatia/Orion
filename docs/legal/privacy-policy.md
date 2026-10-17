# Orion Privacy Policy

Last updated: October 16, 2026

This policy explains what Orion collects, why, who sees it, how long it's kept, and what you can do about it. "We" means [Company legal name], [address]. Contact: [privacy contact email].

## Who is responsible for your data

Orion is a workplace tool. Your employer (the "customer") decides to use Orion, picks its settings, and controls the data collected about its people. For that data, your employer is the **controller** and we are the **processor**. We handle it only to run Orion for them, under a data processing agreement. You can send questions or requests about your data to your employer or to us. If you write to us, we pass it to your employer and help them answer.

For our own records about customers (admin contacts, billing) and for our website, we are the controller.

## What Orion collects

### From the Orion Mac app

The Mac app is the main way Orion learns about work. It reads text through macOS Accessibility, only while capture is on, and only from apps you turn on yourself.

- **Apps:** every app starts off. You choose which ones are read. Password managers, Keychain and System Settings can't be turned on.
- **What is read:** the text on screen in the front window of an allowed app, the window title, the app's name, and when you were in it.
- **Browsers:** the tab title and the page address, cut to the domain and path. Query strings and fragments are dropped. Page text is read only if your employer allows it and you turn it on yourself. Otherwise only the title and address are kept.
- **Never read:** screenshots (the app never takes any), keystrokes, audio, your camera, password fields, and private or incognito windows. The app also skips banking sites by default, any sites or words on your skip list, and sites your employer blocks.

**Cleaned on your Mac.** Before anything is saved, even on your Mac, the app removes:

- always: payment card numbers, Social Security numbers, and API keys and tokens
- by default, unless you turn it off: email addresses, phone numbers and street addresses
- if you turn it on: people's names, replaced with labels like "Person 1"

Links in text are cut to domain and path, like browser addresses. The server checks again and refuses anything that still holds a card number or an API key.

**The Outbox.** Captured items are kept on your Mac, encrypted, and wait in the app's Outbox. You can read, edit or delete them there. By default, items you haven't reviewed are approved automatically after 30 minutes and then sent to Orion. You can turn auto-approve off, so nothing is sent until you approve it, or switch to a mode where items are sent as soon as they're finished. Text on your Mac is cleared after 30 days.

**Summaries before approval.** While items wait in the Outbox, the app may send them to Orion so an AI model can write a short summary for you to read. This happens only after you've accepted your employer's notice and while capture is on. The server doesn't store these items or the summary, and doesn't log them.

**What is sent when approved.** For each work block: the app name, window title, domain and path, start and end times, up to 1,500 characters of cleaned text, and a client match (if the app matched one). Nothing is sent until you accept your employer's monitoring notice.

### Daily time drafts

From your approved work blocks, Orion drafts a time entry for each client you worked for that day, rounded up to your employer's billing increment (6 or 15 minutes). An AI model writes a short description of each entry. You review your own entries: accept, edit or reject them, then finalize the day. You can also enter your own timesheet for a day, so Orion can compare.

Admins can export the entries people have accepted or edited, for everyone, as a CSV (date, person, client, minutes, description, status). Admins can also see how many entries each person accepted, edited or rejected, and on how many days. Entries you haven't reviewed and entries you rejected are not in the export.

### From the older Orion Chrome extension

Some organizations still use our older Chrome extension. It records only the tabs, windows or screens you pick, while recording is on: the page address (query strings and fragments dropped), title, visible text and HTML, and screenshots when the content changes. It never copies password, payment card, one-time code or similar fields.

### From code repositories, if an admin connects one

An admin can connect a GitHub repository. Orion then creates a token that can only send commits, and the admin stores it as a secret in that repository. On each push, a GitHub Action sends the commit details (repository, commit id, author name and email, message) and file changes (diffs) to Orion. Paths marked private in the repository are never sent.

### From using Orion

- account details: username, name, role, and email if given
- questions you ask in chat and dashboards you save. Orion does not keep a chat history on the server.
- sign-in times, API tokens and Mac devices you connect (labeled, with a random install id, not your computer's name)
- your acceptance of the monitoring notice, with its version and time
- an audit log of security events: sign-ins, failed sign-ins, sign-outs, token and account changes, invites, password changes and resets, settings changes, device connections, consent, deletions, and admins viewing Orion as someone else

**Technical data.** Our server and proxy logs record IP addresses, browser user agents and request paths, for security and fixing problems. They are not meant to hold captured text.

## What Orion does with it

- Finds work items (projects, tasks, blockers, who is on what) and builds a shared map of the team's work.
- Answers questions, writes briefs and summaries, and builds dashboards from that map.
- Drafts daily time entries by client.
- Keeps the service secure and fixes problems.

We don't sell personal data, use it for ads, or use customer data to train AI models. Orion does not score or rank people, and it isn't built to make decisions about anyone's job. Your employer is responsible for how it uses what it sees.

**Legal basis (EU and UK):** for workforce data, your employer sets the basis (often legitimate interests in running the business) and must tell you. For our own customer records: contract and legitimate interests.

## AI models

AI models do much of the work. Every model call goes through **OpenRouter**, which routes it to a model host. Each call tells OpenRouter to deny data collection and to use only hosts with zero data retention, so the data goes only to hosts that don't store it or train on it. Each model is also pinned to the hosts listed below.

| Model | What it does | Where it runs |
|---|---|---|
| Drex (nace-ai/drex-v2.0) | Checks whether a capture or commit holds any work, and routes chat questions | DeepInfra |
| Claude Haiku 5.5 (Anthropic) | Finds work items in approved captures and commits, labels areas, writes digests | Only Anthropic, Amazon Bedrock, Google Vertex or Microsoft Azure |
| DeepSeek V4.1 Flash | Writes chat answers, briefs, Outbox summaries, dashboards and time entry descriptions | Only DeepInfra, Together, Fireworks, Baseten or Cloudflare. Never hosts in China. |
| Jev (TypeSafe) | Picks which work items a chat question is about | TypeSafe |

What a model sees depends on the task: captured text and titles, page addresses, code changes, the name and role of the person who captured them, your organization's name and description, and your question.

**Search embeddings** are made on our own server by default (EmbeddingGemma), so that text doesn't leave our server. If we switch to hosted embeddings, text is sent to Google (gemini-embedding-2) through OpenRouter. Those calls deny data collection but don't require zero data retention. We'll update this policy and the subprocessor list before doing that.

**Your own coding assistant.** You can connect a coding assistant (for example Claude Code) to Orion with your own token. Whatever Orion data you ask it for then goes to that assistant's model provider, under your own account with them. We don't control that provider.

## Who sees it

- **Everyone in your organization:** work items, including ones built from your captures and commits. These can describe what you worked on. Also extension page text and commit changes.
- **Only you and your organization's admins:** the text, window titles and addresses from your Mac. Other members see only that you had Mac activity in an app. Extension screenshots are also limited to you and admins, unless your employer makes them visible to everyone.
- **Your organization's admins** can also manage accounts, change settings, delete data, export time entries, and view Orion as another person. Viewing as someone is recorded in the audit log.
- **Service providers** that help run Orion, listed in our subprocessor list: OpenRouter and the model hosts above, our hosting provider [hosting provider] in [region], Cloudflare R2 for encrypted backups, and our email provider [email provider] for invites and password resets.
- **Authorities**, only when the law requires it. We tell your employer first unless the law forbids it.

## How long it's kept

Your employer can change most of these in Orion's settings. The defaults are:

| Data | Kept |
|---|---|
| Text from the Mac app on the server | 14 days, then cleared |
| Mac window titles, addresses and times in search | 90 days |
| Mac work block records (app, window title, address, times) and time entries | Until deleted |
| Extension page text, and commit changes | 90 days |
| Extension screenshots | 14 days |
| Work items | Until your organization deletes them |
| Captured text on your Mac | 30 days, or until you delete it |
| Account data | Until the account is deleted |
| Audit log | Kept, including after an organization is deleted |
| Backups | Up to 35 days after data leaves the live system |

When your employer stops using Orion, we delete its data within 30 days of the contract ending, unless they ask for an export first.

## Your rights

Depending on where you live (for example under the GDPR, UK GDPR, or California's CCPA), you may have the right to:

- **See** your data and get a copy. You can download a copy of your data as a file from Orion's settings, and admins can export a person's data.
- **Correct** data that is wrong.
- **Delete** your data. You can delete your own captures in Orion's settings or in the Mac app. Admins can delete a person and everything they captured. Work items already built from deleted captures stay, because colleagues' work builds on them.
- **Object to or limit** how it's used.
- **Know** what's collected and why (this policy and your employer's notice).
- **Not be treated worse** for using these rights.

Since your employer controls workforce data, send requests to them first, or to [privacy contact email] and we'll pass them on and help. We answer within one month (GDPR) or 45 days (CCPA). You can also complain to your local data protection authority.

## Security

In short: HTTPS for all traffic, passwords stored as salted scrypt hashes, a separate database file for each organization, access limited by role, encrypted backups, and an audit log. Our Security Overview has the details.

## International transfers

Orion is hosted in [region]. OpenRouter and the model hosts may process requests in other countries, including the United States. Where the law requires it, these transfers use the EU Standard Contractual Clauses, as described in our data processing agreement.

## Children

Orion is a workplace tool and isn't meant for anyone under 16.

## Changes

We post updates here and tell customer admins about important changes at least 30 days ahead. If a change affects what's captured, your admin can ask everyone to accept the updated notice again.

## Contact

[Company legal name], [address], [privacy contact email].
