import type { RunMode, SidCache, UiPreferences } from "./types";

const PREFERENCES_KEY = "ucasxk.ui-preferences.v1";
const MODES: RunMode[] = ["watch", "enroll", "prepare_sids", "direct"];

export const DEFAULT_PREFERENCES: UiPreferences = {
  schemaVersion: 1,
  mode: "watch",
  codesText: "",
  intervalMin: 3,
  intervalMax: 3.1,
  ocrUrl: "http://127.0.0.1:8765",
  collapsed: false,
};

function validSidCache(value: unknown): value is SidCache {
  if (!value || typeof value !== "object") return false;
  const cache = value as Partial<SidCache>;
  return cache.version === 1 && Array.isArray(cache.courses);
}

export function loadPreferences(): UiPreferences {
  const raw = GM_getValue<unknown>(PREFERENCES_KEY, null);
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFERENCES };
  const value = raw as Partial<UiPreferences>;
  if (value.schemaVersion !== 1) {
    GM_deleteValue(PREFERENCES_KEY);
    return { ...DEFAULT_PREFERENCES };
  }
  const savedMinimum = typeof value.intervalMin === "number" && Number.isFinite(value.intervalMin)
    ? value.intervalMin
    : DEFAULT_PREFERENCES.intervalMin;
  const intervalMin = Math.max(DEFAULT_PREFERENCES.intervalMin, savedMinimum);
  const savedMaximum = typeof value.intervalMax === "number" && Number.isFinite(value.intervalMax)
    ? value.intervalMax
    : DEFAULT_PREFERENCES.intervalMax;
  const intervalMax = savedMaximum >= intervalMin
    ? savedMaximum
    : Math.max(DEFAULT_PREFERENCES.intervalMax, intervalMin);
  return {
    schemaVersion: 1,
    mode: MODES.includes(value.mode as RunMode) ? (value.mode as RunMode) : DEFAULT_PREFERENCES.mode,
    codesText: typeof value.codesText === "string" ? value.codesText : "",
    intervalMin,
    intervalMax,
    ocrUrl: typeof value.ocrUrl === "string" ? value.ocrUrl : DEFAULT_PREFERENCES.ocrUrl,
    collapsed: value.collapsed === true,
    ...(validSidCache(value.sidCache) ? { sidCache: value.sidCache } : {}),
    ...(typeof value.sidFileName === "string" ? { sidFileName: value.sidFileName } : {}),
  };
}

export function savePreferences(preferences: UiPreferences): void {
  GM_setValue(PREFERENCES_KEY, preferences);
}
