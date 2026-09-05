import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences } from "../src/preferences";

let values: Map<string, unknown>;

beforeEach(() => {
  values = new Map();
  Object.assign(globalThis, {
    GM_getValue: (key: string, fallback: unknown) => values.get(key) ?? fallback,
    GM_setValue: (key: string, value: unknown) => values.set(key, structuredClone(value)),
    GM_deleteValue: (key: string) => values.delete(key),
  });
});

describe("UI preferences", () => {
  it("restores course input, mode, layout, and imported SID data", () => {
    savePreferences({
      schemaVersion: 1,
      mode: "watch",
      codesText: "A\nB",
      intervalMin: 1,
      intervalMax: 2,
      ocrUrl: "http://127.0.0.1:8765",
      collapsed: true,
      sidFileName: "sids.json",
      sidCache: {
        version: 1,
        created_at: "2026-09-05T00:00:00Z",
        courses: [{ code: "A", name: "课程 A", sid: "sid-a", limit: 10, selected: 9, selectable: true }],
      },
    });

    expect(loadPreferences()).toMatchObject({
      mode: "watch",
      codesText: "A\nB",
      collapsed: true,
      sidFileName: "sids.json",
      intervalMin: 3,
      intervalMax: 3.1,
    });
    expect(loadPreferences().sidCache?.courses[0]?.code).toBe("A");
  });

  it("falls back safely when no preferences exist", () => {
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });
});
