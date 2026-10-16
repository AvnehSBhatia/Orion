import { describe, expect, it } from "vitest";
import { fakeLlm } from "@/test/llm";
import type { Decide, DecideRequest } from "./decisions";
import { LlmExtractor } from "./extract";
import { holdsWork, workProbability } from "./workGate";

const input = { url: "https://linear.app/acme/issue/A-1", title: "A-1 Checkout times out", text: "Status: Blocked. Owner: Kai. ".repeat(300) };
const about = { org: { id: "acme", name: "Acme", description: "We sell checkout software.", context: "", hosts: [], createdAt: "" }, author: { name: "Kai", role: "Engineer" } } as never;

const drex = (work: number) => {
  const requests: DecideRequest[] = [];
  const decide: Decide = async (req) => {
    requests.push(req);
    return { work: { choice: work >= 0.5 ? "work" : "not_work", probabilities: { work, not_work: 1 - work } } };
  };
  return { decide, requests };
};

describe("work gate", () => {
  it("asks Drex about the org, the person, and the start of the page", async () => {
    const { decide, requests } = drex(0.9);
    expect(await workProbability(input, about, decide)).toBe(0.9);
    expect(requests[0].model).toBe("nace-ai/drex-v2.0");
    expect(requests[0].state).toMatchObject({ organization: "Acme. We sell checkout software.", person: "Kai, Engineer", title: input.title });
    expect(((requests[0].state as { text: string }).text).length).toBeLessThanOrEqual(3_000);
  });

  it("lets a capture through unless Drex is confident there is no work, and fails open", async () => {
    expect(await holdsWork(input, about, drex(0.25).decide)).toBe(true);
    expect(await holdsWork(input, about, drex(0.05).decide)).toBe(false);
    expect(await holdsWork(input, about, async () => Promise.reject(new Error("429")))).toBe(true);
  });

  it("skips the extraction call for a capture the gate turns away", async () => {
    const { llm, requests } = fakeLlm([]);
    const ex = new LlmExtractor(llm, "test/model", async () => false);
    expect(await ex.fromCapture(input, [], about)).toEqual({ nodes: [], edges: [] });
    expect(requests).toHaveLength(0);
  });
});
