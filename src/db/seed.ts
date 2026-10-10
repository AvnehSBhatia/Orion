import type { Edge, Org, PublicNode, Relation, Status, User } from "@/contract/types";
import { edgeId, nodeKey, sourceId, type Store } from "./store";

export const DEMO_ORG: Omit<Org, "createdAt"> = {
  id: "demo",
  name: "Demo Co",
  description:
    "We build an AI support assistant for enterprise support teams. Voice mode, which lets agents talk to it, is our next launch.",
  websites: ["github.com", "ads.google.com", "app.hubspot.com", "crm.example.com", "docs.example.com", "console.cloud.example.com"],
  context:
    "Customers and prospects: Acme (renewal), Globex (voice mode pilot). Our code lives in the acme/voice and acme/api repos. GPU inference is our biggest infrastructure cost.",
};

export const SEED_USERS: User[] = [
  {
    id: "priya",
    name: "Priya Shah",
    role: "Product manager. Roadmap, launch dates, milestones, feature readiness, and what sales can promise customers.",
    teamDescription: "",
  },
  {
    id: "devon",
    name: "Devon Park",
    role: "Software engineer. Code, services, builds, latency, what is shipping, what is blocked, and technical dependencies.",
    teamDescription: "",
  },
  {
    id: "sam",
    name: "Sam Ortiz",
    role: "Account executive. Deals, renewals, pilots, customer stakeholders, and which shipped features are safe to sell.",
    teamDescription: "",
  },
  {
    id: "mina",
    name: "Mina Rao",
    role: "Growth marketer. Google Ads campaigns, daily ad budget, launch messaging, spend, and cost per signup.",
    teamDescription: "",
  },
];

type SeedNode = Omit<PublicNode, "updatedAt" | "sourceKind" | "sourceRef"> & {
  hoursAgo: number;
  sourceKind?: PublicNode["sourceKind"];
  sourceRef?: string;
};

const SEED_NODES: SeedNode[] = [
  {
    id: "voice-mode",
    label: "Voice mode",
    type: "feature",
    domain: "engineering",
    summary: "Talk to the assistant hands free. In beta with ten pilot customers, full release after the latency fix.",
    todo: null,
    readLinks: [{ title: "Voice mode beta notes", url: "https://example.com/docs/voice-beta" }],
    owner: "Devon Park",
    status: "on_track",
    sellable: true,
    sourceKind: "code",
    sourceRef: "4f2a1c9",
    hoursAgo: 30,
  },
  {
    id: "voice-latency-fix",
    label: "Voice latency fix",
    type: "task",
    domain: "engineering",
    summary: "Cut voice reply delay from 2.4 seconds to under 1 second. Waiting on the new audio streaming service.",
    todo: "Pair with whoever picks up the audio streaming service.",
    readLinks: [],
    owner: "Devon Park",
    status: "blocked",
    sellable: false,
    sourceKind: "code",
    sourceRef: "9b31e07",
    hoursAgo: 6,
  },
  {
    id: "audio-streaming-service",
    label: "Audio streaming service",
    type: "feature",
    domain: "engineering",
    summary: "New service that streams audio in small chunks so voice replies can start before the full answer is ready.",
    todo: null,
    readLinks: [],
    owner: null,
    status: "on_track",
    sellable: false,
    sourceKind: "code",
    sourceRef: "c07d5a2",
    hoursAgo: 52,
  },
  {
    id: "sso-login",
    label: "SSO login",
    type: "feature",
    domain: "engineering",
    summary: "Customers sign in with Okta or Google Workspace. Shipped to every plan last week.",
    todo: null,
    readLinks: [{ title: "SSO setup guide", url: "https://example.com/docs/sso" }],
    owner: "Devon Park",
    status: "done",
    sellable: true,
    sourceKind: "code",
    sourceRef: "e11b8f4",
    hoursAgo: 170,
  },
  {
    id: "usage-export-api",
    label: "Usage export API",
    type: "feature",
    domain: "engineering",
    summary: "Admins can download usage data as CSV. Built behind a flag and not public yet.",
    todo: null,
    readLinks: [],
    owner: "Devon Park",
    status: "on_track",
    sellable: false,
    sourceKind: "code",
    sourceRef: "a5c2d10",
    hoursAgo: 20,
  },
  {
    id: "voice-mode-general-release",
    label: "Voice mode general release",
    type: "milestone",
    domain: "engineering",
    summary: "Voice mode opens to every customer. Target date is November 14.",
    todo: "Confirm the date once the latency fix has a delivery estimate.",
    readLinks: [],
    owner: "Priya Shah",
    status: "on_track",
    sellable: false,
    hoursAgo: 48,
  },
  {
    id: "acme-renewal",
    label: "Acme renewal",
    type: "deal",
    domain: "sales",
    summary: "Annual renewal worth 180k. Acme asked for voice mode and SSO before they sign.",
    todo: null,
    readLinks: [],
    owner: "Sam Ortiz",
    status: "on_track",
    sellable: false,
    sourceKind: "extension",
    sourceRef: "https://crm.example.com/deals/acme-renewal",
    hoursAgo: 4,
  },
  {
    id: "jordan-lee-acme-cto",
    label: "Jordan Lee, Acme CTO",
    type: "stakeholder",
    domain: "sales",
    summary: "Only contact on the Acme renewal. Cares most about SSO and admin controls.",
    todo: null,
    readLinks: [],
    owner: null,
    status: "unknown",
    sellable: false,
    sourceKind: "extension",
    sourceRef: "https://crm.example.com/deals/acme-renewal",
    hoursAgo: 4,
  },
  {
    id: "globex-pilot",
    label: "Globex pilot",
    type: "deal",
    domain: "sales",
    summary: "Voice mode pilot for 40 support agents. Decision expected at the end of the month.",
    todo: "Send the pilot success criteria before Friday.",
    readLinks: [],
    owner: "Sam Ortiz",
    status: "on_track",
    sellable: false,
    sourceKind: "extension",
    sourceRef: "https://crm.example.com/deals/globex-pilot",
    hoursAgo: 26,
  },
  {
    id: "ana-cruz-globex-support",
    label: "Ana Cruz, Globex support VP",
    type: "stakeholder",
    domain: "sales",
    summary: "Runs the support team in the pilot. Wants faster voice replies.",
    todo: null,
    readLinks: [],
    owner: null,
    status: "unknown",
    sellable: false,
    hoursAgo: 26,
  },
  {
    id: "raj-iyer-globex-it",
    label: "Raj Iyer, Globex IT lead",
    type: "stakeholder",
    domain: "sales",
    summary: "Signs off on security review for the pilot.",
    todo: null,
    readLinks: [],
    owner: null,
    status: "unknown",
    sellable: false,
    hoursAgo: 26,
  },
  {
    id: "q4-search-campaign",
    label: "Q4 search campaign",
    type: "campaign",
    domain: "marketing",
    summary: "Google Ads search campaign for voice mode. Daily budget raised from 400 to 650 dollars today.",
    todo: null,
    readLinks: [{ title: "Campaign in Google Ads", url: "https://ads.google.com/aw/campaigns" }],
    owner: "Mina Rao",
    status: "on_track",
    sellable: false,
    sourceKind: "extension",
    sourceRef: "https://ads.google.com/aw/campaigns",
    hoursAgo: 2,
  },
  {
    id: "cost-per-signup",
    label: "Cost per signup",
    type: "metric",
    domain: "marketing",
    summary: "Paid search cost per signup is 38 dollars this week, up from 31 last week.",
    todo: "Check which ad groups drove the increase.",
    readLinks: [],
    owner: "Mina Rao",
    status: "at_risk",
    sellable: false,
    sourceKind: "extension",
    sourceRef: "https://ads.google.com/aw/overview",
    hoursAgo: 2,
  },
  {
    id: "voice-launch-messaging",
    label: "Voice launch messaging",
    type: "decision",
    domain: "marketing",
    summary: "Lead with hands free support for agents. Do not promise sub second replies until the latency fix ships.",
    todo: null,
    readLinks: [],
    owner: "Priya Shah",
    status: "on_track",
    sellable: false,
    hoursAgo: 72,
  },
  {
    id: "gpu-capacity-supplier",
    label: "GPU capacity supplier",
    type: "supplier",
    domain: "ops",
    summary: "Cloud GPU reservation that runs voice inference. Contract renews in November.",
    todo: null,
    readLinks: [],
    owner: null,
    status: "on_track",
    sellable: false,
    hoursAgo: 120,
  },
  {
    id: "inference-cost-overrun",
    label: "Inference cost overrun",
    type: "risk",
    domain: "ops",
    summary: "Voice inference spend is 20 percent over plan this month.",
    todo: null,
    readLinks: [],
    owner: null,
    status: "at_risk",
    sellable: false,
    hoursAgo: 10,
  },
];

const SEED_EDGES: [string, Relation, string][] = [
  ["audio-streaming-service", "blocks", "voice-latency-fix"],
  ["voice-latency-fix", "blocks", "voice-mode-general-release"],
  ["voice-mode", "part_of", "voice-mode-general-release"],
  ["voice-mode", "influences", "acme-renewal"],
  ["sso-login", "influences", "acme-renewal"],
  ["jordan-lee-acme-cto", "part_of", "acme-renewal"],
  ["voice-mode", "influences", "globex-pilot"],
  ["ana-cruz-globex-support", "part_of", "globex-pilot"],
  ["raj-iyer-globex-it", "part_of", "globex-pilot"],
  ["q4-search-campaign", "feeds", "cost-per-signup"],
  ["voice-launch-messaging", "governs", "q4-search-campaign"],
  ["voice-mode-general-release", "influences", "voice-launch-messaging"],
  ["gpu-capacity-supplier", "feeds", "voice-mode"],
  ["inference-cost-overrun", "influences", "gpu-capacity-supplier"],
];

type SeedSource = {
  kind: "extension" | "code";
  ref: string;
  title: string;
  text: string;
  authorId: string | null;
  hoursAgo: number;
  changes: { nodeId: string; change: "created" | "updated"; statusFrom: Status | null }[];
};

/** The documents behind the seed graph, so the feed and citations have something real to point at. */
const SEED_SOURCES: SeedSource[] = [
  {
    kind: "code",
    ref: "acme/voice@9c1e2ab4d7f0",
    title: "acme/voice 9c1e2ab: voice/stream_client.ts, voice/config.ts",
    text: "--- voice/stream_client.ts\n+// Chunked replies need the new audio streaming service. Until it is deployed we fall back to full buffering.\n+if (!streamingService.available) return bufferFullReply(answer)\n--- voice/config.ts\n-LATENCY_TARGET_MS = 2400\n+LATENCY_TARGET_MS = 900\nCommit message: Latency fix blocked on audio streaming service rollout. Measured 2.4s p50 on pilot traffic.",
    authorId: "devon",
    hoursAgo: 6,
    changes: [{ nodeId: "voice-latency-fix", change: "updated", statusFrom: "on_track" }],
  },
  {
    kind: "extension",
    ref: "https://ads.google.com/aw/campaigns?campaignId=q4-search-voice",
    title: "Google Ads: Q4 search, voice mode",
    text: "Campaign Q4 search voice mode. Daily budget 650 USD (was 400). Clicks 2,140. Conversions 61. Cost per conversion 38.20 USD, last week 31.05 USD. Top keyword: hands free support assistant.",
    authorId: "mina",
    hoursAgo: 2,
    changes: [
      { nodeId: "q4-search-campaign", change: "updated", statusFrom: "on_track" },
      { nodeId: "cost-per-signup", change: "updated", statusFrom: "on_track" },
    ],
  },
  {
    kind: "extension",
    ref: "https://app.hubspot.com/contacts/deals/acme-renewal",
    title: "HubSpot deal: Acme annual renewal",
    text: "Acme renewal, 180,000 USD, stage: negotiation, close date Nov 30. Contact: Jordan Lee, CTO. Notes: asked for voice mode and SSO before signing. Jordan wants admin controls for SSO and a date for voice general availability.",
    authorId: "sam",
    hoursAgo: 4,
    changes: [
      { nodeId: "acme-renewal", change: "updated", statusFrom: "on_track" },
      { nodeId: "jordan-lee-acme-cto", change: "created", statusFrom: null },
    ],
  },
  {
    kind: "extension",
    ref: "https://docs.example.com/globex-pilot-kickoff",
    title: "Globex pilot kickoff notes",
    text: "Voice mode pilot for 40 Globex support agents. Ana Cruz runs support and wants faster voice replies. Raj Iyer from IT signs off on the security review. Decision at end of month.",
    authorId: "sam",
    hoursAgo: 26,
    changes: [
      { nodeId: "globex-pilot", change: "created", statusFrom: null },
      { nodeId: "ana-cruz-globex-support", change: "created", statusFrom: null },
      { nodeId: "raj-iyer-globex-it", change: "created", statusFrom: null },
    ],
  },
  {
    kind: "extension",
    ref: "https://docs.example.com/globex-kickoff-priya",
    title: "Globex kickoff, Priya's notes",
    text: "Globex kickoff for the voice mode pilot: 40 support agents. Ana Cruz (support) wants voice replies to feel faster. Raj Iyer (IT) owns the security review sign off. They decide at the end of the month.",
    authorId: "priya",
    hoursAgo: 25,
    changes: [{ nodeId: "globex-pilot", change: "updated", statusFrom: "on_track" }],
  },
  {
    kind: "extension",
    ref: "https://ads.google.com/aw/campaigns?campaignId=q4-search-voice&date=yesterday",
    title: "Google Ads: Q4 search, voice mode (yesterday)",
    text: "Campaign Q4 search voice mode. Daily budget 400 USD. Clicks 1,610. Conversions 52. Cost per conversion 31.05 USD. Top keyword: hands free support assistant.",
    authorId: "mina",
    hoursAgo: 26,
    changes: [],
  },
  {
    kind: "extension",
    ref: "https://docs.example.com/voice-launch-plan",
    title: "Voice mode launch plan",
    text: "General release target November 14. Depends on the latency fix landing by November 1. Messaging: lead with hands free support for agents. Do not promise sub second replies until the latency fix ships.",
    authorId: "priya",
    hoursAgo: 48,
    changes: [
      { nodeId: "voice-mode-general-release", change: "updated", statusFrom: "on_track" },
      { nodeId: "voice-launch-messaging", change: "updated", statusFrom: "on_track" },
    ],
  },
  {
    kind: "extension",
    ref: "https://console.cloud.example.com/billing/voice-inference",
    title: "Cloud billing: voice inference",
    text: "Voice inference spend month to date 41,300 USD against a plan of 34,400 USD, 20 percent over. GPU reservation renews November 20.",
    authorId: "priya",
    hoursAgo: 10,
    changes: [{ nodeId: "inference-cost-overrun", change: "created", statusFrom: null }],
  },
  {
    kind: "code",
    ref: "acme/api@51d0e3f8a2c1",
    title: "acme/api 51d0e3f: exports/usage.ts, flags.ts",
    text: "--- exports/usage.ts\n+export async function usageCsv(orgId) { ... }\n--- flags.ts\n+USAGE_EXPORT: false // not public yet\nCommit message: Usage export to CSV for admins, behind a flag.",
    authorId: "devon",
    hoursAgo: 20,
    changes: [{ nodeId: "usage-export-api", change: "created", statusFrom: null }],
  },
  {
    kind: "code",
    ref: "acme/voice@4f2a1c9e88b0",
    title: "acme/voice 4f2a1c9: voice/beta.ts",
    text: "--- voice/beta.ts\n+BETA_CUSTOMERS = 10\nCommit message: Voice mode beta opened to ten pilot customers.",
    authorId: "devon",
    hoursAgo: 30,
    changes: [{ nodeId: "voice-mode", change: "updated", statusFrom: "on_track" }],
  },
];

/** Seeds demo users and graph when the store is empty, or always when `force` is set. */
export function seedDemo(store: Store, { force = false }: { force?: boolean } = {}): boolean {
  if (!force && store.listUsers().length > 0) return false;
  const now = Date.now();
  store.transaction(() => {
    store.reset();
    store.saveOrg({ ...DEMO_ORG, createdAt: new Date(now).toISOString() });
    for (const user of SEED_USERS) store.saveUser(user);
    for (const { hoursAgo, sourceKind = "manual", sourceRef = "seed", ...n } of SEED_NODES) {
      store.saveNode({
        ...n,
        key: nodeKey(n.type, n.label),
        sourceKind,
        sourceRef,
        updatedAt: new Date(now - hoursAgo * 3_600_000).toISOString(),
        embedding: null,
        embedModel: null,
        embedCtx: null,
        z: null,
        zVersion: null,
        clusterId: null,
      });
    }
    for (const [source, relation, target] of SEED_EDGES) {
      const edge: Edge = { id: edgeId(source, relation, target), source, target, relation, sourceRef: "seed" };
      if (!store.addEdge(edge)) throw new Error(`seed edge failed: ${edge.id}`);
    }
    const status = new Map(SEED_NODES.map((n) => [n.id, n.status]));
    for (const { hoursAgo, changes, ...s } of SEED_SOURCES) {
      const createdAt = new Date(now - hoursAgo * 3_600_000).toISOString();
      store.saveSource(
        { ...s, id: sourceId(s.kind, s.ref, createdAt), createdAt, image: null },
        changes.map((c) => ({ ...c, statusTo: status.get(c.nodeId)! })),
      );
      if (s.authorId) store.addTouches(s.authorId, changes.map((c) => c.nodeId));
    }
  });
  return true;
}
