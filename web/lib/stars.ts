export type Domain = "engineering" | "sales" | "marketing" | "ops";
export type Status = "on_track" | "at_risk" | "blocked" | "done";

export type Update = { date: string; source: string; author: string; change: string };

export type Star = {
  id: string;
  label: string;
  domain: Domain;
  status: Status;
  summary: string;
  todo: string | null;
  read: string;
  updated: string;
  sellable: boolean;
  owner: string;
  due: string;
  tasks: { done: number; active: number; blocked: number; todo: number };
  updates: Update[];
};

export const WEEKS = ["Aug 17", "Aug 24", "Aug 31", "Sep 7", "Sep 14", "Sep 21", "Sep 28", "Oct 5"];

export const STARS: Star[] = [
  {
    id: "seat-pricing",
    label: "Seat pricing",
    domain: "engineering",
    status: "done",
    summary: "Per-seat price is live, and sales can quote it.",
    todo: null,
    read: "Pricing page",
    updated: "last week",
    sellable: true,
    owner: "Priya Natarajan",
    due: "Oct 2",
    tasks: { done: 18, active: 0, blocked: 0, todo: 0 },
    updates: [
      { date: "Oct 2", source: "GitHub", author: "Priya Natarajan", change: "Merged pricing service to main" },
      { date: "Oct 1", source: "Linear", author: "Sam Ortiz", change: "Closed billing migration" },
      { date: "Sep 29", source: "Slack", author: "Jordan Lee", change: "Confirmed quote template with sales" },
      { date: "Sep 26", source: "Docs", author: "Priya Natarajan", change: "Published pricing page copy" },
    ],
  },
  {
    id: "voice-mode",
    label: "Voice mode",
    domain: "engineering",
    status: "at_risk",
    summary: "Hands-free replies are in progress. Sales should not mention this yet.",
    todo: null,
    read: "Voice mode notes",
    updated: "yesterday",
    sellable: false,
    owner: "Alex Kim",
    due: "Nov 14",
    tasks: { done: 9, active: 6, blocked: 2, todo: 7 },
    updates: [
      { date: "Oct 9", source: "Linear", author: "Alex Kim", change: "Latency target moved to 400 ms" },
      { date: "Oct 8", source: "GitHub", author: "Dana Wu", change: "Opened streaming audio branch" },
      { date: "Oct 6", source: "Slack", author: "Alex Kim", change: "Flagged vendor quota as a risk" },
      { date: "Oct 3", source: "Docs", author: "Maya Chen", change: "Drafted launch criteria" },
    ],
  },
  {
    id: "ads-budget",
    label: "Ads budget",
    domain: "marketing",
    status: "on_track",
    summary: "Daily budget moved from $400 to $650 for the spring campaign.",
    todo: "Confirm the new cap with finance before Friday.",
    read: "Google Ads, spring campaign",
    updated: "2 hours ago",
    sellable: true,
    owner: "Rosa Diaz",
    due: "Oct 16",
    tasks: { done: 5, active: 2, blocked: 0, todo: 1 },
    updates: [
      { date: "Oct 10", source: "Google Ads", author: "Rosa Diaz", change: "Daily cap raised from $400 to $650" },
      { date: "Oct 9", source: "Slack", author: "Rosa Diaz", change: "Asked finance to approve the new cap" },
      { date: "Oct 7", source: "Sheets", author: "Tom Hale", change: "Updated cost per lead forecast" },
      { date: "Oct 4", source: "Google Ads", author: "Rosa Diaz", change: "Paused two weak ad groups" },
    ],
  },
  {
    id: "spring-campaign",
    label: "Spring campaign",
    domain: "marketing",
    status: "on_track",
    summary: "The spring campaign is live and sales can mention it.",
    todo: null,
    read: "Campaign brief",
    updated: "5 hours ago",
    sellable: true,
    owner: "Tom Hale",
    due: "Dec 1",
    tasks: { done: 14, active: 4, blocked: 0, todo: 3 },
    updates: [
      { date: "Oct 10", source: "HubSpot", author: "Tom Hale", change: "Email two sent to 12,400 contacts" },
      { date: "Oct 8", source: "Docs", author: "Rosa Diaz", change: "Approved landing page copy" },
      { date: "Oct 5", source: "Slack", author: "Jordan Lee", change: "Shared talking points with sales" },
      { date: "Oct 1", source: "HubSpot", author: "Tom Hale", change: "Campaign went live" },
    ],
  },
  {
    id: "acme-renewal",
    label: "Acme renewal",
    domain: "sales",
    status: "blocked",
    summary: "The renewal is waiting on the security review.",
    todo: "Send the security packet to Acme.",
    read: "Acme deal room",
    updated: "yesterday",
    sellable: true,
    owner: "Jordan Lee",
    due: "Oct 31",
    tasks: { done: 6, active: 1, blocked: 3, todo: 2 },
    updates: [
      { date: "Oct 9", source: "Salesforce", author: "Jordan Lee", change: "Stage held at negotiation" },
      { date: "Oct 8", source: "Email", author: "Acme procurement", change: "Requested SOC 2 report" },
      { date: "Oct 6", source: "Slack", author: "Jordan Lee", change: "Asked ops for review timeline" },
      { date: "Oct 2", source: "Salesforce", author: "Jordan Lee", change: "Renewal value set at $84,000" },
    ],
  },
  {
    id: "security-review",
    label: "Security review",
    domain: "ops",
    status: "blocked",
    summary: "The review is open, and it is holding the Acme renewal.",
    todo: "Finish the review that is holding Acme.",
    read: "Review checklist",
    updated: "yesterday",
    sellable: false,
    owner: "Nina Park",
    due: "Oct 20",
    tasks: { done: 11, active: 3, blocked: 2, todo: 5 },
    updates: [
      { date: "Oct 9", source: "Jira", author: "Nina Park", change: "Pen test findings assigned" },
      { date: "Oct 7", source: "Slack", author: "Nina Park", change: "Waiting on vendor attestation" },
      { date: "Oct 5", source: "Docs", author: "Sam Ortiz", change: "Updated data flow diagram" },
      { date: "Oct 1", source: "Jira", author: "Nina Park", change: "Review opened for Acme" },
    ],
  },
  {
    id: "q4-launch",
    label: "Q4 launch",
    domain: "ops",
    status: "on_track",
    summary: "The launch checklist is on track for the 18th.",
    todo: null,
    read: "Launch doc",
    updated: "this morning",
    sellable: true,
    owner: "Maya Chen",
    due: "Oct 18",
    tasks: { done: 22, active: 5, blocked: 0, todo: 4 },
    updates: [
      { date: "Oct 10", source: "Notion", author: "Maya Chen", change: "Checklist at 71 percent" },
      { date: "Oct 9", source: "Slack", author: "Tom Hale", change: "Press list confirmed" },
      { date: "Oct 7", source: "Linear", author: "Sam Ortiz", change: "Release branch cut" },
      { date: "Oct 3", source: "Notion", author: "Maya Chen", change: "Launch date set for Oct 18" },
    ],
  },
  {
    id: "northstar-pilot",
    label: "Northstar pilot",
    domain: "sales",
    status: "on_track",
    summary: "The pilot starts next week if seat pricing stays as quoted.",
    todo: "Confirm the seat count with Northstar.",
    read: "Pilot notes",
    updated: "3 days ago",
    sellable: true,
    owner: "Jordan Lee",
    due: "Oct 19",
    tasks: { done: 4, active: 3, blocked: 0, todo: 2 },
    updates: [
      { date: "Oct 7", source: "Salesforce", author: "Jordan Lee", change: "Pilot scoped to 40 seats" },
      { date: "Oct 6", source: "Email", author: "Northstar IT", change: "Sent SSO requirements" },
      { date: "Oct 3", source: "Slack", author: "Priya Natarajan", change: "Confirmed seat pricing applies" },
      { date: "Sep 30", source: "Salesforce", author: "Jordan Lee", change: "Pilot proposal sent" },
    ],
  },
];

export const DOMAINS: Domain[] = ["engineering", "marketing", "sales", "ops"];

export const DOMAIN_LABEL: Record<Domain, string> = {
  engineering: "Engineering",
  sales: "Sales",
  marketing: "Marketing",
  ops: "Ops",
};

export function statusLabel(status: Status) {
  switch (status) {
    case "on_track":
      return "On track";
    case "at_risk":
      return "At risk";
    case "blocked":
      return "Blocked";
    case "done":
      return "Done";
  }
}

function seeded(id: string) {
  let seed = [...id].reduce((total, char) => total * 31 + char.charCodeAt(0), 7) % 233280;
  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

export function activity(star: Star) {
  const random = seeded(star.id);
  const total = star.tasks.done + star.tasks.active + star.tasks.blocked + star.tasks.todo;
  const base = Math.max(4, Math.round(total / 2));
  const updates: number[] = [];
  const mentions: number[] = [];
  WEEKS.forEach((_, index) => {
    const lift = star.status === "done" ? Math.max(0, 5 - index) : index * 0.8;
    updates.push(Math.round(base + lift + random() * 6));
    mentions.push(Math.round(base * 0.6 + lift * 0.7 + random() * 5));
  });
  return { updates, mentions };
}

export function percentChange(series: number[]) {
  const last = series.at(-1) ?? 0;
  const previous = series.at(-2) ?? 0;
  if (previous === 0) return 0;
  return Math.round(((last - previous) / previous) * 1000) / 10;
}

export type Message = { role: "user" | "assistant"; text: string };

export type Answer = {
  reply: string;
  view?: "context" | "blocked";
  id?: string;
  highlightIds?: string[];
};

export function answer(message: string): Answer {
  const q = message.toLowerCase();
  if (q.includes("block")) {
    const blocked = STARS.filter((star) => star.status === "blocked");
    const names = blocked.map((star) => star.label);
    const list = names.length <= 1 ? names[0] : `${names.slice(0, -1).join(" and ")} and ${names.at(-1)}`;
    return {
      reply: names.length
        ? `${list} ${names.length === 1 ? "is" : "are"} blocked. The renewal is waiting on the security review.`
        : "Nothing is blocked.",
      view: "blocked",
      id: blocked[0]?.id,
      highlightIds: blocked.map((star) => star.id),
    };
  }
  if (q.includes("promise") || q.includes("sell") || q.includes("voice")) {
    return {
      reply: "Sales can mention seat pricing and the spring campaign. Voice mode is not public yet.",
      view: "context",
      id: "voice-mode",
      highlightIds: ["seat-pricing", "spring-campaign", "voice-mode"],
    };
  }
  if (q.includes("change") || q.includes("today") || q.includes("ads")) {
    return {
      reply: "Ads budget moved from $400 to $650 a day two hours ago. Finance still needs to confirm the cap.",
      view: "context",
      id: "ads-budget",
      highlightIds: ["ads-budget", "spring-campaign"],
    };
  }
  const hit = STARS.find((star) =>
    star.label
      .toLowerCase()
      .split(" ")
      .some((word) => word.length > 2 && q.includes(word)),
  );
  if (hit) return { reply: hit.summary, view: "context", id: hit.id, highlightIds: [hit.id] };
  return { reply: "I could not match that to a project. Try a project name, or ask what is blocked." };
}

export const SUGGESTIONS = [
  "What can sales promise about voice mode?",
  "What is blocked this week?",
  "What changed in ads today?",
];

export type Lesson = { target: string; title: string; reply: string };

const SKIP_WORD = new Set(["review", "launch", "pilot", "mode"]);

const STATUS_TEACH: Record<Status, string> = {
  on_track: "On track means the work is moving, and nothing is holding the date.",
  at_risk: "At risk means it is still moving, but a date or a dependency could slip.",
  blocked: "Blocked means it cannot move until something else is finished.",
  done: "Done means the work has shipped, and there is nothing left to do on it.",
};

function mentionsStar(q: string, star: Star) {
  const label = star.label.toLowerCase();
  if (q.includes(label)) return true;
  return label.split(" ").some((word) => word.length > 2 && !SKIP_WORD.has(word) && q.includes(word));
}

function taskSentence(star: Star) {
  const { done, active, blocked, todo } = star.tasks;
  return `${done} done, ${active} in progress, ${blocked} blocked, and ${todo} not started`;
}

function signed(value: number) {
  if (value > 0) return `up ${value}%`;
  if (value < 0) return `down ${Math.abs(value)}%`;
  return "unchanged";
}

/** A question about something visible on a project page, with the element to frame. */
export function teach(star: Star, message: string): Lesson | null {
  const q = message.toLowerCase().trim();
  if (!q) return null;

  const other = STARS.find((item) => item.id !== star.id && mentionsStar(q, item));
  if (other && !mentionsStar(q, star)) {
    return {
      target: `project-${other.id}`,
      title: other.label,
      reply: `${other.label} is in the ${DOMAIN_LABEL[other.domain]} list along the left. ${STATUS_TEACH[other.status]} ${other.summary} ${other.owner} owns it, and it is due ${other.due}.`,
    };
  }

  const { updates, mentions } = activity(star);
  const updateChange = percentChange(updates);
  const mentionChange = percentChange(mentions);
  const open = star.tasks.active + star.tasks.blocked + star.tasks.todo;
  const latest = star.updates[0];

  if (/\b(sales|promise|sellable|public|internal)\b/.test(q) || q.includes("mention it") || q.includes("can sales")) {
    return {
      target: "sales",
      title: "Can sales mention it",
      reply: star.sellable
        ? `This flag tells sales whether the work is public. ${star.label} is public, so they can talk about it. The safe description is the line under the title: ${star.summary}`
        : `This flag tells sales whether the work is public. ${star.label} is still internal, so they should not bring it up. ${star.summary}`,
    };
  }

  if (/what to do|next step|should i do|do next|\baction\b/.test(q)) {
    return {
      target: "todo",
      title: "What to do",
      reply: star.todo
        ? `What to do is the single next action, not the whole backlog. For ${star.label}, that is: ${star.todo}`
        : `What to do is the single next action. Nothing is waiting on you for ${star.label} right now.`,
    };
  }

  if (/what to read|where (to|should i) read|\b(docs|brief|checklist)\b/.test(q)) {
    return {
      target: "read",
      title: "What to read",
      reply: `What to read is the source to open when you need the detail behind this page. For ${star.label}, start with ${star.read}.`,
    };
  }

  if (/\b(due|deadline)\b/.test(q) || q.includes("when is") || q.includes("ship date")) {
    return {
      target: "due",
      title: "Due date",
      reply: `The due date is the day this project is expected to land. ${star.label} is due ${star.due}. The smaller line under the date is when the record last changed: ${star.updated}.`,
    };
  }

  if (/\b(owner|whose)\b/.test(q) || q.includes("who owns") || q.includes("responsible") || q.includes("who is on") || /\bwho\b/.test(q)) {
    return {
      target: "owner",
      title: "Owner",
      reply: `The owner is the person accountable for the project. ${star.owner} owns ${star.label}. The two letters in the circle are their initials.`,
    };
  }

  if (/\b(activity|chart|trend)\b/.test(q) || q.includes("over time") || q.includes("eight week") || q.includes("8 week")) {
    return {
      target: "activity",
      title: "Activity",
      reply: `The activity chart is the last 8 weeks of ${star.label}. The solid line is updates: changes recorded in the tools. The dashed line is mentions: times people talked about the work. This week there are ${updates.at(-1)} updates (${signed(updateChange)} from last week) and ${mentions.at(-1)} mentions (${signed(mentionChange)}).`,
    };
  }

  if (/open task|how many open/.test(q)) {
    return {
      target: "open",
      title: "Open tasks",
      reply: `Open tasks are everything not finished yet: in progress, blocked, and not started. ${star.label} has ${open} open, and ${star.tasks.blocked} of those are blocked.`,
    };
  }

  if (/\bmentions?\b/.test(q)) {
    return {
      target: "mentions",
      title: "Mentions this week",
      reply: `Mentions this week counts how often people talked about ${star.label} in the latest week of the chart. The count is ${mentions.at(-1)}, ${signed(mentionChange)} versus the week before.`,
    };
  }

  if (/\b(donut|task|tasks|breakdown)\b/.test(q) || q.includes("in progress") || q.includes("not started")) {
    return {
      target: "tasks",
      title: "Tasks by status",
      reply: `The donut splits every task on ${star.label} by state. Done is finished, in progress is being worked, blocked is stuck, and not started is still queued. Right now that is ${taskSentence(star)}.`,
    };
  }

  if (/\bblocked\b/.test(q)) {
    const company = STARS.filter((item) => item.status === "blocked").map((item) => item.label);
    const list = company.length
      ? `The blocked projects across the company are ${company.join(" and ")}.`
      : "No project is blocked right now.";
    return {
      target: star.tasks.blocked > 0 || star.status === "blocked" ? "tasks" : "status",
      title: "Blocked",
      reply: `Blocked means the work is waiting on something else. ${star.label} is ${statusLabel(star.status).toLowerCase()} and has ${star.tasks.blocked} blocked tasks. ${star.summary} ${list}`,
    };
  }

  if (/\b(status)\b/.test(q) || q.includes("on track") || q.includes("at risk") || q.includes("why is")) {
    return {
      target: "status",
      title: "Status",
      reply: `${star.label} is marked ${statusLabel(star.status)}. ${STATUS_TEACH[star.status]} The task mix behind that mark is ${taskSentence(star)}.`,
    };
  }

  const row = star.updates.findIndex((update) => {
    if (q.includes(update.source.toLowerCase()) || q.includes(update.author.toLowerCase())) return true;
    const words = `${update.change}`.toLowerCase().split(/[^a-z0-9$]+/).filter((word) => word.length > 4);
    return words.filter((word) => q.includes(word)).length >= 2;
  });
  if (row >= 0) {
    const update = star.updates[row];
    return {
      target: `update-${row}`,
      title: update.source,
      reply: `This row is one entry in Recent updates, the paper trail for ${star.label}. On ${update.date}, ${update.author} recorded this in ${update.source}: ${update.change}.`,
    };
  }

  if (/\bupdates this week\b/.test(q)) {
    return {
      target: "updates-week",
      title: "Updates this week",
      reply: `Updates this week is the latest point on the solid line of the activity chart. ${star.label} recorded ${updates.at(-1)} updates, ${signed(updateChange)} versus the week before.`,
    };
  }

  if (/\b(updates|history|latest|today)\b/.test(q) || q.includes("what changed") || q.includes("what change")) {
    return {
      target: "updates",
      title: "Recent updates",
      reply: `Recent updates is the paper trail. Each row is one change, with the tool it came from, who made it, and when. The latest on ${star.label} is ${latest.date}: ${latest.author}, in ${latest.source}, ${updateChangeSentence(latest.change)}.`,
    };
  }

  if (mentionsStar(q, star) || /this project|what is this|what am i looking|explain this|\bsummary\b|tell me about/.test(q)) {
    return {
      target: "summary",
      title: star.label,
      reply: `${star.label} is a ${DOMAIN_LABEL[star.domain].toLowerCase()} project. ${star.summary} It is ${statusLabel(star.status).toLowerCase()}, ${star.owner} owns it, and it is due ${star.due}.`,
    };
  }

  return null;
}

function updateChangeSentence(change: string) {
  return change.charAt(0).toLowerCase() + change.slice(1);
}
