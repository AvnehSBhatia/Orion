import { z } from "zod";
import { DOMAINS, LAYOUTS } from "./types";

export const MAX_HTML_CHARS = 60_000;
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
export const MAX_CODE_FILES = 30;
export const MAX_DIFF_CHARS = 4_000;
export const MAX_ROLE_CHARS = 400;
export const DEFAULT_ORG = "demo";

const rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const orgId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "orgId must be lowercase letters, digits, and dashes")
  .default(DEFAULT_ORG);

export const captureRequest = z.object({
  orgId,
  userId: z.string().min(1),
  url: z.string().min(1),
  title: z.string().default(""),
  html: z.string().max(MAX_HTML_CHARS, `html must be at most ${MAX_HTML_CHARS} characters`),
  screenshotB64: z
    .string()
    .default("")
    .transform((s) => s.replace(/^data:image\/\w+;base64,/, ""))
    .refine((s) => Math.floor((s.length * 3) / 4) <= MAX_SCREENSHOT_BYTES, "screenshot must be at most 2MB"),
  redactions: z.array(rect).optional(),
});

export const MAX_CODE_CARDS = 20;

const clip = (max: number) => z.string().trim().min(1).transform((s) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}.`));

export const featureCard = z.object({
  label: clip(40),
  summary: clip(140),
  status: z.enum(["shipped", "in_beta", "in_progress"]),
  paths: z.array(z.string()).max(MAX_CODE_FILES).default([]),
});

export const codeIngestRequest = z
  .object({
    orgId,
    repo: z.string().min(1),
    commitSha: z.string().min(1),
    files: z
      .array(z.object({ path: z.string().min(1), diff: z.string() }))
      .max(MAX_CODE_FILES, `send at most ${MAX_CODE_FILES} files`),
    cards: z.array(featureCard).max(MAX_CODE_CARDS, `send at most ${MAX_CODE_CARDS} cards`).optional(),
    userId: z.string().min(1).optional(),
    author: z.object({ name: z.string().trim().min(1).max(120), email: z.string().max(200).optional() }).optional(),
  })
  .refine((b) => b.files.length > 0 || (b.cards?.length ?? 0) > 0, "send at least one file or one card");

export const viewCommand = z.object({
  focusNodeIds: z.array(z.string()),
  highlightNodeIds: z.array(z.string()),
  visibleDomains: z.array(z.enum(DOMAINS)).nullable(),
  layout: z.enum(LAYOUTS),
  caption: z.string(),
});

export const chatRequest = z.object({
  orgId,
  userId: z.string().min(1),
  message: z.string().min(1).max(2_000),
  currentView: viewCommand.nullable().default(null),
});

export const contextQuery = z.object({
  orgId,
  userId: z.string().min(1),
  q: z.string().optional(),
  k: z.coerce.number().int().min(1).max(50).default(8),
});

export const feedQuery = z.object({
  orgId,
  userId: z.string().min(1),
  sinceHours: z.coerce.number().positive().max(24 * 90).default(72),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const orgQuery = z.object({ orgId });

export const MAX_ORG_WEBSITES = 40;
export const MAX_ORG_TEXT = 2_000;

/** "https://www.GitHub.com/acme" and "github.com" both become "github.com". */
export function hostOf(site: string): string | null {
  const s = site.trim().toLowerCase();
  if (!s) return null;
  try {
    const host = new URL(/^[a-z]+:\/\//.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, "");
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

const websites = z
  .array(z.string().max(300))
  .max(MAX_ORG_WEBSITES, `list at most ${MAX_ORG_WEBSITES} websites`)
  .transform((list, ctx) => {
    const hosts = list.map(hostOf);
    const bad = list.find((_, i) => !hosts[i]);
    if (bad !== undefined) ctx.addIssue({ code: "custom", message: `"${bad}" is not a website` });
    return [...new Set(hosts.filter((h): h is string => !!h))];
  });

const orgProfile = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1, "say what the org does in a sentence or two").max(MAX_ORG_TEXT),
  websites: websites.default([]),
  context: z.string().trim().max(MAX_ORG_TEXT).default(""),
};

export const createOrgRequest = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "id must be lowercase letters, digits, and dashes")
    .optional(),
  ...orgProfile,
  members: z
    .array(z.object({ name: z.string().trim().min(1).max(80), role: z.string().trim().min(1).max(MAX_ROLE_CHARS) }))
    .max(50)
    .default([]),
});

export const updateOrgRequest = z
  .object({
    name: orgProfile.name,
    description: orgProfile.description,
    websites,
    context: z.string().trim().max(MAX_ORG_TEXT),
  })
  .partial();

export const upsertUserRequest = z.object({
  orgId,
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
    .optional(),
  name: z.string().trim().min(1).max(80),
  role: z.string().trim().min(1).max(MAX_ROLE_CHARS),
  teamDescription: z.string().trim().max(MAX_ROLE_CHARS).default(""),
});
