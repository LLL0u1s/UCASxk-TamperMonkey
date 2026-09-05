import type {
  CourseRow,
  NamedField,
  SubmitOutcome,
} from "./types";

const LOGIN_MARKERS = ['name="pwd"', 'id="sepform"', "登录 sep"];
const RISK_MARKERS = ["过于频繁", "操作频繁", "rate limit", "too many requests"];
const CONFLICT_PATTERN = /你选择的课程名称为.*?上课时间冲突.*?谢谢[！!]/g;

export interface QueryPage {
  authenticated: boolean;
  courses: CourseRow[];
  hiddenFields: NamedField[];
}

function compact(text: string): string {
  return text.replace(/\s+/g, "");
}

function integer(text: string): number | null {
  const match = text.replaceAll(",", "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function cellText(cells: Element[], index: number | undefined): string {
  return index === undefined || !cells[index]
    ? ""
    : (cells[index].textContent ?? "").trim().replace(/\s+/g, " ");
}

export function parseQueryPage(doc: Document): QueryPage {
  const html = doc.documentElement?.outerHTML.toLowerCase() ?? "";
  const authenticated = !LOGIN_MARKERS.some((marker) => html.includes(marker));
  const form = doc.querySelector<HTMLFormElement>("form#regfrm");
  const hiddenFields: NamedField[] = [];
  form?.querySelectorAll<HTMLInputElement>('input[name][type="hidden"]').forEach((input) => {
    hiddenFields.push({ name: input.name, value: input.value });
  });

  const courses: CourseRow[] = [];
  doc.querySelectorAll("table").forEach((table) => {
    const headers = [...table.querySelectorAll("tr th")].map((cell) =>
      (cell.textContent ?? "").trim().replace(/\s+/g, " "),
    );
    const codeIndex = headers.indexOf("课程编码");
    if (codeIndex < 0) return;
    const nameIndex = headers.indexOf("课程名称");
    const limitIndex = headers.indexOf("限选");
    const selectedIndex = headers.indexOf("已选");

    table.querySelectorAll("tr").forEach((tr) => {
      const cells = [...tr.children].filter((cell) => cell.tagName === "TD");
      const sidInput = tr.querySelector<HTMLInputElement>('input[name="sids"]');
      if (!cells.length || !sidInput?.value) return;
      courses.push({
        code: cellText(cells, codeIndex),
        name: cellText(cells, nameIndex >= 0 ? nameIndex : undefined),
        limit: limitIndex >= 0 ? integer(cellText(cells, limitIndex)) : null,
        selected: selectedIndex >= 0 ? integer(cellText(cells, selectedIndex)) : null,
        sid: sidInput.value,
        selectable: !sidInput.disabled,
      });
    });
  });
  return { authenticated, courses, hiddenFields };
}

export function parseSelectedCodes(doc: Document): Set<string> {
  const codes = new Set<string>();
  doc.querySelectorAll("table").forEach((table) => {
    const headers = [...table.querySelectorAll("tr th")].map((cell) =>
      (cell.textContent ?? "").trim().replace(/\s+/g, " "),
    );
    const index = headers.indexOf("课程编码");
    if (index < 0) return;
    table.querySelectorAll("tr").forEach((tr) => {
      const cells = [...tr.children].filter((cell) => cell.tagName === "TD");
      const code = cellText(cells, index);
      if (code) codes.add(code);
    });
  });
  return codes;
}

export function hasSeat(row: CourseRow): boolean {
  if (!row.selectable) return false;
  return row.limit === null || row.selected === null || row.selected < row.limit;
}

export function containsRiskMarker(text: string): boolean {
  const lower = text.toLowerCase();
  return RISK_MARKERS.some((marker) => lower.includes(marker));
}

export function isAuthenticated(doc: Document): boolean {
  const html = doc.documentElement?.outerHTML.toLowerCase() ?? "";
  return !LOGIN_MARKERS.some((marker) => html.includes(marker));
}

function feedbackText(doc: Document): string | undefined {
  const label = doc.querySelector("label#loginError");
  if (!label) return undefined;
  const lines = (label.textContent ?? "")
    .split(/\n+/)
    .map((line) => line.trim().replace(/\s+/g, " "));
  return unique(lines).join("\n") || undefined;
}

export function parseSubmitBatch(
  doc: Document,
  courses: Array<Pick<CourseRow, "code" | "name">>,
): Record<string, SubmitOutcome> {
  const text = (doc.body?.textContent ?? "").trim().replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  const feedback = feedbackText(doc);
  const conflictSource = compact(feedback ?? text);
  const conflictMessages = unique(conflictSource.match(CONFLICT_PATTERN) ?? []);
  const conflictMessage = conflictMessages.join("\n") || feedback || "检测到上课时间冲突";
  const successNames = new Set(
    [...text.matchAll(/课程\s*\[([^\]]+)\]\s*选课成功/g)].map((match) => match[1]?.trim() ?? ""),
  );
  const outcomes: Record<string, SubmitOutcome> = {};

  for (const course of courses) {
    if (
      text.includes("选课成功") &&
      (text.includes(course.code) ||
        (Boolean(course.name) && successNames.has(course.name)) ||
        (Boolean(course.name) && compact(text).includes(`课程[${course.name}]选课成功`)))
    ) {
      outcomes[course.code] = { result: "success" };
    } else if (
      conflictSource.includes("上课时间冲突") &&
      (courses.length === 1 ||
        (Boolean(course.name) && conflictSource.includes(course.name)) ||
        (Boolean(course.code) && conflictSource.includes(course.code)))
    ) {
      outcomes[course.code] = { result: "time_conflict", message: conflictMessage };
    } else if (["已经选择", "已选过", "重复选课"].some((word) => text.includes(word))) {
      outcomes[course.code] = { result: "already_selected" };
    } else if (
      text.includes("验证码") &&
      ["错误", "不正确", "失效", "过期", "异常"].some((word) => text.includes(word))
    ) {
      outcomes[course.code] = { result: "captcha_error" };
    } else if (["已满", "没有余量", "人数已达上限"].some((word) => text.includes(word))) {
      outcomes[course.code] = { result: "full" };
    } else if (LOGIN_MARKERS.some((marker) => lower.includes(marker))) {
      outcomes[course.code] = { result: "session_expired" };
    } else if (conflictSource.includes("上课时间冲突")) {
      outcomes[course.code] = { result: "unknown", message: conflictMessage };
    } else {
      outcomes[course.code] = { result: "unknown", ...(feedback ? { message: feedback } : {}) };
    }
  }
  return outcomes;
}
