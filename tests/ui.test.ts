import { beforeEach, describe, expect, it } from "vitest";
import { savePreferences } from "../src/preferences";
import { mountPanel } from "../src/ui";

let values: Map<string, unknown>;

beforeEach(() => {
  values = new Map();
  document.getElementById("ucasxk-helper-host")?.remove();
  Object.assign(globalThis, {
    GM_getValue: (key: string, fallback: unknown) => values.get(key) ?? fallback,
    GM_setValue: (key: string, value: unknown) => values.set(key, structuredClone(value)),
    GM_deleteValue: (key: string) => values.delete(key),
  });
});

describe("persistent panel", () => {
  it("restores the selected page, course input, imported SID, and collapsed state", () => {
    savePreferences({
      schemaVersion: 1,
      mode: "watch",
      codesText: "A\nB",
      intervalMin: 3,
      intervalMax: 3.1,
      ocrUrl: "http://127.0.0.1:8765",
      collapsed: true,
      sidFileName: "saved.json",
      sidCache: {
        version: 1,
        created_at: "2026-09-05T00:00:00Z",
        courses: [{ code: "A", name: "课程 A", sid: "sid-a", limit: 10, selected: 9, selectable: true }],
      },
    });

    mountPanel();

    const root = document.getElementById("ucasxk-helper-host")!.shadowRoot!;
    expect(root.querySelector<HTMLSelectElement>("#mode")!.value).toBe("watch");
    expect(root.querySelector<HTMLTextAreaElement>("#codes")!.value).toBe("A\nB");
    expect(root.querySelector<HTMLElement>("#sid-area")!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>("#file-name")!.textContent).toContain("saved.json");
    expect(root.querySelector<HTMLElement>(".panel")!.classList.contains("collapsed")).toBe(true);
  });
});
