import type { Status } from "@/lib/api/types";

export type { Status };

export const STATUSES: Status[] = ["blocked", "at_risk", "on_track", "done", "unknown"];

export const STATUS_LABEL: Record<Status, string> = {
  on_track: "On track",
  at_risk: "At risk",
  blocked: "Blocked",
  done: "Done",
  unknown: "Unknown",
};

export const statusLabel = (status: Status) => STATUS_LABEL[status];

// Grey ramp matching StatusMark: the louder the problem, the brighter the ink.
export const STATUS_TONE: Record<Status, string> = {
  blocked: "#ededed",
  at_risk: "#b5b5b5",
  on_track: "#7a7a7a",
  done: "#3e3e3e",
  unknown: "#262626",
};

// Lower sorts first: what needs attention leads.
export const STATUS_RANK: Record<Status, number> = { blocked: 0, at_risk: 1, on_track: 2, unknown: 3, done: 4 };
