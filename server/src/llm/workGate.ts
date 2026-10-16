// The work gate: Drex reads a capture and says whether it holds any of the org's work before extraction is paid for.
// A decision call costs about a tenth of an extraction, and most of what a Mac shows in a day (personal mail, news,
// chat about lunch) has none. The gate fails open: when Drex errors, the capture is extracted as before.
import { config } from "@/config";
import { clamp } from "@/lib/text";
import { decide as openRouterDecide, type Decide } from "./decisions";
import type { CaptureInput, ExtractContext } from "./extract";

// Drex prices by input token; the start of a page says what it is.
const GATE_TEXT_CHARS = 3_000;

const WORK_QUESTION = {
  type: "choice",
  instructions: "Does this screen show any of this organization's work that a teammate would want to know about?",
  criteria: {
    work: "Shows the organization's work: projects, tasks, tickets, campaigns, budgets, deals, customers, code, documents, decisions, owners, dates, or status.",
    not_work: "Personal or unrelated: personal email, shopping, social media, news, entertainment, or small talk with nothing about the work.",
  },
} as const;

/** The Drex probability that the capture holds work. */
export async function workProbability(input: CaptureInput, about?: ExtractContext, decide: Decide = openRouterDecide): Promise<number> {
  const org = about?.org;
  const state = {
    ...(org && { organization: clamp(`${org.name}. ${org.description}`, 300) }),
    ...(about?.author && { person: clamp(`${about.author.name}, ${about.author.role}`, 200) }),
    url: input.url,
    title: input.title,
    text: clamp(input.changes ? `${input.changes.diff}\n\n${input.text}` : input.text, GATE_TEXT_CHARS),
  };
  const res = await decide({ model: config.routerModel, state, questions: { work: WORK_QUESTION } });
  return res.work.probabilities.work ?? 0;
}

/** False only when Drex is confident the capture holds no work. */
export async function holdsWork(input: CaptureInput, about?: ExtractContext, decide?: Decide): Promise<boolean> {
  try {
    return (await workProbability(input, about, decide)) >= config.workGateMin;
  } catch (err) {
    console.error("Work gate failed, extracting anyway:", err instanceof Error ? err.message : err);
    return true;
  }
}
