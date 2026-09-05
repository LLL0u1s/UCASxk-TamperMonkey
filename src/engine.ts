import { navigateGet, navigationStatus, submitNavigation } from "./navigation";
import { recognizeCaptcha } from "./ocr";
import {
  containsRiskMarker,
  hasSeat,
  isAuthenticated,
  parseQueryPage,
  parseSelectedCodes,
  parseSubmitBatch,
} from "./parser";
import { downloadSidCache, makeSidCache } from "./sid";
import { appendLog, loadState, saveState } from "./storage";
import type {
  CourseLookup,
  NamedField,
  RunState,
  SidCache,
  StartOptions,
} from "./types";

const MAIN_PATH = "/courseManage/main";
const SELECT_PATH = "/courseManage/selectCourse";
const SAVE_PATH = "/courseManage/saveCourse";
const CAPTCHA_PATH = "/captchaImage";
let running = false;

function randomBetween(minimum: number, maximum: number): number {
  return minimum + Math.random() * (maximum - minimum);
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, seconds * 1000));
}

function removeCode(values: string[], code: string): string[] {
  return values.filter((value) => value !== code);
}

function occupancy(lookup: CourseLookup): string {
  const { selected, limit } = lookup.row;
  return selected === null || limit === null ? "?/?" : `${selected}/${limit}`;
}

function currentPath(): string {
  return window.location.pathname;
}

function newState(options: StartOptions): RunState {
  const directLookups: Record<string, CourseLookup> = {};
  if (options.mode === "direct") {
    const records = new Map((options.sidCache?.courses ?? []).map((row) => [row.code, row]));
    for (const code of options.codes) {
      const row = records.get(code);
      if (!row) throw new Error(`SID 文件缺少课程编码: ${code}`);
      directLookups[code] = { row, hiddenFields: [] };
    }
  }
  return {
    schemaVersion: 1,
    runId: crypto.randomUUID(),
    active: true,
    paused: false,
    mode: options.mode,
    phase: options.mode === "direct" ? "captcha" : "read_selected",
    pendingCodes: [...options.codes],
    roundCodes: [],
    queryIndex: 0,
    lookups: directLookups,
    courseStatus: Object.fromEntries(options.codes.map((code) => [code, "等待处理"])),
    availableCodes: options.mode === "direct" ? [...options.codes] : [],
    attempts: { captchaImages: 0, submit: 0 },
    expectedPath: options.mode === "direct" ? currentPath() : MAIN_PATH,
    intervalMin: options.intervalMin,
    intervalMax: options.intervalMax,
    ocrUrl: options.ocrUrl,
    logs: [],
    startedAt: new Date().toISOString(),
  };
}

export function startRun(options: StartOptions): void {
  if (!options.codes.length) throw new Error("请至少填写一个课程编码");
  if (options.intervalMin < 0.2 || options.intervalMax < options.intervalMin) {
    throw new Error("轮询间隔必须满足 0.2 ≤ 最小值 ≤ 最大值");
  }
  const state = appendLog(newState(options), `任务已启动：${options.mode}，共 ${options.codes.length} 门课程`);
  saveState(state);
  if (state.mode === "direct") {
    void resumeRun();
  } else {
    navigateGet(MAIN_PATH);
  }
}

export function pauseRun(): void {
  const state = loadState();
  if (!state?.active) return;
  state.paused = true;
  appendLog(state, "任务已暂停；当前导航无法撤回，不会再发出下一次请求");
  saveState(state);
}

export function continueRun(): void {
  const state = loadState();
  if (!state?.active) return;
  state.paused = false;
  appendLog(state, "任务继续运行");
  saveState(state);
  void resumeRun();
}

export function stopRun(reason = "用户停止任务"): void {
  const state = loadState();
  if (!state) return;
  state.active = false;
  state.paused = false;
  state.phase = "stopped";
  state.expectedPath = currentPath();
  appendLog(state, reason);
  saveState(state);
}

function fail(state: RunState, reason: string): void {
  state.active = false;
  state.paused = false;
  state.phase = "stopped";
  state.expectedPath = currentPath();
  appendLog(state, `已安全停止：${reason}`);
  saveState(state);
}

function complete(state: RunState, message: string): void {
  state.active = false;
  state.paused = false;
  state.phase = "completed";
  state.expectedPath = currentPath();
  appendLog(state, message);
  saveState(state);
}

function checkPageSafety(state: RunState): boolean {
  if (currentPath() !== state.expectedPath) {
    fail(state, `页面路径与任务阶段不一致（预期 ${state.expectedPath}，实际 ${currentPath()}）`);
    return false;
  }
  const status = navigationStatus();
  if (status === 403 || status === 429 || (status !== undefined && status >= 500)) {
    fail(state, `页面返回 HTTP ${status}`);
    return false;
  }
  const html = document.documentElement?.outerHTML ?? "";
  if (containsRiskMarker(html)) {
    fail(state, "检测到频率限制或风控提示");
    return false;
  }
  if (currentPath().includes("/user/login") || !isAuthenticated(document)) {
    fail(state, "xkgo 会话已失效，请重新登录");
    return false;
  }
  return true;
}

function submitQuery(state: RunState): void {
  if (state.queryIndex >= state.roundCodes.length) {
    void finishRound(state).catch((error: unknown) => {
      const latest = loadState();
      if (latest?.active && latest.runId === state.runId) {
        fail(latest, error instanceof Error ? error.message : String(error));
      }
    });
    return;
  }
  const code = state.roundCodes[state.queryIndex];
  if (!code) {
    fail(state, "查询队列状态损坏");
    return;
  }
  state.currentCode = code;
  state.phase = "query_result";
  state.expectedPath = SELECT_PATH;
  state.courseStatus[code] = "正在查询";
  appendLog(state, `${code}: 查询课程`);
  saveState(state);
  submitNavigation(SELECT_PATH, [
    { name: "type", value: "" },
    { name: "deptIds1", value: "" },
    { name: "courseType1", value: "" },
    { name: "courseCode", value: code },
    { name: "courseName", value: "" },
  ]);
}

function beginRound(state: RunState): void {
  if (!state.pendingCodes.length) {
    complete(state, "所有目标课程均已处理；未提交最终选课单");
    return;
  }
  state.roundCodes = [...state.pendingCodes];
  state.queryIndex = 0;
  state.currentCode = undefined;
  state.lookups = {};
  state.availableCodes = [];
  submitQuery(state);
}

function handleReadSelected(state: RunState): void {
  if (state.mode !== "prepare_sids") {
    const selected = parseSelectedCodes(document);
    for (const code of [...state.pendingCodes]) {
      if (selected.has(code)) {
        state.pendingCodes = removeCode(state.pendingCodes, code);
        state.courseStatus[code] = "已在预选列表";
        appendLog(state, `${code}: 已在预选列表中`);
      }
    }
  }
  if (!state.pendingCodes.length) {
    complete(state, "所有目标课程已在预选列表；未提交最终选课单");
    return;
  }
  state.phase = "open_select";
  state.expectedPath = SELECT_PATH;
  saveState(state);
  navigateGet(SELECT_PATH);
}

function handleOpenSelect(state: RunState): void {
  const page = parseQueryPage(document);
  if (!page.authenticated) {
    fail(state, "xkgo 会话已失效，请重新登录");
    return;
  }
  beginRound(state);
}

function handleQueryResult(state: RunState): void {
  const code = state.currentCode;
  if (!code || state.roundCodes[state.queryIndex] !== code) {
    fail(state, "查询结果与持久化队列不一致");
    return;
  }
  const page = parseQueryPage(document);
  const row = page.courses.find((course) => course.code.trim().toLowerCase() === code.toLowerCase());
  if (!row) {
    if (state.mode === "prepare_sids") {
      fail(state, `${code}: 未在当前课程类型中找到，未生成 SID 文件`);
      return;
    }
    state.pendingCodes = removeCode(state.pendingCodes, code);
    state.courseStatus[code] = "未找到";
    appendLog(state, `${code}: 未在当前课程类型中找到，已移出队列`);
  } else {
    const lookup: CourseLookup = { row, hiddenFields: page.hiddenFields };
    state.lookups[code] = lookup;
    if (state.mode === "prepare_sids") {
      state.courseStatus[code] = `SID 已获取 (${occupancy(lookup)})`;
      appendLog(state, `${code} ${row.name}: SID 已获取 (${occupancy(lookup)})`);
    } else if (state.mode === "watch") {
      if (hasSeat(row)) {
        state.pendingCodes = removeCode(state.pendingCodes, code);
        state.courseStatus[code] = `当前可选 (${occupancy(lookup)})`;
        appendLog(state, `${code} ${row.name}: 当前可选 (${occupancy(lookup)})`);
      } else {
        state.courseStatus[code] = `暂不可选 (${occupancy(lookup)})`;
        appendLog(state, `${code} ${row.name}: 暂不可选 (${occupancy(lookup)})`);
      }
    } else if (hasSeat(row)) {
      state.availableCodes.push(code);
      state.courseStatus[code] = `发现余量 (${occupancy(lookup)})`;
    } else {
      state.courseStatus[code] = `暂不可选 (${occupancy(lookup)})`;
      appendLog(state, `${code} ${row.name}: 暂不可选 (${occupancy(lookup)})`);
    }
  }
  state.queryIndex += 1;
  state.currentCode = undefined;
  saveState(state);
  submitQuery(state);
}

async function finishRound(state: RunState): Promise<void> {
  if (state.mode === "prepare_sids") {
    const cache = makeSidCache(state.roundCodes, state.lookups);
    downloadSidCache(cache);
    complete(state, `已生成 ${cache.courses.length} 门课程的 SID 文件`);
    return;
  }
  if (state.mode === "watch") {
    if (!state.pendingCodes.length) {
      complete(state, "目标课程已出现余量；观察模式未提交任何课程");
      return;
    }
    await waitAndContinue(state);
    return;
  }
  if (!state.availableCodes.length) {
    await waitAndContinue(state);
    return;
  }
  state.phase = "captcha";
  state.expectedPath = currentPath();
  state.attempts = { captchaImages: 0, submit: 0 };
  appendLog(state, `发现 ${state.availableCodes.length} 门可选课程，准备获取一张验证码`);
  saveState(state);
  await handleCaptcha(state);
}

async function waitAndContinue(state: RunState): Promise<void> {
  if (!state.pendingCodes.length) {
    complete(state, "所有目标课程均已处理；未提交最终选课单");
    return;
  }
  state.phase = "waiting";
  state.expectedPath = currentPath();
  saveState(state);
  await sleep(randomBetween(state.intervalMin, state.intervalMax));
  const latest = loadState();
  if (!latest?.active || latest.paused || latest.runId !== state.runId) return;
  if (latest.mode === "direct") {
    latest.availableCodes = [...latest.pendingCodes];
    latest.attempts = { captchaImages: 0, submit: 0 };
    latest.phase = "captcha";
    saveState(latest);
    await handleCaptcha(latest);
  } else {
    beginRound(latest);
  }
}

function validateCaptchaPayload(payload: string): void {
  if (!payload.startsWith("data:image/png;base64,")) {
    throw new Error("验证码接口未返回 PNG data URL");
  }
  const encoded = payload.slice(payload.indexOf(",") + 1);
  let bytes: string;
  try {
    bytes = atob(encoded);
  } catch {
    throw new Error("验证码接口返回了无效 Base64");
  }
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (signature.some((byte, index) => bytes.charCodeAt(index) !== byte)) {
    throw new Error("验证码接口返回的内容不是有效 PNG");
  }
}

async function fetchCaptcha(): Promise<string> {
  const response = await fetch(CAPTCHA_PATH, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "*/*", "X-Requested-With": "XMLHttpRequest" },
  });
  const text = (await response.text()).trim();
  if (response.status === 403 || response.status === 429 || response.status >= 500) {
    throw new Error(`验证码接口返回 HTTP ${response.status}`);
  }
  if (!response.ok) throw new Error(`验证码接口返回 HTTP ${response.status}`);
  if (containsRiskMarker(text)) throw new Error("验证码接口返回频率限制或风控提示");
  validateCaptchaPayload(text);
  return text;
}

async function handleCaptcha(state: RunState): Promise<void> {
  while (state.attempts.captchaImages < 5) {
    const latest = loadState();
    if (!latest?.active || latest.paused || latest.runId !== state.runId) return;
    state = latest;
    const firstImage = state.attempts.submit === 0 && state.attempts.captchaImages === 0;
    await sleep(randomBetween(firstImage ? 0.2 : 0.2, firstImage ? 0.4 : 0.3));
    const afterDelay = loadState();
    if (!afterDelay?.active || afterDelay.paused || afterDelay.runId !== state.runId) return;
    state = afterDelay;
    try {
      const payload = await fetchCaptcha();
      const beforeOcr = loadState();
      if (!beforeOcr?.active || beforeOcr.paused || beforeOcr.runId !== state.runId) return;
      state = beforeOcr;
      const result = await recognizeCaptcha(state.ocrUrl, payload);
      const afterOcr = loadState();
      if (!afterOcr?.active || afterOcr.paused || afterOcr.runId !== state.runId) return;
      state = afterOcr;
      state.attempts.captchaImages += 1;
      if (!result.accepted) {
        appendLog(state, `第 ${state.attempts.captchaImages} 张验证码未达到识别阈值`);
        saveState(state);
        continue;
      }
      appendLog(state, `验证码识别通过（置信度 ${result.confidence.toFixed(3)}）`);
      saveState(state);
      await sleep(randomBetween(3.0, 3.5));
      const beforeSubmit = loadState();
      if (!beforeSubmit?.active || beforeSubmit.paused || beforeSubmit.runId !== state.runId) return;
      submitAvailable(beforeSubmit, result.text);
      return;
    } catch (error) {
      const latest = loadState();
      if (latest?.active && latest.runId === state.runId) {
        fail(latest, error instanceof Error ? error.message : String(error));
      }
      return;
    }
  }
  fail(state, "连续五张验证码均未达到识别阈值");
}

function submitAvailable(state: RunState, captcha: string): void {
  const lookups = state.availableCodes.map((code) => state.lookups[code]);
  if (lookups.some((lookup) => !lookup)) {
    fail(state, "待提交课程缺少 SID 查询结果");
    return;
  }
  const fields: NamedField[] = [{ name: "vcode", value: captcha }];
  if (state.mode !== "direct") fields.push(...(lookups.at(-1)?.hiddenFields ?? []));
  fields.push(...lookups.map((lookup) => ({ name: "sids", value: lookup!.row.sid })));
  state.attempts.submit += 1;
  state.phase = "submit_result";
  state.expectedPath = SAVE_PATH;
  for (const code of state.availableCodes) state.courseStatus[code] = "正在加入预选";
  appendLog(state, `正在一次批量提交 ${state.availableCodes.length} 门课程`);
  saveState(state);
  submitNavigation(SAVE_PATH, fields);
}

async function handleSubmitResult(state: RunState): Promise<void> {
  await sleep(0.25);
  const latest = loadState();
  if (!latest?.active || latest.paused || latest.runId !== state.runId) return;
  state = latest;
  const courses = state.availableCodes.map((code) => state.lookups[code]?.row).filter(Boolean) as CourseLookup["row"][];
  if (courses.length !== state.availableCodes.length) {
    fail(state, "提交结果缺少课程上下文");
    return;
  }
  const outcomes = parseSubmitBatch(document, courses);
  const allCaptchaErrors = courses.every((course) => outcomes[course.code]?.result === "captcha_error");
  if (allCaptchaErrors) {
    if (state.attempts.submit >= 3) {
      fail(state, "验证码连续三次被服务端拒绝");
      return;
    }
    state.phase = "captcha";
    state.expectedPath = currentPath();
    state.attempts.captchaImages = 0;
    appendLog(state, `服务端拒绝验证码，准备第 ${state.attempts.submit + 1} 次提交`);
    saveState(state);
    await handleCaptcha(state);
    return;
  }

  let returnToPoll = false;
  for (const course of courses) {
    const outcome = outcomes[course.code];
    if (!outcome) {
      fail(state, `${course.code}: 无法解析提交结果`);
      return;
    }
    switch (outcome.result) {
      case "success":
      case "already_selected":
        state.pendingCodes = removeCode(state.pendingCodes, course.code);
        state.courseStatus[course.code] = "已加入预选";
        appendLog(state, `${course.code}: 已加入预选`);
        break;
      case "full":
        state.courseStatus[course.code] = "提交时余量已被占用";
        appendLog(state, `${course.code}: 提交时余量已被占用，返回轮询`);
        returnToPoll = true;
        break;
      case "time_conflict":
        state.pendingCodes = removeCode(state.pendingCodes, course.code);
        state.courseStatus[course.code] = "时间冲突";
        appendLog(state, `${course.code}: ${outcome.message ?? "与已选课程时间冲突"}`);
        break;
      case "session_expired":
        fail(state, "提交时会话失效，请重新登录");
        return;
      case "captcha_error":
      case "unknown":
        fail(state, `${course.code}: 无法确认提交结果${outcome.message ? `：${outcome.message}` : ""}`);
        return;
    }
  }
  state.availableCodes = [];
  saveState(state);
  if (!state.pendingCodes.length) {
    complete(state, "所有目标课程均已处理；仅加入预选，未提交最终选课单");
  } else if (returnToPoll || state.pendingCodes.length) {
    await waitAndContinue(state);
  }
}

async function dispatch(state: RunState): Promise<void> {
  switch (state.phase) {
    case "read_selected":
      handleReadSelected(state);
      break;
    case "open_select":
      handleOpenSelect(state);
      break;
    case "query_result":
      handleQueryResult(state);
      break;
    case "captcha":
      await handleCaptcha(state);
      break;
    case "submit_result":
      await handleSubmitResult(state);
      break;
    case "waiting":
      await waitAndContinue(state);
      break;
    case "completed":
    case "stopped":
      break;
  }
}

export async function resumeRun(): Promise<void> {
  if (running) return;
  const state = loadState();
  if (!state?.active || state.paused) return;
  running = true;
  try {
    if (!checkPageSafety(state)) return;
    await dispatch(state);
  } catch (error) {
    const latest = loadState();
    if (latest?.active) fail(latest, error instanceof Error ? error.message : String(error));
  } finally {
    running = false;
  }
}

export function directCodes(cache: SidCache): string[] {
  return cache.courses.map((course) => course.code);
}
