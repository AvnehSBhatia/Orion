> **DRAFT — needs review by counsel.** Not legal advice. This is a starting template for a GDPR Art. 28 data processing agreement. Counsel should align it with the main services agreement, choose the transfer mechanism (EU SCCs Module 2 and/or 3, UK Addendum, Swiss amendments), and set the liability terms.

# Data Processing Agreement

This Data Processing Agreement ("DPA") forms part of the agreement between **[Customer legal name]** ("Customer", controller) and **[Company legal name]** ("Processor") for the Orion service (the "Agreement"). If this DPA and the Agreement conflict on data protection, this DPA wins.

## 1. Definitions

"Personal Data", "Processing", "Controller", "Processor", "Data Subject", "Personal Data Breach" and "Supervisory Authority" have the meanings in the GDPR (Regulation (EU) 2016/679) and, where applicable, the UK GDPR, the Swiss FADP and US state privacy laws such as the CCPA/CPRA ("Data Protection Law"). "Subprocessor" means a third party the Processor engages to process Customer Personal Data.

## 2. Scope and instructions

2.1 The Processor processes Customer Personal Data only to provide Orion under the Agreement, on Customer's documented instructions. The Agreement, this DPA and Customer's configuration of Orion (capture settings, excluded sites, retention, screenshot visibility, deletions) are those instructions.

2.2 The Processor will tell Customer if it believes an instruction violates Data Protection Law.

2.3 The Processor will not sell or share Customer Personal Data, use it for advertising, use it to train AI models, or combine it with other data except as needed to provide the service (CCPA "service provider" terms).

## 3. Details of processing (Annex 1)

| | |
|---|---|
| **Subject matter and purpose** | Building a shared map of the Customer's work from browser captures, code commits and user questions. Answering questions and building dashboards over it. |
| **Duration** | The term of the Agreement plus the deletion period in §10. |
| **Data subjects** | Customer's employees and contractors who use Orion. People whose names or details appear in captured pages or commits. |
| **Categories of data** | Account data (username, name, role, email). Captured page URLs, titles, text and HTML, including typed form content. Screenshots of chosen tabs, windows and screens. Code commit metadata and diffs. Questions and answers. Audit and access logs (IP address, user agent, timestamps). |
| **Special categories** | Not intended. Captures may incidentally include them if a user records such content. Customer should exclude sites likely to contain them (health, HR, banking). |
| **Processing operations** | Collection, storage, extraction of work items with AI models, embedding for search, display to authorized users, deletion. |

## 4. Customer obligations

Customer is responsible for:

- having a lawful basis
- giving workforce notice (Orion provides a default monitoring notice the extension shows before recording) and completing any works council or union consultation and DPIA
- configuring exclusions and retention to fit its policies
- the lawfulness of its instructions

## 5. Confidentiality

The Processor ensures that people authorized to process Customer Personal Data are bound by confidentiality and get access only as needed.

## 6. Security

The Processor implements the measures in Annex 2 and keeps them at least as protective during the term.

## 7. Subprocessors

7.1 Customer authorizes the Subprocessors listed at [URL] (Annex 3).

7.2 The Processor will give at least [30] days' notice of a new Subprocessor by [email / the list's update feed]. Customer may object on reasonable data protection grounds. If the parties can't resolve it, Customer may terminate the affected service and get a pro-rata refund.

7.3 The Processor imposes data protection terms on each Subprocessor that are no less protective than this DPA, and remains liable for them.

## 8. Data subject requests

The Processor will help Customer respond to requests to exercise data subject rights. Orion includes self-service deletion (a user's own captures), admin deletion of a person and their captures, and org deletion. The Processor will forward any request it receives directly to Customer without undue delay and won't respond except on Customer's instruction or as legally required.

## 9. Personal Data Breach

9.1 The Processor will notify Customer without undue delay, and in any case within [48] hours, after becoming aware of a Personal Data Breach affecting Customer Personal Data.

9.2 The notice will describe:

- the nature of the breach
- the categories and approximate numbers of data subjects and records
- likely consequences
- measures taken or proposed
- a contact point

Information can follow in phases.

9.3 The Processor will reasonably assist Customer with notifications to Supervisory Authorities and data subjects.

## 10. Return and deletion

On termination, Customer may export its data for [30] days. After that, the Processor deletes Customer Personal Data from live systems within [30] days. Backups age out within [35] days. Data retained by law stays protected under this DPA.

## 11. Audits

The Processor will make available the information needed to demonstrate compliance with Art. 28: this DPA, the Security Overview, and [third-party reports when available]. It will allow audits by Customer or an independent auditor bound by confidentiality, no more than once a year (or after a breach or a regulator's request), on [30] days' notice, during business hours, at Customer's cost.

## 12. International transfers

Where Customer Personal Data is transferred outside the EEA, UK or Switzerland to a country without an adequacy decision, the parties rely on the [EU Standard Contractual Clauses (Module 2 / Module 3), the UK International Data Transfer Addendum and the Swiss amendments], incorporated by reference, with Annexes 1-3 of this DPA as their appendices.

## 13. Liability and term

Liability is governed by the Agreement. This DPA lasts as long as the Processor processes Customer Personal Data.

---

## Annex 2: Technical and organizational measures

Summary of the [Security Overview]:

- **Encryption in transit:** TLS for all traffic (HTTPS with HSTS). Backups are encrypted before they leave the host.
- **Encryption at rest:** encrypted host disk or volume. Encrypted offsite backups.
- **Access control:**
  - Org-scoped data with a separate database per customer.
  - Role-based access (admin and member). Screenshots are visible to the author and admins by default.
  - Passwords hashed with scrypt.
  - Expiring sessions. Revocable API tokens.
- **Operational access:** production access limited to [named roles], over SSH keys, logged.
- **Logging:** an audit log of sign-ins, token and account changes, settings changes, exports and deletions.
- **Availability:** daily backups with integrity checks, offsite copies, a monthly restore test, health monitoring.
- **Minimization:** user-selected capture only, site exclusions, no incognito capture, configurable retention (defaults: screenshots 14 days, text 90 days).
- **AI providers:** requests are sent with data collection denied; customer data isn't used for training.
- **Development:** code review, CI tests and dependency monitoring on every change.
- **Incident response:** documented runbook, notification within [48] hours.

## Annex 3: Subprocessors

See the [Subprocessor List].
