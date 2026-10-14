> **DRAFT — needs review by counsel.** Fill in the hosting and backup providers you actually use, and confirm the OpenRouter provider settings in your account before publishing.

# Orion Subprocessors

Last updated: [date]. Subscribe to changes: [email or RSS]. We give at least [30] days' notice before adding a subprocessor.

| Subprocessor | What it does | Data it handles | Location | Safeguards |
|---|---|---|---|---|
| **[Hosting provider, e.g. Hetzner / DigitalOcean / AWS]** | Runs Orion's servers and stores the databases | All customer data (accounts, captures, screenshots, the work map) | [Region, e.g. EU (Germany)] | Encrypted disks; [DPA link]; [certifications] |
| **[Backup storage, e.g. Backblaze B2 / Cloudflare R2 / AWS S3]** | Stores daily backups | Encrypted backup files (encrypted before upload; the provider can't read them) | [Region] | Client-side encryption; [DPA link] |
| **OpenRouter, Inc.** | Routes AI requests to model providers | Captured page text, titles and URLs; code diffs; the capturing person's name and role; questions and context excerpts. [If `EMBED_PROVIDER=openrouter`: page text for embeddings.] Not screenshots [confirm]. | United States | Requests sent with `data_collection: "deny"`; [zero-data-retention setting if enabled]; [DPA link]; [SCCs / DPF] |
| **Model providers reached through OpenRouter** | Run the AI models | The content OpenRouter forwards, for that request only | Varies by provider, mostly United States | Only providers that, per OpenRouter, don't store or train on prompts when data collection is denied. Currently: [list the providers allowed for the configured models, e.g. DeepSeek via [hosts], Google for embeddings]. [Decide and state whether endpoints hosted in China are allowed.] |
| **[Email provider, when invites/resets by email ship]** | Sends account emails | Name, email address | [Region] | [DPA link] |
| **[Error tracking / uptime monitoring, if used]** | Error reports, uptime checks | Error messages and stack traces (configured to strip captured content); no captured data for uptime checks | [Region] | [DPA link] |

Not subprocessors:

- Let's Encrypt: issues TLS certificates and sees no customer data.
- GitHub: Customer runs our CI sync in its own repositories, under its own GitHub agreement.

## Model configuration

Orion uses these models by default, all through OpenRouter. Admins can ask which models their organization uses.

- Extraction and chat: `deepseek/deepseek-v4-flash` [update to production values]
- Fast steps: `google/gemini-2.5-flash-lite`
- Embeddings:
  - `EMBED_PROVIDER=gemma`: run on our own servers, no third party.
  - `EMBED_PROVIDER=openrouter`: `google/gemini-embedding-2`, which sends page text to Google.
