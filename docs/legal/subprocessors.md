# Orion Subprocessors

Last updated: October 16, 2026. We give customers at least 30 days' notice before adding a subprocessor. To hear about changes, write to [privacy contact email].

| Subprocessor | What it does | Data it handles | Location | Safeguards |
|---|---|---|---|---|
| **[Hosting provider]** | Runs Orion on one virtual server and stores the databases | All customer data: accounts, Mac work blocks, time entries, captures, screenshots from the older extension, work items | [Region] | Firewall allows only SSH, HTTP and HTTPS. Database files readable only by the Orion service account. |
| **Cloudflare, Inc. (R2 storage)** | Stores offsite backups | Backup files, encrypted on our server with rclone crypt before upload. Cloudflare can't read them. | [Region] | Encrypted before upload. The keys are not stored with Cloudflare. |
| **OpenRouter, Inc.** | Routes AI model calls to model hosts | Captured text, window titles, page addresses, code changes, the capturing person's name and role, the organization's name and description, questions and the work items they need | United States | Every call sets `data_collection: "deny"`. Chat, extraction, summary and decision calls also set zero data retention (`zdr`). |
| **Model hosts reached through OpenRouter** | Run the AI models | What OpenRouter forwards, for that call only | Varies by host, mostly United States | Only hosts that keep nothing and don't train on prompts. Each model is pinned to the hosts below. |
| **[Email provider]** | Sends invites and password reset emails | Name, email address, the invite or reset link | [Region] | |

## Model hosts

| Model | What it does | Allowed hosts |
|---|---|---|
| `nace-ai/drex-v2.0` (Drex) | Decides whether a capture or commit holds work, and routes chat questions. It sees the org's name and description, the person's name and role, the page address, the title, and the first 3,000 characters of text. | DeepInfra |
| `anthropic/claude-haiku-5.5` | Finds work items in approved captures and commits, labels areas, writes digests | Anthropic, Amazon Bedrock, Google Vertex, Microsoft Azure |
| `deepseek/deepseek-v4.1-flash` | Chat answers, briefs, Outbox summaries, dashboards, time entry descriptions | DeepInfra, Together, Fireworks, Baseten, Cloudflare. No hosts in China. |
| `~typesafe/jev-latest` (Jev) | Picks which work items a chat question is about. It sees the question, the earlier question, the person's name and role, and up to 255 work item summaries. | TypeSafe |

**Embeddings** (for search) run on our own server by default, with EmbeddingGemma. No third party sees that text. If we ever switch to hosted embeddings, `google/gemini-embedding-2` through OpenRouter would receive the text, with data collection denied. We would update this list first.

## Not subprocessors

- **Let's Encrypt** issues our TLS certificates (through Caddy). It sees no customer data.
- **GitHub.** A customer who connects a repository runs our sync job in its own GitHub account, under its own GitHub agreement.
- **Coding assistants** a person connects to Orion with their own token, such as Claude Code. Orion data that person asks for goes to their assistant's model provider under their own account.
- **Alert and uptime services** (for example a Slack or Discord webhook, or an uptime checker). Our alerts carry counts and route paths only, never customer data.
