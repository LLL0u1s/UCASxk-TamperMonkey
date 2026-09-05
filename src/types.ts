export type RunMode = "watch" | "enroll" | "prepare_sids" | "direct";

export type SubmitResult =
  | "success"
  | "captcha_error"
  | "full"
  | "already_selected"
  | "session_expired"
  | "time_conflict"
  | "unknown";

export type RunPhase =
  | "read_selected"
  | "open_select"
  | "query_result"
  | "captcha"
  | "submit_result"
  | "waiting"
  | "completed"
  | "stopped";

export interface NamedField {
  name: string;
  value: string;
}

export interface CourseRow {
  code: string;
  name: string;
  limit: number | null;
  selected: number | null;
  sid: string;
  selectable: boolean;
}

export interface CourseLookup {
  row: CourseRow;
  hiddenFields: NamedField[];
}

export interface SubmitOutcome {
  result: SubmitResult;
  message?: string;
}

export interface Attempts {
  captchaImages: number;
  submit: number;
}

export interface RunLog {
  at: string;
  message: string;
}

export interface RunState {
  schemaVersion: 1;
  runId: string;
  active: boolean;
  paused: boolean;
  mode: RunMode;
  phase: RunPhase;
  pendingCodes: string[];
  roundCodes: string[];
  queryIndex: number;
  currentCode?: string;
  lookups: Record<string, CourseLookup>;
  courseStatus: Record<string, string>;
  availableCodes: string[];
  attempts: Attempts;
  expectedPath: string;
  intervalMin: number;
  intervalMax: number;
  ocrUrl: string;
  logs: RunLog[];
  startedAt: string;
}

export interface SidRecord extends CourseRow {}

export interface SidCache {
  version: 1;
  created_at: string;
  courses: SidRecord[];
}

export interface StartOptions {
  mode: RunMode;
  codes: string[];
  intervalMin: number;
  intervalMax: number;
  ocrUrl: string;
  sidCache?: SidCache;
}

export interface OcrResponse {
  text: string;
  confidence: number;
  accepted: boolean;
}
