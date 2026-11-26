import { beforeEach, describe, expect, it, vi } from "vitest";
import { savePreferences } from "../src/preferences";
import { mountPanel } from "../src/ui";

vi.mock("../src/navigation", () => ({
  navigateGet: vi.fn(), navigationStatus: () => 200, submitNavigation: vi.fn(),
}));

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

describe("task views", () => {
  it("shows the action and applicable fields for each mode", () => {
    mountPanel();
    const root = document.getElementById("ucasxk-helper-host")!.shadowRoot!;
    const mode = root.querySelector<HTMLSelectElement>("#mode")!;
    for (const [value, action, sid, advanced] of [
      ["watch", "查询余量", true, false],
      ["prepare_sids", "导出 SID 文件", false, false],
      ["enroll", "开始自动预选", false, true],
      ["direct", "开始预选", true, true],
    ] as const) {
      mode.value = value;
      mode.dispatchEvent(new Event("change"));
      expect(root.getElementById("start")!.textContent).toBe(action);
      expect(root.getElementById("sid-area")!.hidden).toBe(!sid);
      expect(root.getElementById("advanced")!.hidden).toBe(!advanced);
    }
  });

  it("focuses the invalid field and clears its message on input", () => {
    mountPanel();
    const root = document.getElementById("ucasxk-helper-host")!.shadowRoot!;
    root.getElementById("start")!.click();
    const codes = root.getElementById("codes")!;
    expect(root.activeElement).toBe(codes);
    expect(codes.getAttribute("aria-invalid")).toBe("true");
    codes.dispatchEvent(new Event("input"));
    expect(root.getElementById("codes-error")!.textContent).toBe("");
  });

  it("restores progress, toggles pause, displays the stop reason and returns to configuration", () => {
    values.set("ucasxk.run-state.v1", {
      schemaVersion: 1, runId: "local", active: true, paused: false, expectedPath: "/",
      phase: "query_result", mode: "watch", pendingCodes: ["A"], courseStatus: { A: "等待处理" }, logs: [],
    });
    mountPanel();
    const root = document.getElementById("ucasxk-helper-host")!.shadowRoot!;
    expect(root.getElementById("config")!.hidden).toBe(true);
    root.getElementById("pause")!.click();
    expect(root.getElementById("pause")!.textContent).toBe("继续");
    root.getElementById("collapse")!.click();
    expect(root.getElementById("badge")!.textContent).toBe("已暂停");
    root.getElementById("collapse")!.click();
    const saved = values.get("ucasxk.run-state.v1") as Record<string, unknown>;
    Object.assign(saved, { phase: "open_select", roundCodes: [], queryIndex: 0 });
    root.getElementById("pause")!.click();
    expect(root.getElementById("badge")!.textContent).toBe("运行中");
    root.getElementById("stop")!.click();
    expect(root.getElementById("result")!.textContent).toContain("用户停止任务");
    expect(root.getElementById("courses")!.textContent).toContain("A");
    root.getElementById("back")!.click();
    expect(root.getElementById("progress")!.hidden).toBe(true);
    expect(root.querySelector<HTMLTextAreaElement>("#codes")!.value).toBe("A");
  });
});

it("shows imported file details and reports malformed files beside the input", async () => {
  mountPanel();
  const root = document.getElementById("ucasxk-helper-host")!.shadowRoot!;
  const file = root.querySelector<HTMLInputElement>("#sid-file")!;
  const row = { code: "A", name: "课程 A", sid: "test", limit: 12, selected: 8, selectable: true };
  for (const [name, content] of [
    ["good.json", JSON.stringify({ version: 1, courses: [row] })],
    ["bad.json", "invalid"],
  ] as const) {
    Object.defineProperty(file, "files", { configurable: true, value: [{ name, text: async () => content }] });
    file.dispatchEvent(new Event("change"));
    await Promise.resolve();
    if (name === "good.json") {
      expect(root.getElementById("file-name")!.textContent).toContain("good.json · 1 门课程");
    } else {
      expect(root.getElementById("sid-file-error")!.textContent).toContain("JSON");
    }
  }
});

it("switches from configuration to progress when a watch task starts", () => {
  mountPanel();
  const root = document.getElementById("ucasxk-helper-host")!.shadowRoot!;
  root.querySelector<HTMLTextAreaElement>("#codes")!.value = "A";
  root.getElementById("start")!.click();
  expect(root.getElementById("config")!.hidden).toBe(true);
  expect(root.getElementById("stop")!.hidden).toBe(false);
  expect(root.getElementById("summary")!.textContent).toContain("读取预选列表");
});
