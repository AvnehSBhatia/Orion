> **DRAFT — needs review by counsel.** Not legal advice and not yet in effect. Square brackets mark things to fill in or confirm against the shipped product before publishing.

# Orion Privacy Policy

Last updated: [date]

This policy explains what Orion collects, why, who it's shared with, how long it's kept, and what you can do about it. "We" means [Company legal name], [address]. Contact: [privacy@domain].

## Who is responsible for your data

Orion is a workplace tool. Your employer (the "customer") decides to use Orion, chooses its settings, and controls the data collected about its workforce. For that data, your employer is the **controller** and we are the **processor**: we handle it only on their instructions, under a data processing agreement. Questions about why your employer collects something, or requests to see or delete your data, can go to your employer or to us. We'll pass them on and help.

For our own account and billing records (admin contact names, emails, invoices) and our website, we are the controller.

## What Orion collects

**From the Orion Chrome extension, only for the tabs, windows and screens you choose to share, and only while recording is on:**

- **Page content:**
  - the page address (URL) [confirm: with query strings and fragments removed]
  - the page title
  - the page's visible text and HTML, up to about 60,000 characters per capture, including text you typed into form fields
  - Password fields are never read. [Confirm: payment card, one-time-code and similar fields are skipped.]
- **Screenshots** of the chosen tab, window or screen, as JPEG images, taken when the content changes (at most every few seconds).
- **Timing:** when each capture happened, and which account captured it.

The extension does not record keystrokes as you type, audio, your camera, or tabs and windows you didn't choose. It never runs in incognito windows. Your employer can block sites so they are never captured (for example banking, health, HR, webmail). You can pause recording at any time from the extension.

**From your company's code repositories, if your employer connects them:** commit metadata (repository, commit id, author name and email, message) and file changes (diffs). Paths marked private in the repository are skipped.

**From using the Orion dashboard and integrations:**

- account details (username, name, role, email if provided)
- questions you ask Orion and its answers
- sign-in times
- API tokens you create
- an audit log of security-relevant actions (sign-ins, token and account changes, settings changes, exports and deletions)

**Technical data:** IP address and browser user agent in server and proxy logs, used for security and debugging.

## What Orion does with it

- Turns captures and commits into a shared map of the team's work (projects, tasks, blockers, who is working on what) that your colleagues can see in the dashboard and through connected coding assistants.
- Answers questions and builds dashboards from that map.
- Keeps the service secure, prevents abuse, and fixes problems.

We don't sell personal data, use it for advertising, or use customer data to train AI models. Orion isn't designed to make automated decisions about employment. Your employer is responsible for how it uses what it sees.

**Legal basis (EU/UK):** for workforce data, your employer determines the basis, typically legitimate interests in coordinating work, and must tell you about it. For our own customer records: contract and legitimate interests.

## Who sees it

- **Colleagues in your organization:** the work items derived from captures, and page text. **Screenshots** are visible only to you and your organization's admins, unless your employer changes that setting.
- **Your organization's admins:** can view captures, manage accounts and delete data.
- **Service providers (subprocessors)** who help run Orion, listed at [link to subprocessor list]:
  - **OpenRouter**, which routes requests to AI model providers. To extract work items and answer questions, captured page text, titles, URLs, code changes, and the name and role of the person who captured them are sent to an AI model. [If embeddings use OpenRouter: page text is also sent to create search embeddings.] Screenshots are not sent to AI providers [confirm]. We send these requests with OpenRouter's **data collection denied**, so they only go to providers that don't store or train on the content.
  - **Our hosting provider** [name, region], which runs the servers and stores the data, and **our backup storage provider** [name, region], which keeps encrypted backups.
- **Authorities**, only when the law requires it. We'll tell your employer unless we're legally prohibited.

## How long it's kept

Your employer can change these in Orion's settings. The defaults are:

| Data | Default retention |
|---|---|
| Screenshots | 14 days, then removed |
| Captured page text and documents | 90 days, then deleted |
| Work items derived from captures (the map) | Until deleted by your organization or the account is closed |
| Code commit data | Until deleted by your organization |
| Server logs | [30] days |
| Backups | Up to [35] days after the data was deleted from the live system |
| Account data | Until the account is deleted, then removed from backups within [35] days |

When your employer stops using Orion, we delete its data within [30] days of the contract ending, unless they ask for an export first.

## Your rights

Depending on where you live (for example under the GDPR, UK GDPR, or California's CCPA/CPRA), you may have the right to:

- **Access** your data and get a copy.
- **Correct** inaccurate data.
- **Delete** your data. In Orion you can delete your own captures yourself, and admins can delete a person and everything captured from them.
- **Object to or restrict** processing.
- **Know** what's collected and why (this policy and your employer's notice).
- **Not be discriminated against** for exercising these rights.

Since your employer controls workforce data, send requests to them first, or to [privacy@domain] and we'll route them and help. We respond within one month (GDPR) or 45 days (CCPA). You can also complain to your local data protection authority.

## Security

Summary:

- encrypted connections (HTTPS) everywhere
- passwords stored as salted hashes
- per-organization data separation
- access limited by role
- encrypted disks and backups
- an audit log

Details are in our [Security Overview].

## International transfers

Orion is hosted in [region]. AI model providers reached through OpenRouter may process requests in other countries, including the United States. Where required, transfers rely on [Standard Contractual Clauses / the EU-US Data Privacy Framework], as described in the DPA.

## Children

Orion is a workplace tool and isn't intended for anyone under 16.

## Changes

We'll post updates here and tell customer admins about material changes at least [30] days in advance. If a change affects what's captured, the extension asks everyone to accept the updated notice again.

## Contact

[Company legal name], [address], [privacy@domain]. [EU/UK representative, if required.]
