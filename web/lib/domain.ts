import type { Domain } from "@/lib/api/types";

export type { Domain };

/** Dashboard order (breakdowns, legends). */
export const DOMAINS: Domain[] = ["engineering", "sales", "marketing", "ops"];

/**
 * Map order, on purpose different from DOMAINS: it walks the map's hubs clockwise from the top left
 * (engineering, marketing, sales, ops), and the project sidebar lists teams in the same order.
 */
export const MAP_DOMAINS: Domain[] = ["engineering", "marketing", "sales", "ops"];

export const DOMAIN_LABEL: Record<Domain, string> = {
  engineering: "Engineering",
  sales: "Sales",
  marketing: "Marketing",
  ops: "Ops",
};

// The product is monochrome; domain tints are the only color, kept low-chroma so they read as light, not paint.
export const DOMAIN_TINT: Record<Domain, string> = {
  engineering: "#94b4e8",
  sales: "#e3c08a",
  marketing: "#d99bb8",
  ops: "#93cbb0",
};
