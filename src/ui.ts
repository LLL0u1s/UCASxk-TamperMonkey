import {
  continueRun,
  directCodes,
  pauseRun,
  startRun,
  stopRun,
} from "./engine";
import { normalizeOcrUrl } from "./ocr";
import { loadPreferences, savePreferences } from "./preferences";
import { parseCodes, parseSidCache } from "./sid";
import { clearState, loadState } from "./storage";
import type { RunPhase, RunMode, SidCache, UiPreferences } from "./types";

const MODE_DESCRIPTIONS: Record<RunMode, string> = {
  watch: "按课程编码查询一次当前余量，不提交；也可以导入 SID JSON 自动填充课程编码。",
  enroll: "实时查询最新 SID，发现余量后自动加入预选；选课首日推荐使用。",
  prepare_sids: "查询并导出带时间的 SID JSON，供之后直接提交；非选课首日推荐使用。",
  direct: "导入近期生成的 SID JSON，跳过课程查询并直接加入预选；非选课首日推荐使用。",
};

const PHASE_LABELS: Record<RunPhase, string> = {
  read_selected: "读取预选列表", open_select: "打开课程列表", query_result: "查询课程",
  captcha: "等待验证", submit_result: "读取预选结果", waiting: "等待下一轮",
  completed: "已完成", stopped: "已停止",
};
const ACTION_LABELS: Record<RunMode, string> = {
  watch: "查询余量", prepare_sids: "导出 SID 文件", enroll: "开始自动预选", direct: "开始预选",
};

export function mountPanel(): void {
  if (document.getElementById("ucasxk-helper-host")) return;
  const host = document.createElement("div");
  host.id = "ucasxk-helper-host";
  document.documentElement.append(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .panel { position: fixed; z-index: 2147483647; top: clamp(8px, 8vh, 72px); right: clamp(8px, 2vw, 20px);
        box-sizing:border-box; width: min(360px, calc(100vw - 16px)); max-height: calc(100vh - clamp(8px, 8vh, 72px) - 8px);
        max-height: calc(100dvh - clamp(8px, 8vh, 72px) - 8px); display:flex; flex-direction:column;
        color: #17212b; background: #fff; border: 1px solid #cbd5e1; border-radius: 12px;
        box-shadow: 0 16px 44px rgba(15,23,42,.22); font: 14px/1.5 "Inter", system-ui,-apple-system,"Segoe UI",sans-serif;
        overflow:hidden; }
      header { display:flex; justify-content:space-between; align-items:center; padding:11px 13px;
        background:#134e4a; color:#fff; border-radius:11px 11px 0 0; font-weight:700; flex:0 0 auto; }
      header button { background:transparent; border:0; color:#fff; cursor:pointer; font-size:17px; }
      main { padding:12px; min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; }
      [hidden], .collapsed main, .collapsed footer { display:none !important; }
      footer { display:flex; gap:8px; flex:none; padding:10px 12px; border-top:1px solid #dde6e4; }
      footer button { flex:1; }
      :focus-visible { outline:3px solid #168078; outline-offset:2px; }
      header :focus-visible { outline-color:white; }
      #badge { margin-inline-start:auto; font-size:12px; color:#e1f4ef; padding-inline:10px; }
      details { margin-top:12px; }
      summary { cursor:pointer; color:#245851; font-weight:600; }
      .error:empty { display:none; }
      .course, .summary, .file-name { overflow-wrap:anywhere; }
      #result { padding:9px; background:#edf5f3; border-inline-start:3px solid #287a6c; }
      .panel[data-status="已停止"] #result { background:#fff4ec; border-color:#af5825; }
      @media (max-height:480px) { .panel { top:4px; max-height:calc(100dvh - 8px); } }
      label { display:block; margin:8px 0 4px; color:#475569; font-weight:600; }
      textarea, select, input { box-sizing:border-box; width:100%; border:1px solid #cbd5e1; border-radius:6px;
        padding:7px 8px; background:#fff; color:#17212b; font:inherit; }
      textarea { min-height:72px; resize:vertical; }
      .row { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .buttons { display:flex; gap:7px; margin-top:11px; }
      button.action { border:0; border-radius:7px; padding:7px 11px; cursor:pointer; font:inherit; font-weight:650; }
      #start { background:#0f766e; color:#fff; flex:1; }
      #pause { background:#e2e8f0; color:#1e293b; }
      #stop { background:#fee2e2; color:#991b1b; }
      button:disabled, input:disabled, select:disabled, textarea:disabled { opacity:.55; cursor:not-allowed; }
      .notice { margin-top:9px; padding:7px 8px; border-radius:6px; background:#fff7ed; color:#9a3412; }
      .error { margin-top:8px; color:#b91c1c; min-height:18px; }
      .summary { margin-top:10px; padding:8px; background:#f1f5f9; border-radius:7px; }
      .course-list { max-height:116px; overflow:auto; margin-top:7px; }
      .course { display:flex; justify-content:space-between; gap:8px; padding:3px 0; border-bottom:1px solid #e2e8f0; }
      .course span:last-child { color:#475569; text-align:right; }
      .logs { max-height:130px; overflow:auto; margin-top:8px; padding:7px; background:#0f172a; color:#cbd5e1;
        border-radius:6px; white-space:pre-wrap; font:11px/1.45 ui-monospace,SFMono-Regular,monospace; }
      .file-name { color:#64748b; margin-top:4px; font-size:11px; }
    </style>
    <section class="panel">
      <header><span>UCASxk 选课助手</span><span id="badge" role="status"></span><button id="collapse" aria-controls="body actions" title="折叠">−</button></header>
      <main id="body"><div id="config">
        <label for="mode">运行模式</label>
        <select id="mode">
          <option value="watch">观察一次余量（不提交）</option>
          <option value="enroll">自动加入预选（选课首日推荐）</option>
          <option value="prepare_sids">准备并下载 SID（非选课首日推荐）</option>
          <option value="direct">导入 SID 直接提交（非选课首日推荐）</option>
        </select>
        <div id="mode-description" class="file-name"></div>
        <label for="codes">课程编码（每行一个）</label>
        <textarea id="codes" placeholder="180080025200M3001H"></textarea>
        <div id="sid-area" hidden>
          <label id="sid-label" for="sid-file">SID JSON（version 1）</label>
          <input id="sid-file" type="file" accept="application/json,.json">
          <div id="file-name" class="file-name">尚未选择文件</div>
        </div>
        <details id="advanced"><summary>高级设置</summary><div class="row">
          <div><label for="min">最小间隔/秒</label><input id="min" type="number" min="3" step="0.1" value="3"></div>
          <div><label for="max">最大间隔/秒</label><input id="max" type="number" min="3" step="0.1" value="3.1"></div>
        </div>
        <label for="ocr">本地 OCR 地址</label>
        <input id="ocr"></details>
        <div class="notice">脚本只会将课程加入预选，不会提交最终选课单。</div>
        </div>
        <div id="progress" hidden>
          <div id="summary" class="summary" role="status"></div>
          <p id="result"></p>
          <div id="courses" class="course-list"></div>
          <details><summary>详细日志</summary><div id="logs" class="logs"></div></details>
        </div>
      </main>
      <footer id="actions">
        <button id="start" class="action">查询余量</button>
        <button id="pause" class="action" hidden>暂停</button>
        <button id="stop" class="action" hidden>停止</button>
        <button id="back" class="action" hidden>返回配置</button>
      </footer>
    </section>`;

  const panel = root.querySelector<HTMLElement>(".panel")!;
  const mode = root.querySelector<HTMLSelectElement>("#mode")!;
  const codes = root.querySelector<HTMLTextAreaElement>("#codes")!;
  const min = root.querySelector<HTMLInputElement>("#min")!;
  const max = root.querySelector<HTMLInputElement>("#max")!;
  const ocr = root.querySelector<HTMLInputElement>("#ocr")!;
  const sidArea = root.querySelector<HTMLElement>("#sid-area")!;
  const sidLabel = root.querySelector<HTMLElement>("#sid-label")!;
  const modeDescription = root.querySelector<HTMLElement>("#mode-description")!;
  const sidFile = root.querySelector<HTMLInputElement>("#sid-file")!;
  const fileName = root.querySelector<HTMLElement>("#file-name")!;
  const config = root.querySelector<HTMLElement>("#config")!;
  const progress = root.querySelector<HTMLElement>("#progress")!;
  const result = root.querySelector<HTMLElement>("#result")!;
  const badge = root.querySelector<HTMLElement>("#badge")!;
  const advanced = root.querySelector<HTMLDetailsElement>("#advanced")!;
  const back = root.querySelector<HTMLButtonElement>("#back")!;
  const summary = root.querySelector<HTMLElement>("#summary")!;
  const courseList = root.querySelector<HTMLElement>("#courses")!;
  const logs = root.querySelector<HTMLElement>("#logs")!;
  const start = root.querySelector<HTMLButtonElement>("#start")!;
  const pause = root.querySelector<HTMLButtonElement>("#pause")!;
  const stop = root.querySelector<HTMLButtonElement>("#stop")!;
  const collapse = root.querySelector<HTMLButtonElement>("#collapse")!;
  let preferences = loadPreferences();
  const existingState = loadState();
  let importedCache: SidCache | undefined = preferences.sidCache;

  mode.value = existingState?.active ? existingState.mode : preferences.mode;
  codes.value = preferences.codesText || (existingState ? Object.keys(existingState.courseStatus).join("\n") : "");
  min.value = String(preferences.intervalMin);
  max.value = String(preferences.intervalMax);
  ocr.value = preferences.ocrUrl;
  panel.classList.toggle("collapsed", preferences.collapsed);
  collapse.textContent = preferences.collapsed ? "+" : "−";
  if (importedCache) {
    fileName.textContent = `${preferences.sidFileName || "已保存的 SID JSON"} · ${importedCache.courses.length} 门课程`;
  }

  const fields = [codes, min, max, ocr, sidFile];
  for (const field of fields) {
    const message = document.createElement("div");
    message.id = field.id + "-error";
    message.className = "error";
    message.setAttribute("role", "alert");
    field.after(message);
    field.setAttribute("aria-describedby", message.id);
    field.addEventListener("input", () => {
      field.removeAttribute("aria-invalid");
      message.textContent = "";
    });
  }

  function showError(field: HTMLElement, message: string): void {
    if (advanced.contains(field)) advanced.open = true;
    root.getElementById(field.id + "-error")!.textContent = message;
    field.setAttribute("aria-invalid", "true");
    field.focus();
  }

  function resetErrors(): void {
    for (const field of fields) {
      field.removeAttribute("aria-invalid");
      root.getElementById(field.id + "-error")!.textContent = "";
    }
  }

  function persistPreferences(): void {
    const intervalMin = Number(min.value);
    const intervalMax = Number(max.value);
    preferences = {
      schemaVersion: 1,
      mode: mode.value as RunMode,
      codesText: codes.value,
      intervalMin: Number.isFinite(intervalMin) ? intervalMin : preferences.intervalMin,
      intervalMax: Number.isFinite(intervalMax) ? intervalMax : preferences.intervalMax,
      ocrUrl: ocr.value.trim(),
      collapsed: panel.classList.contains("collapsed"),
      ...(importedCache ? { sidCache: importedCache } : {}),
      ...(preferences.sidFileName ? { sidFileName: preferences.sidFileName } : {}),
    } satisfies UiPreferences;
    savePreferences(preferences);
  }

  function updateMode(): void {
    const selectedMode = mode.value as RunMode;
    sidArea.hidden = selectedMode !== "direct" && selectedMode !== "watch";
    sidLabel.textContent = selectedMode === "watch"
      ? "导入 SID JSON（可选，用于填充课程编码）"
      : "SID JSON（version 1）";
    modeDescription.textContent = MODE_DESCRIPTIONS[selectedMode];
    advanced.hidden = selectedMode === "watch" || selectedMode === "prepare_sids";
    start.textContent = ACTION_LABELS[selectedMode];
    resetErrors();
  }

  function render(): void {
    const state = loadState();
    const active = Boolean(state?.active);
    config.hidden = Boolean(state);
    progress.hidden = !state;
    start.hidden = Boolean(state);
    pause.hidden = stop.hidden = !active;
    back.hidden = !state || active;
    pause.textContent = state?.paused ? "继续" : "暂停";
    const label = !state ? "配置" : state.active ? (state.paused ? "已暂停" : "运行中")
      : PHASE_LABELS[state.phase];
    badge.textContent = label;
    panel.dataset.status = label;
    const collapsed = panel.classList.contains("collapsed");
    collapse.setAttribute("aria-expanded", String(!collapsed));
    collapse.title = collapsed ? "展开选课助手" : "折叠选课助手";
    collapse.setAttribute("aria-label", collapse.title);
    if (!state) return;
    summary.textContent = active
      ? `${PHASE_LABELS[state.phase]} · 待处理 ${state.pendingCodes.length} 门`
      : `课程结果 · 共 ${Object.keys(state.courseStatus).length} 门`;
    result.hidden = active;
    result.textContent = active ? "" : state.logs.at(-1)?.message || label;
    courseList.replaceChildren(
      ...Object.entries(state.courseStatus).map(([code, status]) => {
        const row = document.createElement("div");
        row.className = "course";
        const codeNode = document.createElement("span");
        const statusNode = document.createElement("span");
        codeNode.textContent = code;
        statusNode.textContent = status;
        row.append(codeNode, statusNode);
        return row;
      }),
    );
    logs.textContent = state.logs.length
      ? state.logs.map((item) => `${item.at.slice(11, 19)} ${item.message}`).join("\n")
      : "暂无运行日志";
    logs.scrollTop = logs.scrollHeight;
  }

  mode.addEventListener("change", () => {
    updateMode();
    persistPreferences();
  });
  codes.addEventListener("input", persistPreferences);
  min.addEventListener("input", persistPreferences);
  max.addEventListener("input", persistPreferences);
  ocr.addEventListener("input", persistPreferences);
  sidFile.addEventListener("change", async () => {
    resetErrors();
    const file = sidFile.files?.[0];
    if (!file) return;
    try {
      importedCache = parseSidCache(await file.text());
      fileName.textContent = `${file.name} · ${importedCache.courses.length} 门课程`;
      codes.value = directCodes(importedCache).join("\n");
      preferences.sidFileName = file.name;
      persistPreferences();
    } catch (reason) {
      importedCache = undefined;
      preferences.sidFileName = undefined;
      fileName.textContent = "文件无效";
      persistPreferences();
      showError(sidFile, reason instanceof Error ? reason.message : String(reason));
    }
  });
  start.addEventListener("click", () => {
    resetErrors();
    let field: HTMLElement = codes;
    try {
      const selectedMode = mode.value as RunMode;
      let selectedCodes = parseCodes(codes.value);
      if (selectedMode === "direct") {
        field = sidFile;
        if (!importedCache) throw new Error("请先选择有效的 SID JSON 文件");
        if (!selectedCodes.length) selectedCodes = directCodes(importedCache);
      }
      field = codes;
      if (!selectedCodes.length) throw new Error("请至少填写一个课程编码");
      if (!advanced.hidden) {
        field = min;
        if (!(min.valueAsNumber >= 3)) throw new Error("最小间隔至少为 3 秒");
        field = max;
        if (!(max.valueAsNumber >= min.valueAsNumber)) throw new Error("最大间隔须大于或等于最小间隔");
        field = ocr;
        normalizeOcrUrl(ocr.value.trim());
      }
      field = codes;
      persistPreferences();
      startRun({
        mode: selectedMode,
        codes: selectedCodes,
        intervalMin: advanced.hidden ? loadPreferences().intervalMin : Number(min.value),
        intervalMax: advanced.hidden ? loadPreferences().intervalMax : Number(max.value),
        ocrUrl: ocr.value.trim(),
        ...(importedCache ? { sidCache: importedCache } : {}),
      });
    } catch (reason) {
      showError(field, reason instanceof Error ? reason.message : String(reason));
    }
  });
  back.addEventListener("click", () => {
    if (loadState()?.active) return;
    clearState();
    mode.focus();
  });
  pause.addEventListener("click", () => {
    const state = loadState();
    if (state?.paused) continueRun();
    else pauseRun();
  });
  stop.addEventListener("click", () => stopRun());
  collapse.addEventListener("click", (event) => {
    panel.classList.toggle("collapsed");
    (event.currentTarget as HTMLButtonElement).textContent = panel.classList.contains("collapsed") ? "+" : "−";
    persistPreferences();
    render();
  });
  window.addEventListener("ucasxk-state-change", render);
  updateMode();
  render();
}
