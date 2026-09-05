import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  navigateGet: vi.fn(),
  submitNavigation: vi.fn(),
  navigationStatus: vi.fn(() => 200),
}));

vi.mock("../src/navigation", () => navigation);

import { pauseRun, resumeRun, startRun } from "../src/engine";
import type { RunState } from "../src/types";

let values: Map<string, unknown>;

beforeEach(() => {
  values = new Map();
  navigation.navigateGet.mockReset();
  navigation.submitNavigation.mockReset();
  Object.assign(globalThis, {
    GM_getValue: (key: string, fallback: unknown) => values.get(key) ?? fallback,
    GM_setValue: (key: string, value: unknown) => values.set(key, structuredClone(value)),
    GM_deleteValue: (key: string) => values.delete(key),
  });
});

function state(): RunState {
  return values.get("ucasxk.run-state.v1") as RunState;
}

describe("persistent run state", () => {
  it("checkpoints before navigating to the main page", () => {
    startRun({
      mode: "enroll",
      codes: ["A", "B"],
      intervalMin: 0.8,
      intervalMax: 1.8,
      ocrUrl: "http://127.0.0.1:8765",
    });
    expect(state()).toMatchObject({
      schemaVersion: 1,
      active: true,
      phase: "read_selected",
      pendingCodes: ["A", "B"],
      expectedPath: "/courseManage/main",
    });
    expect(navigation.navigateGet).toHaveBeenCalledWith("/courseManage/main");
  });

  it("pauses without deleting the checkpoint", () => {
    startRun({
      mode: "watch",
      codes: ["A"],
      intervalMin: 0.8,
      intervalMax: 1.8,
      ocrUrl: "http://127.0.0.1:8765",
    });
    pauseRun();
    expect(state().paused).toBe(true);
    expect(state().active).toBe(true);
  });

  it("stops safely when a restored page does not match the expected path", async () => {
    startRun({
      mode: "watch",
      codes: ["A"],
      intervalMin: 0.8,
      intervalMax: 1.8,
      ocrUrl: "http://127.0.0.1:8765",
    });
    await resumeRun();
    expect(state().active).toBe(false);
    expect(state().phase).toBe("stopped");
    expect(state().logs.at(-1)?.message).toMatch(/页面路径与任务阶段不一致/);
  });
});
