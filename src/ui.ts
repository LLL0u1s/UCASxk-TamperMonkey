import {
  continueRun,
  directCodes,
  pauseRun,
  startRun,
  stopRun,
} from "./engine";
import { normalizeOcrUrl } from "./ocr";
import { parseCodes, parseSidCache } from "./sid";
import { loadState } from "./storage";
import type { RunMode, SidCache } from "./types";

const OCR_DEFAULT = "http://127.0.0.1:8765";

export function mountPanel(): void {
  if (document.getElementById("ucasxk-helper-host")) return;
  const host = document.createElement("div");
  host.id = "ucasxk-helper-host";
  document.documentElement.append(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .panel { position: fixed; z-index: 2147483647; top: 72px; right: 20px; width: 350px;
        color: #17212b; background: #fff; border: 1px solid #cbd5e1; border-radius: 12px;
        box-shadow: 0 16px 44px rgba(15,23,42,.22); font: 13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; }
      header { display:flex; justify-content:space-between; align-items:center; padding:11px 13px;
        background:#0f4c81; color:#fff; border-radius:11px 11px 0 0; font-weight:700; }
      header button { background:transparent; border:0; color:#fff; cursor:pointer; font-size:17px; }
      main { padding:12px; }
      .collapsed main { display:none; }
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
      <header><span>UCASxk 选课助手</span><button id="collapse" title="折叠">−</button></header>
      <main>
        <label for="mode">运行模式</label>
        <select id="mode">
          <option value="watch">观察余量（不提交）</option>
          <option value="enroll">自动加入预选</option>
          <option value="prepare_sids">准备并下载 SID</option>
          <option value="direct">导入 SID 直接提交</option>
        </select>
        <label for="codes">课程编码（每行一个）</label>
        <textarea id="codes" placeholder="180080025200M3001H"></textarea>
        <div id="sid-area" hidden>
          <label for="sid-file">SID JSON（version 1）</label>
          <input id="sid-file" type="file" accept="application/json,.json">
          <div id="file-name" class="file-name">尚未选择文件</div>
        </div>
        <div class="row">
          <div><label for="min">最小间隔/秒</label><input id="min" type="number" min="0.2" step="0.1" value="0.8"></div>
          <div><label for="max">最大间隔/秒</label><input id="max" type="number" min="0.2" step="0.1" value="1.8"></div>
        </div>
        <label for="ocr">本地 OCR 地址</label>
        <input id="ocr" value="${OCR_DEFAULT}">
        <div class="notice">脚本只会将课程加入预选，不会提交最终选课单。</div>
        <div class="buttons">
          <button id="start" class="action">开始</button>
          <button id="pause" class="action">暂停</button>
          <button id="stop" class="action">停止</button>
        </div>
        <div id="error" class="error"></div>
        <div id="summary" class="summary">当前没有运行中的任务</div>
        <div id="courses" class="course-list"></div>
        <div id="logs" class="logs">暂无运行日志</div>
      </main>
    </section>`;

  const panel = root.querySelector<HTMLElement>(".panel")!;
  const mode = root.querySelector<HTMLSelectElement>("#mode")!;
  const codes = root.querySelector<HTMLTextAreaElement>("#codes")!;
  const min = root.querySelector<HTMLInputElement>("#min")!;
  const max = root.querySelector<HTMLInputElement>("#max")!;
  const ocr = root.querySelector<HTMLInputElement>("#ocr")!;
  const sidArea = root.querySelector<HTMLElement>("#sid-area")!;
  const sidFile = root.querySelector<HTMLInputElement>("#sid-file")!;
  const fileName = root.querySelector<HTMLElement>("#file-name")!;
  const error = root.querySelector<HTMLElement>("#error")!;
  const summary = root.querySelector<HTMLElement>("#summary")!;
  const courseList = root.querySelector<HTMLElement>("#courses")!;
  const logs = root.querySelector<HTMLElement>("#logs")!;
  const start = root.querySelector<HTMLButtonElement>("#start")!;
  const pause = root.querySelector<HTMLButtonElement>("#pause")!;
  const stop = root.querySelector<HTMLButtonElement>("#stop")!;
  let importedCache: SidCache | undefined;

  function showError(message = ""): void {
    error.textContent = message;
  }

  function updateMode(): void {
    sidArea.hidden = mode.value !== "direct";
    ocr.disabled = mode.value === "watch" || mode.value === "prepare_sids";
  }

  function render(): void {
    const state = loadState();
    const active = Boolean(state?.active);
    mode.disabled = active;
    codes.disabled = active;
    min.disabled = active;
    max.disabled = active;
    sidFile.disabled = active;
    start.disabled = active;
    pause.disabled = !active;
    stop.disabled = !active;
    pause.textContent = state?.paused ? "继续" : "暂停";
    if (!state) {
      summary.textContent = "当前没有运行中的任务";
      courseList.replaceChildren();
      logs.textContent = "暂无运行日志";
      return;
    }
    const stateLabel = state.active ? (state.paused ? "已暂停" : "运行中") : state.phase === "completed" ? "已完成" : "已停止";
    summary.textContent = `${stateLabel} · ${state.mode} · 阶段 ${state.phase} · 待处理 ${state.pendingCodes.length}`;
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

  mode.addEventListener("change", updateMode);
  sidFile.addEventListener("change", async () => {
    showError();
    const file = sidFile.files?.[0];
    if (!file) return;
    try {
      importedCache = parseSidCache(await file.text());
      fileName.textContent = `${file.name} · ${importedCache.courses.length} 门课程`;
      if (!codes.value.trim()) codes.value = directCodes(importedCache).join("\n");
    } catch (reason) {
      importedCache = undefined;
      fileName.textContent = "文件无效";
      showError(reason instanceof Error ? reason.message : String(reason));
    }
  });
  start.addEventListener("click", () => {
    showError();
    try {
      const selectedMode = mode.value as RunMode;
      let selectedCodes = parseCodes(codes.value);
      if (selectedMode === "direct") {
        if (!importedCache) throw new Error("请先选择有效的 SID JSON 文件");
        if (!selectedCodes.length) selectedCodes = directCodes(importedCache);
      }
      normalizeOcrUrl(ocr.value.trim());
      if (
        (selectedMode === "enroll" || selectedMode === "direct") &&
        !window.confirm(`将自动把 ${selectedCodes.length} 门课程加入预选。不会提交最终选课单。确认开始吗？`)
      ) return;
      startRun({
        mode: selectedMode,
        codes: selectedCodes,
        intervalMin: Number(min.value),
        intervalMax: Number(max.value),
        ocrUrl: ocr.value.trim(),
        ...(importedCache ? { sidCache: importedCache } : {}),
      });
    } catch (reason) {
      showError(reason instanceof Error ? reason.message : String(reason));
    }
  });
  pause.addEventListener("click", () => {
    const state = loadState();
    if (state?.paused) continueRun();
    else pauseRun();
  });
  stop.addEventListener("click", () => stopRun());
  root.querySelector<HTMLButtonElement>("#collapse")!.addEventListener("click", (event) => {
    panel.classList.toggle("collapsed");
    (event.currentTarget as HTMLButtonElement).textContent = panel.classList.contains("collapsed") ? "+" : "−";
  });
  window.addEventListener("ucasxk-state-change", render);
  updateMode();
  render();
}
