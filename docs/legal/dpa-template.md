# Data Processing Agreement

This Data Processing Agreement ("DPA") is part of the agreement between **[Customer legal name]** ("Customer", the controller) and **[Company legal name]** ("Processor") for the Orion service (the "Agreement"). If this DPA and the Agreement disagree on data protection, this DPA applies.

## 1. Definitions

"Personal Data", "Processing", "Controller", "Processor", "Data Subject", "Personal Data Breach" and "Supervisory Authority" mean what they mean in the GDPR (Regulation (EU) 2016/679) and, where they apply, the UK GDPR, the Swiss FADP and US state privacy laws such as the CCPA ("Data Protection Law"). "Subprocessor" means a third party the Processor uses to process Customer Personal Data.

## 2. Scope and instructions

2.1 The Processor processes Customer Personal Data only to provide Orion under the Agreement, on Customer's documented instructions. The Agreement, this DPA and Customer's settings in Orion are those instructions. The settings include capture on or off, blocked sites, browser page text on Macs, retention, screenshot visibility, the monitoring notice version, and deletions.

2.2 The Processor will tell Customer if it believes an instruction breaks Data Protection Law.

2.3 The Processor will not sell or share Customer Personal Data, use it for advertising, use it to train AI models, or combine it with other data except as needed to provide Orion. This is meant to meet the CCPA's "service provider" terms.

## 3. Details of processing (Annex 1)

| | |
|---|---|
| **Subject matter and purpose** | Building a shared map of Customer's work from approved Mac work blocks, browser captures from the older extension, and code commits. Drafting daily time entries by client. Answering questions and building dashboards over that map. |
| **Duration** | The term of the Agreement, plus the deletion period in section 10. |
| **Data subjects** | Customer's employees and contractors who use Orion. People whose names or details appear in captured text or commits. |
| **Categories of data** | Account data (username, name, role, email). Mac work blocks: app name, window title, page domain and path, start and end times, up to 1,500 characters of text cleaned on the device, client match. Daily time entries and their descriptions, and timesheets people enter to compare. From the older extension: page addresses, titles, text and HTML, and screenshots of chosen tabs, windows and screens. Code commit details (author name and email, message) and diffs. Saved dashboards. Notice acceptances. Audit and access logs (IP address, user agent, times). |
| **Special categories** | Not intended. Captured text may include them by accident. The Mac app reads only apps a person turns on, and Customer can block sites. Customer should block sites likely to hold them (health, HR, banking). |
| **Processing operations** | Collection, cleaning on the device, storage, a check by an AI model for whether content holds work, extraction of work items with AI models, drafting time entries, making search embeddings, showing data to authorized users, export, and deletion. |

## 4. Customer obligations

Customer is responsible for:

- having a lawful basis for the processing
- telling its workforce. Orion shows a monitoring notice that each person must accept before anything is sent. Customer should check that it fits Customer's policies and local law, and bump the notice version in Orion when people should accept it again.
- any works council or union consultation, and any DPIA
- setting blocked sites, browser page text and retention to fit its policies
- the lawfulness of its instructions

## 5. Confidentiality

The Processor makes sure that people allowed to process Customer Personal Data are bound by confidentiality and get access only as needed.

## 6. Security

The Processor applies the measures in Annex 2 and keeps them at least as protective during the term.

## 7. Subprocessors

7.1 Customer authorizes the Subprocessors in the Processor's subprocessor list (Annex 3).

7.2 The Processor will give at least 30 days' notice by email before adding a Subprocessor. Customer may object on reasonable data protection grounds. If the parties can't resolve it, Customer may end the affected service and get a pro-rata refund.

7.3 The Processor puts data protection terms on each Subprocessor that protect the data at least as well as this DPA, and stays responsible for them.

## 8. Data subject requests

The Processor will help Customer answer requests from data subjects. Orion includes:

- a person deleting their own data, from Orion's settings or the Mac app
- an admin deleting a person and everything they captured
- deleting the whole organization
- a person downloading a copy of their data, and an admin exporting a person's data

Work items already built from deleted captures stay unless Customer deletes them. The Processor will send Customer any request it gets directly, without undue delay, and won't answer it except on Customer's instruction or where the law requires.

## 9. Personal Data Breach

9.1 The Processor will tell Customer without undue delay, and within 48 hours, after it becomes aware of a Personal Data Breach affecting Customer Personal Data.

9.2 The notice will describe:

- what happened
- the kinds and rough numbers of data subjects and records
- likely effects
- what was done or is planned
- a contact

Details can follow in stages.

9.3 The Processor will reasonably help Customer notify Supervisory Authorities and data subjects.

## 10. Return and deletion

When the Agreement ends, Customer may export its data for 30 days. After that, the Processor deletes Customer Personal Data from the live system within 30 days. Encrypted backups age out within 35 days after that. Data the law requires the Processor to keep stays protected under this DPA. The audit log of security events may be kept after deletion.

## 11. Audits

The Processor will give Customer the information needed to show it meets GDPR Art. 28: this DPA, the Security Overview and the subprocessor list. It will allow audits by Customer or an independent auditor bound by confidentiality, at most once a year (or after a breach or a regulator's request), on 30 days' notice, during business hours, at Customer's cost.

## 12. International transfers

If Customer Personal Data goes outside the EEA, UK or Switzerland to a country without an adequacy decision, the parties rely on the EU Standard Contractual Clauses (Module 2 between Customer and the Processor, Module 3 for Subprocessors), the UK International Data Transfer Addendum, and the Swiss changes to them. These are included by reference, with Annexes 1 to 3 of this DPA as their appendices.

## 13. Liability and term

The Agreement governs liability. This DPA lasts as long as the Processor processes Customer Personal Data.

---

## Annex 2: Technical and organizational measures

A summary of the Security Overview:

- **Encryption in transit:** HTTPS for all traffic, with HSTS. Calls to AI models over HTTPS.
- **Encryption at rest:** the Mac app's local store is encrypted with AES-GCM, with the key in the macOS Keychain. Backups are encrypted on the server before upload. Live database files are readable only by the Orion service account. Disk encryption depends on the host's volume setup.
- **On the device:** the Mac app reads only apps the person turns on, never takes screenshots, skips password fields and private windows, and removes card numbers, Social Security numbers, and API keys and tokens before anything is saved. Emails, phone numbers and street addresses are removed by default.
- **Access control:**
  - A separate database file for each customer organization.
  - Admin and member roles. Mac text is visible only to its author and admins. Extension screenshots are visible to their author and admins by default.
  - Passwords hashed with scrypt.
  - Sessions that expire after 30 days. API tokens that can expire and can be revoked. CI tokens that can only send commits. Mac device tokens limited to the Mac app's API.
  - CSRF protection, rate limits, and sign-in throttling.
- **Server access:** SSH only, a firewall that allows only SSH, HTTP and HTTPS, automatic security updates.
- **Logging:** an audit log of sign-ins, token and account changes, settings changes, device connections, notice acceptances, deletions, and admins viewing Orion as another person.
- **Availability:** daily backups with integrity checks, encrypted offsite copies kept 35 days, a monthly restore drill, and health and disk alerts.
- **Minimization:** the Outbox, where people review what is sent. Blocked sites. Configurable retention (defaults: Mac text 14 days, documents 90 days, screenshots 14 days).
- **AI providers:** every call denies data collection. Model calls also require zero data retention and use pinned hosts. Customer data isn't used for training. Search embeddings are made on the Processor's server by default.
- **Development:** CI with type checks, tests, builds and dependency audits, and weekly dependency updates.
- **Incident response:** a written runbook, and notice to Customer within 48 hours.

## Annex 3: Subprocessors

See the subprocessor list.
