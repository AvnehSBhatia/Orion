import { describe, expect, it } from "vitest";
import { parseLeakedCalls } from "./chat";

describe("parseLeakedCalls", () => {
  it("recovers a set_dashboard call written as DSML text", () => {
    const text =
      '< | DSML | invoke name="set_dashboard">< | DSML | parameter name="title" string="true">Sales call</ | DSML | parameter>' +
      '< | DSML | parameter name="widgets" string="false">[{"id":"a","kind":"kpi","title":"Sellable","size":"sm","metric":"sellable","filter":null,"text":null}]</ | DSML | parameter></ | DSML | invoke>';
    const [call] = parseLeakedCalls(text);
    expect(call.name).toBe("set_dashboard");
    expect(call.args.title).toBe("Sales call");
    expect(Array.isArray(call.args.widgets)).toBe(true);
  });
});
