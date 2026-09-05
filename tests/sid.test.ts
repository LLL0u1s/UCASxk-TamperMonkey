import { describe, expect, it } from "vitest";
import { makeSidCache, parseCodes, parseSidCache, sidFilename } from "../src/sid";

describe("SID files", () => {
  it("keeps input order and ignores comments", () => {
    expect(parseCodes("B\n# comment\nA\nB\n")).toEqual(["B", "A"]);
  });

  it("accepts a source-compatible version 1 file", () => {
    const cache = parseSidCache(JSON.stringify({
      version: 1,
      created_at: "2026-09-05T00:00:00Z",
      courses: [{ code: "A", name: "课", sid: "ticket", limit: 10, selected: 9, selectable: true }],
    }));
    expect(cache.courses[0]?.sid).toBe("ticket");
  });

  it("rejects unsupported versions and empty sids", () => {
    expect(() => parseSidCache('{"version":2,"courses":[]}')).toThrow(/version 1/);
    expect(() => parseSidCache('{"version":1,"courses":[{"code":"A","name":"A","sid":"","limit":null,"selected":null,"selectable":true}]}')).toThrow(/SID 为空/);
  });

  it("exports rows in the requested order", () => {
    const cache = makeSidCache(["B", "A"], {
      A: { row: { code: "A", name: "A", sid: "a", limit: 1, selected: 0, selectable: true }, hiddenFields: [] },
      B: { row: { code: "B", name: "B", sid: "b", limit: 1, selected: 0, selectable: true }, hiddenFields: [] },
    });
    expect(cache.courses.map((row) => row.code)).toEqual(["B", "A"]);
  });

  it("adds local date and time to exported filenames", () => {
    expect(sidFilename(new Date(2026, 8, 5, 21, 7, 9))).toBe("ucasxk-sids-20260905-210709.json");
  });
});
