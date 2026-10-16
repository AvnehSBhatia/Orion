import { describe, expect, it } from "vitest";
import { usefulReadLinks, usefulTodo } from "./junk";

describe("usefulTodo", () => {
  it("drops short and verb-plus-number to-dos", () => {
    expect(usefulTodo("Update 230.")).toBeNull();
    expect(usefulTodo("Update 257")).toBeNull();
    expect(usefulTodo("Approve #12,500.")).toBeNull();
    expect(usefulTodo("Fix it")).toBeNull();
    expect(usefulTodo("   ")).toBeNull();
    expect(usefulTodo(null)).toBeNull();
    expect(usefulTodo("  Raise the daily budget to $1,200.  ")).toBe("Raise the daily budget to $1,200.");
  });
});

describe("usefulReadLinks", () => {
  const link = (url: string, title = url) => ({ title, url });

  it("drops search engines, browser pages, and non-web links, and keeps real pages", () => {
    const junk = [
      "https://duckduckgo.com/",
      "https://html.duckduckgo.com/html?q=x",
      "https://www.google.com/",
      "https://www.google.co.uk/search?q=x",
      "https://www.google.com/_/chrome/newtab",
      "https://www.bing.com/search?q=x",
      "https://search.yahoo.com/search?p=x",
      "https://www.yahoo.com/",
      "chrome://newtab/",
      "about:blank",
      "edge://newtab",
      "notes.md",
      "",
    ];
    const keep = ["https://ads.google.com/aw/campaigns", "https://docs.google.com/document/d/1", "https://example.com/docs/sso", "https://news.yahoo.com/story"];
    expect(usefulReadLinks([...junk, ...keep].map((u) => link(u))).map((l) => l.url)).toEqual(keep);
  });

  it("keeps the first link to the same page", () => {
    const out = usefulReadLinks([link("https://example.com/a", "A"), link("https://example.com/a/#top", "A again"), link("https://example.com/a?x=1", "B")]);
    expect(out.map((l) => l.title)).toEqual(["A", "B"]);
  });
});
