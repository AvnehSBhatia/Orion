import { describe, expect, it } from "vitest";
import { validZone } from "./time";

describe("validZone", () => {
  it("returns Intl's canonical spelling, so case variants share one cache entry", () => {
    expect(validZone("america/new_york")).toBe("America/New_York");
    expect(validZone("AMERICA/NEW_YORK")).toBe("America/New_York");
    expect(validZone("etc/utc")).toBe("UTC");
  });

  it("falls back to UTC for anything Intl does not know", () => {
    for (const tz of ["../../etc", "A".repeat(100_000), "", null, undefined, "Mars/Base"]) expect(validZone(tz)).toBe("UTC");
  });
});
