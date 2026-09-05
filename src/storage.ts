import type { RunState } from "./types";

const STATE_KEY = "ucasxk.run-state.v1";

function validState(value: unknown): value is RunState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<RunState>;
  return (
    state.schemaVersion === 1 &&
    typeof state.runId === "string" &&
    typeof state.active === "boolean" &&
    typeof state.paused === "boolean" &&
    Array.isArray(state.pendingCodes) &&
    typeof state.expectedPath === "string"
  );
}

export function loadState(): RunState | null {
  const raw = GM_getValue<unknown>(STATE_KEY, null);
  if (raw === null) return null;
  if (!validState(raw)) {
    GM_deleteValue(STATE_KEY);
    return null;
  }
  return raw;
}

export function saveState(state: RunState): void {
  GM_setValue(STATE_KEY, state);
  window.dispatchEvent(new CustomEvent("ucasxk-state-change", { detail: state }));
}

export function clearState(): void {
  GM_deleteValue(STATE_KEY);
  window.dispatchEvent(new CustomEvent("ucasxk-state-change", { detail: null }));
}

export function appendLog(state: RunState, message: string): RunState {
  state.logs.push({ at: new Date().toISOString(), message });
  state.logs = state.logs.slice(-100);
  return state;
}
