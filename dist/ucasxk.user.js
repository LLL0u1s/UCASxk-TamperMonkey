// ==UserScript==
// @name         UCASxk 选课助手
// @namespace    https://github.com/LLL0u1s/UCASxk-TamperMonkey
// @version      0.3.0
// @description  在国科大选课系统页面监控课程并经本地 OCR 将课程加入预选
// @match        https://xkgodj.ucas.ac.cn/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==
"use strict";
(() => {
  // src/navigation.ts
  function navigateGet(path) {
    window.location.assign(path);
  }
  function submitNavigation(path, fields) {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = path;
    form.hidden = true;
    for (const field of fields) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = field.name;
      input.value = field.value;
      form.append(input);
    }
    document.body.append(form);
    form.submit();
  }
  function navigationStatus() {
    const entry = performance.getEntriesByType("navigation")[0];
    return entry?.responseStatus;
  }

  // src/ocr.ts
  function normalizeOcrUrl(input) {
    let url;
    try {
      url = new URL(input);
    } catch {
      throw new Error("OCR \u5730\u5740\u683C\u5F0F\u65E0\u6548");
    }
    if (url.protocol !== "http:") throw new Error("OCR \u670D\u52A1\u5FC5\u987B\u4F7F\u7528\u672C\u673A HTTP \u5730\u5740");
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      throw new Error("OCR \u670D\u52A1\u5730\u5740\u5FC5\u987B\u662F localhost");
    }
    return `${url.origin}/v1/ocr`;
  }
  function recognizeCaptcha(baseUrl, image) {
    const url = normalizeOcrUrl(baseUrl);
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url,
        headers: {
          "Content-Type": "application/json",
          "X-UCASXK-Client": "tampermonkey"
        },
        data: JSON.stringify({ image }),
        timeout: 1e4,
        onload(response) {
          if (response.status !== 200) {
            reject(new Error(`OCR \u670D\u52A1\u8FD4\u56DE ${response.status}`));
            return;
          }
          try {
            const result = JSON.parse(response.responseText);
            if (typeof result.text !== "string" || typeof result.confidence !== "number" || typeof result.accepted !== "boolean") throw new Error("\u54CD\u5E94\u7ED3\u6784\u65E0\u6548");
            resolve(result);
          } catch (error) {
            reject(new Error(`OCR \u54CD\u5E94\u65E0\u6CD5\u89E3\u6790: ${String(error)}`));
          }
        },
        onerror: () => reject(new Error("\u65E0\u6CD5\u8FDE\u63A5\u672C\u5730 OCR \u670D\u52A1")),
        ontimeout: () => reject(new Error("\u672C\u5730 OCR \u670D\u52A1\u54CD\u5E94\u8D85\u65F6"))
      });
    });
  }

  // src/parser.ts
  var LOGIN_MARKERS = ['name="pwd"', 'id="sepform"', "\u767B\u5F55 sep"];
  var RISK_MARKERS = ["\u8FC7\u4E8E\u9891\u7E41", "\u64CD\u4F5C\u9891\u7E41", "rate limit", "too many requests"];
  var CONFLICT_PATTERN = /你选择的课程名称为.*?上课时间冲突.*?谢谢[！!]/g;
  function compact(text) {
    return text.replace(/\s+/g, "");
  }
  function integer(text) {
    const match = text.replaceAll(",", "").match(/\d+/);
    return match ? Number(match[0]) : null;
  }
  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }
  function cellText(cells, index) {
    return index === void 0 || !cells[index] ? "" : (cells[index].textContent ?? "").trim().replace(/\s+/g, " ");
  }
  function parseQueryPage(doc) {
    const html = doc.documentElement?.outerHTML.toLowerCase() ?? "";
    const authenticated = !LOGIN_MARKERS.some((marker) => html.includes(marker));
    const form = doc.querySelector("form#regfrm");
    const hiddenFields = [];
    form?.querySelectorAll('input[name][type="hidden"]').forEach((input) => {
      hiddenFields.push({ name: input.name, value: input.value });
    });
    const courses = [];
    doc.querySelectorAll("table").forEach((table) => {
      const headers = [...table.querySelectorAll("tr th")].map(
        (cell) => (cell.textContent ?? "").trim().replace(/\s+/g, " ")
      );
      const codeIndex = headers.indexOf("\u8BFE\u7A0B\u7F16\u7801");
      if (codeIndex < 0) return;
      const nameIndex = headers.indexOf("\u8BFE\u7A0B\u540D\u79F0");
      const limitIndex = headers.indexOf("\u9650\u9009");
      const selectedIndex = headers.indexOf("\u5DF2\u9009");
      table.querySelectorAll("tr").forEach((tr) => {
        const cells = [...tr.children].filter((cell) => cell.tagName === "TD");
        const sidInput = tr.querySelector('input[name="sids"]');
        if (!cells.length || !sidInput?.value) return;
        courses.push({
          code: cellText(cells, codeIndex),
          name: cellText(cells, nameIndex >= 0 ? nameIndex : void 0),
          limit: limitIndex >= 0 ? integer(cellText(cells, limitIndex)) : null,
          selected: selectedIndex >= 0 ? integer(cellText(cells, selectedIndex)) : null,
          sid: sidInput.value,
          selectable: !sidInput.disabled
        });
      });
    });
    return { authenticated, courses, hiddenFields };
  }
  function parseSelectedCodes(doc) {
    const codes = /* @__PURE__ */ new Set();
    doc.querySelectorAll("table").forEach((table) => {
      const headers = [...table.querySelectorAll("tr th")].map(
        (cell) => (cell.textContent ?? "").trim().replace(/\s+/g, " ")
      );
      const index = headers.indexOf("\u8BFE\u7A0B\u7F16\u7801");
      if (index < 0) return;
      table.querySelectorAll("tr").forEach((tr) => {
        const cells = [...tr.children].filter((cell) => cell.tagName === "TD");
        const code = cellText(cells, index);
        if (code) codes.add(code);
      });
    });
    return codes;
  }
  function hasSeat(row) {
    if (!row.selectable) return false;
    return row.limit === null || row.selected === null || row.selected < row.limit;
  }
  function containsRiskMarker(text) {
    const lower = text.toLowerCase();
    return RISK_MARKERS.some((marker) => lower.includes(marker));
  }
  function isAuthenticated(doc) {
    const html = doc.documentElement?.outerHTML.toLowerCase() ?? "";
    return !LOGIN_MARKERS.some((marker) => html.includes(marker));
  }
  function feedbackText(doc) {
    const label = doc.querySelector("label#loginError");
    if (!label) return void 0;
    const lines = (label.textContent ?? "").split(/\n+/).map((line) => line.trim().replace(/\s+/g, " "));
    return unique(lines).join("\n") || void 0;
  }
  function parseSubmitBatch(doc, courses) {
    const text = (doc.body?.textContent ?? "").trim().replace(/\s+/g, " ");
    const lower = text.toLowerCase();
    const feedback = feedbackText(doc);
    const conflictSource = compact(feedback ?? text);
    const conflictMessages = unique(conflictSource.match(CONFLICT_PATTERN) ?? []);
    const conflictMessage = conflictMessages.join("\n") || feedback || "\u68C0\u6D4B\u5230\u4E0A\u8BFE\u65F6\u95F4\u51B2\u7A81";
    const successNames = new Set(
      [...text.matchAll(/课程\s*\[([^\]]+)\]\s*选课成功/g)].map((match) => match[1]?.trim() ?? "")
    );
    const outcomes = {};
    for (const course of courses) {
      if (text.includes("\u9009\u8BFE\u6210\u529F") && (text.includes(course.code) || Boolean(course.name) && successNames.has(course.name) || Boolean(course.name) && compact(text).includes(`\u8BFE\u7A0B[${course.name}]\u9009\u8BFE\u6210\u529F`))) {
        outcomes[course.code] = { result: "success" };
      } else if (conflictSource.includes("\u4E0A\u8BFE\u65F6\u95F4\u51B2\u7A81") && (courses.length === 1 || Boolean(course.name) && conflictSource.includes(course.name) || Boolean(course.code) && conflictSource.includes(course.code))) {
        outcomes[course.code] = { result: "time_conflict", message: conflictMessage };
      } else if (["\u5DF2\u7ECF\u9009\u62E9", "\u5DF2\u9009\u8FC7", "\u91CD\u590D\u9009\u8BFE"].some((word) => text.includes(word))) {
        outcomes[course.code] = { result: "already_selected" };
      } else if (text.includes("\u9A8C\u8BC1\u7801") && ["\u9519\u8BEF", "\u4E0D\u6B63\u786E", "\u5931\u6548", "\u8FC7\u671F", "\u5F02\u5E38"].some((word) => text.includes(word))) {
        outcomes[course.code] = { result: "captcha_error" };
      } else if (["\u5DF2\u6EE1", "\u6CA1\u6709\u4F59\u91CF", "\u4EBA\u6570\u5DF2\u8FBE\u4E0A\u9650"].some((word) => text.includes(word))) {
        outcomes[course.code] = { result: "full" };
      } else if (LOGIN_MARKERS.some((marker) => lower.includes(marker))) {
        outcomes[course.code] = { result: "session_expired" };
      } else if (conflictSource.includes("\u4E0A\u8BFE\u65F6\u95F4\u51B2\u7A81")) {
        outcomes[course.code] = { result: "unknown", message: conflictMessage };
      } else {
        outcomes[course.code] = { result: "unknown", ...feedback ? { message: feedback } : {} };
      }
    }
    return outcomes;
  }

  // src/sid.ts
  function parseCodes(text) {
    return [...new Set(
      text.split(/\r?\n/).map((line) => line.replace(/#.*$/, "").trim()).filter(Boolean)
    )];
  }
  function parseSidCache(text) {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("SID \u6587\u4EF6\u4E0D\u662F\u6709\u6548 JSON");
    }
    if (!value || typeof value !== "object") throw new Error("SID \u6587\u4EF6\u7ED3\u6784\u65E0\u6548");
    const cache = value;
    if (cache.version !== 1 || !Array.isArray(cache.courses)) {
      throw new Error("\u4EC5\u652F\u6301 version 1 \u7684 SID \u6587\u4EF6");
    }
    const seen = /* @__PURE__ */ new Set();
    for (const item of cache.courses) {
      if (!item || typeof item.code !== "string" || !item.code.trim()) throw new Error("SID \u6587\u4EF6\u5B58\u5728\u7A7A\u8BFE\u7A0B\u7F16\u7801");
      if (typeof item.name !== "string" || !item.name.trim()) throw new Error(`\u8BFE\u7A0B ${item.code} \u7F3A\u5C11\u540D\u79F0`);
      if (typeof item.sid !== "string" || !item.sid.trim()) throw new Error(`\u8BFE\u7A0B ${item.code} \u7684 SID \u4E3A\u7A7A`);
      if (item.limit !== null && typeof item.limit !== "number") throw new Error(`\u8BFE\u7A0B ${item.code} \u7684\u9650\u9009\u4EBA\u6570\u65E0\u6548`);
      if (item.selected !== null && typeof item.selected !== "number") throw new Error(`\u8BFE\u7A0B ${item.code} \u7684\u5DF2\u9009\u4EBA\u6570\u65E0\u6548`);
      if (typeof item.selectable !== "boolean") throw new Error(`\u8BFE\u7A0B ${item.code} \u7684 selectable \u65E0\u6548`);
      if (seen.has(item.code)) throw new Error(`SID \u6587\u4EF6\u5B58\u5728\u91CD\u590D\u8BFE\u7A0B\u7F16\u7801: ${item.code}`);
      seen.add(item.code);
    }
    return cache;
  }
  function makeSidCache(codes, lookups) {
    return {
      version: 1,
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      courses: codes.map((code) => {
        const lookup = lookups[code];
        if (!lookup) throw new Error(`\u7F3A\u5C11\u8BFE\u7A0B ${code} \u7684\u67E5\u8BE2\u7ED3\u679C`);
        return { ...lookup.row };
      })
    };
  }
  function sidFilename(date = /* @__PURE__ */ new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    const timestamp = [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      "-",
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds())
    ].join("");
    return `ucasxk-sids-${timestamp}.json`;
  }
  function downloadSidCache(cache) {
    const blob = new Blob([JSON.stringify(cache, null, 2) + "\n"], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = sidFilename();
    link.click();
    URL.revokeObjectURL(link.href);
  }

  // src/storage.ts
  var STATE_KEY = "ucasxk.run-state.v1";
  function validState(value) {
    if (!value || typeof value !== "object") return false;
    const state = value;
    return state.schemaVersion === 1 && typeof state.runId === "string" && typeof state.active === "boolean" && typeof state.paused === "boolean" && Array.isArray(state.pendingCodes) && typeof state.expectedPath === "string";
  }
  function loadState() {
    const raw = GM_getValue(STATE_KEY, null);
    if (raw === null) return null;
    if (!validState(raw)) {
      GM_deleteValue(STATE_KEY);
      return null;
    }
    return raw;
  }
  function saveState(state) {
    GM_setValue(STATE_KEY, state);
    window.dispatchEvent(new CustomEvent("ucasxk-state-change", { detail: state }));
  }
  function clearState() {
    GM_deleteValue(STATE_KEY);
    window.dispatchEvent(new CustomEvent("ucasxk-state-change", { detail: null }));
  }
  function appendLog(state, message) {
    state.logs.push({ at: (/* @__PURE__ */ new Date()).toISOString(), message });
    state.logs = state.logs.slice(-100);
    return state;
  }

  // src/engine.ts
  var MAIN_PATH = "/courseManage/main";
  var SELECT_PATH = "/courseManage/selectCourse";
  var SAVE_PATH = "/courseManage/saveCourse";
  var CAPTCHA_PATH = "/captchaImage";
  var running = false;
  function randomBetween(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
  }
  function sleep(seconds) {
    return new Promise((resolve) => window.setTimeout(resolve, seconds * 1e3));
  }
  function removeCode(values, code) {
    return values.filter((value) => value !== code);
  }
  function occupancy(lookup) {
    const { selected, limit } = lookup.row;
    return selected === null || limit === null ? "?/?" : `${selected}/${limit}`;
  }
  function currentPath() {
    return window.location.pathname;
  }
  function newState(options) {
    const directLookups = {};
    if (options.mode === "direct") {
      const records = new Map((options.sidCache?.courses ?? []).map((row) => [row.code, row]));
      for (const code of options.codes) {
        const row = records.get(code);
        if (!row) throw new Error(`SID \u6587\u4EF6\u7F3A\u5C11\u8BFE\u7A0B\u7F16\u7801: ${code}`);
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
      courseStatus: Object.fromEntries(options.codes.map((code) => [code, "\u7B49\u5F85\u5904\u7406"])),
      availableCodes: options.mode === "direct" ? [...options.codes] : [],
      attempts: { captchaImages: 0, submit: 0 },
      expectedPath: options.mode === "direct" ? currentPath() : MAIN_PATH,
      intervalMin: options.intervalMin,
      intervalMax: options.intervalMax,
      ocrUrl: options.ocrUrl,
      logs: [],
      startedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function startRun(options) {
    if (!options.codes.length) throw new Error("\u8BF7\u81F3\u5C11\u586B\u5199\u4E00\u4E2A\u8BFE\u7A0B\u7F16\u7801");
    if (options.intervalMin < 3 || options.intervalMax < options.intervalMin) {
      throw new Error("\u8F6E\u8BE2\u95F4\u9694\u5FC5\u987B\u6EE1\u8DB3 3 \u2264 \u6700\u5C0F\u503C \u2264 \u6700\u5927\u503C\uFF1B\u66F4\u77ED\u95F4\u9694\u53EF\u80FD\u89E6\u53D1\u9650\u6D41");
    }
    const state = appendLog(newState(options), `\u4EFB\u52A1\u5DF2\u542F\u52A8\uFF1A${options.mode}\uFF0C\u5171 ${options.codes.length} \u95E8\u8BFE\u7A0B`);
    saveState(state);
    if (state.mode === "direct") {
      void resumeRun();
    } else {
      navigateGet(MAIN_PATH);
    }
  }
  function pauseRun() {
    const state = loadState();
    if (!state?.active) return;
    state.paused = true;
    appendLog(state, "\u4EFB\u52A1\u5DF2\u6682\u505C\uFF1B\u5F53\u524D\u5BFC\u822A\u65E0\u6CD5\u64A4\u56DE\uFF0C\u4E0D\u4F1A\u518D\u53D1\u51FA\u4E0B\u4E00\u6B21\u8BF7\u6C42");
    saveState(state);
  }
  function continueRun() {
    const state = loadState();
    if (!state?.active) return;
    state.paused = false;
    appendLog(state, "\u4EFB\u52A1\u7EE7\u7EED\u8FD0\u884C");
    saveState(state);
    void resumeRun();
  }
  function stopRun(reason = "\u7528\u6237\u505C\u6B62\u4EFB\u52A1") {
    const state = loadState();
    if (!state) return;
    state.active = false;
    state.paused = false;
    state.phase = "stopped";
    state.expectedPath = currentPath();
    appendLog(state, reason);
    saveState(state);
  }
  function fail(state, reason) {
    state.active = false;
    state.paused = false;
    state.phase = "stopped";
    state.expectedPath = currentPath();
    appendLog(state, `\u5DF2\u5B89\u5168\u505C\u6B62\uFF1A${reason}`);
    saveState(state);
  }
  function complete(state, message) {
    state.active = false;
    state.paused = false;
    state.phase = "completed";
    state.expectedPath = currentPath();
    appendLog(state, message);
    saveState(state);
  }
  function checkPageSafety(state) {
    if (currentPath() !== state.expectedPath) {
      fail(state, `\u9875\u9762\u8DEF\u5F84\u4E0E\u4EFB\u52A1\u9636\u6BB5\u4E0D\u4E00\u81F4\uFF08\u9884\u671F ${state.expectedPath}\uFF0C\u5B9E\u9645 ${currentPath()}\uFF09`);
      return false;
    }
    const status = navigationStatus();
    if (status === 403 || status === 429 || status !== void 0 && status >= 500) {
      fail(state, `\u9875\u9762\u8FD4\u56DE HTTP ${status}`);
      return false;
    }
    const html = document.documentElement?.outerHTML ?? "";
    if (containsRiskMarker(html)) {
      fail(state, "\u68C0\u6D4B\u5230\u9891\u7387\u9650\u5236\u6216\u98CE\u63A7\u63D0\u793A");
      return false;
    }
    if (currentPath().includes("/user/login") || !isAuthenticated(document)) {
      fail(state, "\u9009\u8BFE\u7CFB\u7EDF\u4F1A\u8BDD\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55");
      return false;
    }
    return true;
  }
  function submitQuery(state) {
    if (state.queryIndex >= state.roundCodes.length) {
      void finishRound(state).catch((error) => {
        const latest = loadState();
        if (latest?.active && latest.runId === state.runId) {
          fail(latest, error instanceof Error ? error.message : String(error));
        }
      });
      return;
    }
    const code = state.roundCodes[state.queryIndex];
    if (!code) {
      fail(state, "\u67E5\u8BE2\u961F\u5217\u72B6\u6001\u635F\u574F");
      return;
    }
    state.currentCode = code;
    state.phase = "query_result";
    state.expectedPath = SELECT_PATH;
    state.courseStatus[code] = "\u6B63\u5728\u67E5\u8BE2";
    appendLog(state, `${code}: \u67E5\u8BE2\u8BFE\u7A0B`);
    saveState(state);
    submitNavigation(SELECT_PATH, [
      { name: "type", value: "" },
      { name: "deptIds1", value: "" },
      { name: "courseType1", value: "" },
      { name: "courseCode", value: code },
      { name: "courseName", value: "" }
    ]);
  }
  function beginRound(state) {
    if (!state.pendingCodes.length) {
      complete(state, "\u6240\u6709\u76EE\u6807\u8BFE\u7A0B\u5747\u5DF2\u5904\u7406\uFF1B\u672A\u63D0\u4EA4\u6700\u7EC8\u9009\u8BFE\u5355");
      return;
    }
    state.roundCodes = [...state.pendingCodes];
    state.queryIndex = 0;
    state.currentCode = void 0;
    state.lookups = {};
    state.availableCodes = [];
    submitQuery(state);
  }
  function handleReadSelected(state) {
    if (state.mode !== "prepare_sids") {
      const selected = parseSelectedCodes(document);
      for (const code of [...state.pendingCodes]) {
        if (selected.has(code)) {
          state.pendingCodes = removeCode(state.pendingCodes, code);
          state.courseStatus[code] = "\u5DF2\u5728\u9884\u9009\u5217\u8868";
          appendLog(state, `${code}: \u5DF2\u5728\u9884\u9009\u5217\u8868\u4E2D`);
        }
      }
    }
    if (!state.pendingCodes.length) {
      complete(state, "\u6240\u6709\u76EE\u6807\u8BFE\u7A0B\u5DF2\u5728\u9884\u9009\u5217\u8868\uFF1B\u672A\u63D0\u4EA4\u6700\u7EC8\u9009\u8BFE\u5355");
      return;
    }
    state.phase = "open_select";
    state.expectedPath = SELECT_PATH;
    saveState(state);
    navigateGet(SELECT_PATH);
  }
  function handleOpenSelect(state) {
    const page = parseQueryPage(document);
    if (!page.authenticated) {
      fail(state, "\u9009\u8BFE\u7CFB\u7EDF\u4F1A\u8BDD\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55");
      return;
    }
    beginRound(state);
  }
  function handleQueryResult(state) {
    const code = state.currentCode;
    if (!code || state.roundCodes[state.queryIndex] !== code) {
      fail(state, "\u67E5\u8BE2\u7ED3\u679C\u4E0E\u6301\u4E45\u5316\u961F\u5217\u4E0D\u4E00\u81F4");
      return;
    }
    const page = parseQueryPage(document);
    const row = page.courses.find((course) => course.code.trim().toLowerCase() === code.toLowerCase());
    if (!row) {
      if (state.mode === "prepare_sids") {
        fail(state, `${code}: \u672A\u5728\u5F53\u524D\u8BFE\u7A0B\u7C7B\u578B\u4E2D\u627E\u5230\uFF0C\u672A\u751F\u6210 SID \u6587\u4EF6`);
        return;
      }
      state.pendingCodes = removeCode(state.pendingCodes, code);
      state.courseStatus[code] = "\u672A\u627E\u5230";
      appendLog(state, `${code}: \u672A\u5728\u5F53\u524D\u8BFE\u7A0B\u7C7B\u578B\u4E2D\u627E\u5230\uFF0C\u5DF2\u79FB\u51FA\u961F\u5217`);
    } else {
      const lookup = { row, hiddenFields: page.hiddenFields };
      state.lookups[code] = lookup;
      if (state.mode === "prepare_sids") {
        state.courseStatus[code] = `SID \u5DF2\u83B7\u53D6 (${occupancy(lookup)})`;
        appendLog(state, `${code} ${row.name}: SID \u5DF2\u83B7\u53D6 (${occupancy(lookup)})`);
      } else if (state.mode === "watch") {
        if (hasSeat(row)) {
          state.pendingCodes = removeCode(state.pendingCodes, code);
          state.courseStatus[code] = `\u5F53\u524D\u53EF\u9009 (${occupancy(lookup)})`;
          appendLog(state, `${code} ${row.name}: \u5F53\u524D\u53EF\u9009 (${occupancy(lookup)})`);
        } else {
          state.courseStatus[code] = `\u6682\u4E0D\u53EF\u9009 (${occupancy(lookup)})`;
          appendLog(state, `${code} ${row.name}: \u6682\u4E0D\u53EF\u9009 (${occupancy(lookup)})`);
        }
      } else if (hasSeat(row)) {
        state.availableCodes.push(code);
        state.courseStatus[code] = `\u53D1\u73B0\u4F59\u91CF (${occupancy(lookup)})`;
      } else {
        state.courseStatus[code] = `\u6682\u4E0D\u53EF\u9009 (${occupancy(lookup)})`;
        appendLog(state, `${code} ${row.name}: \u6682\u4E0D\u53EF\u9009 (${occupancy(lookup)})`);
      }
    }
    state.queryIndex += 1;
    state.currentCode = void 0;
    saveState(state);
    submitQuery(state);
  }
  async function finishRound(state) {
    if (state.mode === "prepare_sids") {
      const cache = makeSidCache(state.roundCodes, state.lookups);
      downloadSidCache(cache);
      complete(state, `\u5DF2\u751F\u6210 ${cache.courses.length} \u95E8\u8BFE\u7A0B\u7684 SID \u6587\u4EF6`);
      return;
    }
    if (state.mode === "watch") {
      complete(state, `\u672C\u6B21\u4F59\u91CF\u89C2\u5BDF\u5DF2\u5B8C\u6210\uFF1B\u5171\u67E5\u8BE2 ${state.roundCodes.length} \u95E8\u8BFE\u7A0B\uFF0C\u672A\u63D0\u4EA4\u4EFB\u4F55\u8BFE\u7A0B`);
      return;
    }
    if (!state.availableCodes.length) {
      await waitAndContinue(state);
      return;
    }
    state.phase = "captcha";
    state.expectedPath = currentPath();
    state.attempts = { captchaImages: 0, submit: 0 };
    appendLog(state, `\u53D1\u73B0 ${state.availableCodes.length} \u95E8\u53EF\u9009\u8BFE\u7A0B\uFF0C\u51C6\u5907\u83B7\u53D6\u4E00\u5F20\u9A8C\u8BC1\u7801`);
    saveState(state);
    await handleCaptcha(state);
  }
  async function waitAndContinue(state) {
    if (!state.pendingCodes.length) {
      complete(state, "\u6240\u6709\u76EE\u6807\u8BFE\u7A0B\u5747\u5DF2\u5904\u7406\uFF1B\u672A\u63D0\u4EA4\u6700\u7EC8\u9009\u8BFE\u5355");
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
  function validateCaptchaPayload(payload) {
    if (!payload.startsWith("data:image/png;base64,")) {
      throw new Error("\u9A8C\u8BC1\u7801\u63A5\u53E3\u672A\u8FD4\u56DE PNG data URL");
    }
    const encoded = payload.slice(payload.indexOf(",") + 1);
    let bytes;
    try {
      bytes = atob(encoded);
    } catch {
      throw new Error("\u9A8C\u8BC1\u7801\u63A5\u53E3\u8FD4\u56DE\u4E86\u65E0\u6548 Base64");
    }
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (signature.some((byte, index) => bytes.charCodeAt(index) !== byte)) {
      throw new Error("\u9A8C\u8BC1\u7801\u63A5\u53E3\u8FD4\u56DE\u7684\u5185\u5BB9\u4E0D\u662F\u6709\u6548 PNG");
    }
  }
  async function fetchCaptcha() {
    const response = await fetch(CAPTCHA_PATH, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "*/*", "X-Requested-With": "XMLHttpRequest" }
    });
    const text = (await response.text()).trim();
    if (response.status === 403 || response.status === 429 || response.status >= 500) {
      throw new Error(`\u9A8C\u8BC1\u7801\u63A5\u53E3\u8FD4\u56DE HTTP ${response.status}`);
    }
    if (!response.ok) throw new Error(`\u9A8C\u8BC1\u7801\u63A5\u53E3\u8FD4\u56DE HTTP ${response.status}`);
    if (containsRiskMarker(text)) throw new Error("\u9A8C\u8BC1\u7801\u63A5\u53E3\u8FD4\u56DE\u9891\u7387\u9650\u5236\u6216\u98CE\u63A7\u63D0\u793A");
    validateCaptchaPayload(text);
    return text;
  }
  async function handleCaptcha(state) {
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
          appendLog(state, `\u7B2C ${state.attempts.captchaImages} \u5F20\u9A8C\u8BC1\u7801\u672A\u8FBE\u5230\u8BC6\u522B\u9608\u503C`);
          saveState(state);
          continue;
        }
        appendLog(state, `\u9A8C\u8BC1\u7801\u8BC6\u522B\u901A\u8FC7\uFF08\u7F6E\u4FE1\u5EA6 ${result.confidence.toFixed(3)}\uFF09`);
        saveState(state);
        await sleep(randomBetween(3, 3.5));
        const beforeSubmit = loadState();
        if (!beforeSubmit?.active || beforeSubmit.paused || beforeSubmit.runId !== state.runId) return;
        submitAvailable(beforeSubmit, result.text);
        return;
      } catch (error) {
        const latest2 = loadState();
        if (latest2?.active && latest2.runId === state.runId) {
          fail(latest2, error instanceof Error ? error.message : String(error));
        }
        return;
      }
    }
    fail(state, "\u8FDE\u7EED\u4E94\u5F20\u9A8C\u8BC1\u7801\u5747\u672A\u8FBE\u5230\u8BC6\u522B\u9608\u503C");
  }
  function submitAvailable(state, captcha) {
    const lookups = state.availableCodes.map((code) => state.lookups[code]);
    if (lookups.some((lookup) => !lookup)) {
      fail(state, "\u5F85\u63D0\u4EA4\u8BFE\u7A0B\u7F3A\u5C11 SID \u67E5\u8BE2\u7ED3\u679C");
      return;
    }
    const fields = [{ name: "vcode", value: captcha }];
    if (state.mode !== "direct") fields.push(...lookups.at(-1)?.hiddenFields ?? []);
    fields.push(...lookups.map((lookup) => ({ name: "sids", value: lookup.row.sid })));
    state.attempts.submit += 1;
    state.phase = "submit_result";
    state.expectedPath = SAVE_PATH;
    for (const code of state.availableCodes) state.courseStatus[code] = "\u6B63\u5728\u52A0\u5165\u9884\u9009";
    appendLog(state, `\u6B63\u5728\u4E00\u6B21\u6279\u91CF\u63D0\u4EA4 ${state.availableCodes.length} \u95E8\u8BFE\u7A0B`);
    saveState(state);
    submitNavigation(SAVE_PATH, fields);
  }
  async function handleSubmitResult(state) {
    await sleep(0.25);
    const latest = loadState();
    if (!latest?.active || latest.paused || latest.runId !== state.runId) return;
    state = latest;
    const courses = state.availableCodes.map((code) => state.lookups[code]?.row).filter(Boolean);
    if (courses.length !== state.availableCodes.length) {
      fail(state, "\u63D0\u4EA4\u7ED3\u679C\u7F3A\u5C11\u8BFE\u7A0B\u4E0A\u4E0B\u6587");
      return;
    }
    const outcomes = parseSubmitBatch(document, courses);
    const allCaptchaErrors = courses.every((course) => outcomes[course.code]?.result === "captcha_error");
    if (allCaptchaErrors) {
      if (state.attempts.submit >= 3) {
        fail(state, "\u9A8C\u8BC1\u7801\u8FDE\u7EED\u4E09\u6B21\u88AB\u670D\u52A1\u7AEF\u62D2\u7EDD");
        return;
      }
      state.phase = "captcha";
      state.expectedPath = currentPath();
      state.attempts.captchaImages = 0;
      appendLog(state, `\u670D\u52A1\u7AEF\u62D2\u7EDD\u9A8C\u8BC1\u7801\uFF0C\u51C6\u5907\u7B2C ${state.attempts.submit + 1} \u6B21\u63D0\u4EA4`);
      saveState(state);
      await handleCaptcha(state);
      return;
    }
    let returnToPoll = false;
    for (const course of courses) {
      const outcome = outcomes[course.code];
      if (!outcome) {
        fail(state, `${course.code}: \u65E0\u6CD5\u89E3\u6790\u63D0\u4EA4\u7ED3\u679C`);
        return;
      }
      switch (outcome.result) {
        case "success":
        case "already_selected":
          state.pendingCodes = removeCode(state.pendingCodes, course.code);
          state.courseStatus[course.code] = "\u5DF2\u52A0\u5165\u9884\u9009";
          appendLog(state, `${course.code}: \u5DF2\u52A0\u5165\u9884\u9009`);
          break;
        case "full":
          state.courseStatus[course.code] = "\u63D0\u4EA4\u65F6\u4F59\u91CF\u5DF2\u88AB\u5360\u7528";
          appendLog(state, `${course.code}: \u63D0\u4EA4\u65F6\u4F59\u91CF\u5DF2\u88AB\u5360\u7528\uFF0C\u8FD4\u56DE\u8F6E\u8BE2`);
          returnToPoll = true;
          break;
        case "time_conflict":
          state.pendingCodes = removeCode(state.pendingCodes, course.code);
          state.courseStatus[course.code] = "\u65F6\u95F4\u51B2\u7A81";
          appendLog(state, `${course.code}: ${outcome.message ?? "\u4E0E\u5DF2\u9009\u8BFE\u7A0B\u65F6\u95F4\u51B2\u7A81"}`);
          break;
        case "session_expired":
          fail(state, "\u63D0\u4EA4\u65F6\u4F1A\u8BDD\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55");
          return;
        case "captcha_error":
        case "unknown":
          fail(state, `${course.code}: \u65E0\u6CD5\u786E\u8BA4\u63D0\u4EA4\u7ED3\u679C${outcome.message ? `\uFF1A${outcome.message}` : ""}`);
          return;
      }
    }
    state.availableCodes = [];
    saveState(state);
    if (!state.pendingCodes.length) {
      complete(state, "\u6240\u6709\u76EE\u6807\u8BFE\u7A0B\u5747\u5DF2\u5904\u7406\uFF1B\u4EC5\u52A0\u5165\u9884\u9009\uFF0C\u672A\u63D0\u4EA4\u6700\u7EC8\u9009\u8BFE\u5355");
    } else if (returnToPoll || state.pendingCodes.length) {
      await waitAndContinue(state);
    }
  }
  async function dispatch(state) {
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
  async function resumeRun() {
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
  function directCodes(cache) {
    return cache.courses.map((course) => course.code);
  }

  // src/preferences.ts
  var PREFERENCES_KEY = "ucasxk.ui-preferences.v1";
  var MODES = ["watch", "enroll", "prepare_sids", "direct"];
  var DEFAULT_PREFERENCES = {
    schemaVersion: 1,
    mode: "watch",
    codesText: "",
    intervalMin: 3,
    intervalMax: 3.1,
    ocrUrl: "http://127.0.0.1:8765",
    collapsed: false
  };
  function validSidCache(value) {
    if (!value || typeof value !== "object") return false;
    const cache = value;
    return cache.version === 1 && Array.isArray(cache.courses);
  }
  function loadPreferences() {
    const raw = GM_getValue(PREFERENCES_KEY, null);
    if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFERENCES };
    const value = raw;
    if (value.schemaVersion !== 1) {
      GM_deleteValue(PREFERENCES_KEY);
      return { ...DEFAULT_PREFERENCES };
    }
    const savedMinimum = typeof value.intervalMin === "number" && Number.isFinite(value.intervalMin) ? value.intervalMin : DEFAULT_PREFERENCES.intervalMin;
    const intervalMin = Math.max(DEFAULT_PREFERENCES.intervalMin, savedMinimum);
    const savedMaximum = typeof value.intervalMax === "number" && Number.isFinite(value.intervalMax) ? value.intervalMax : DEFAULT_PREFERENCES.intervalMax;
    const intervalMax = savedMaximum >= intervalMin ? savedMaximum : Math.max(DEFAULT_PREFERENCES.intervalMax, intervalMin);
    return {
      schemaVersion: 1,
      mode: MODES.includes(value.mode) ? value.mode : DEFAULT_PREFERENCES.mode,
      codesText: typeof value.codesText === "string" ? value.codesText : "",
      intervalMin,
      intervalMax,
      ocrUrl: typeof value.ocrUrl === "string" ? value.ocrUrl : DEFAULT_PREFERENCES.ocrUrl,
      collapsed: value.collapsed === true,
      ...validSidCache(value.sidCache) ? { sidCache: value.sidCache } : {},
      ...typeof value.sidFileName === "string" ? { sidFileName: value.sidFileName } : {}
    };
  }
  function savePreferences(preferences) {
    GM_setValue(PREFERENCES_KEY, preferences);
  }

  // src/ui.ts
  var MODE_DESCRIPTIONS = {
    watch: "\u6309\u8BFE\u7A0B\u7F16\u7801\u67E5\u8BE2\u4E00\u6B21\u5F53\u524D\u4F59\u91CF\uFF0C\u4E0D\u63D0\u4EA4\uFF1B\u4E5F\u53EF\u4EE5\u5BFC\u5165 SID JSON \u81EA\u52A8\u586B\u5145\u8BFE\u7A0B\u7F16\u7801\u3002",
    enroll: "\u5B9E\u65F6\u67E5\u8BE2\u6700\u65B0 SID\uFF0C\u53D1\u73B0\u4F59\u91CF\u540E\u81EA\u52A8\u52A0\u5165\u9884\u9009\uFF1B\u9009\u8BFE\u9996\u65E5\u63A8\u8350\u4F7F\u7528\u3002",
    prepare_sids: "\u67E5\u8BE2\u5E76\u5BFC\u51FA\u5E26\u65F6\u95F4\u7684 SID JSON\uFF0C\u4F9B\u4E4B\u540E\u76F4\u63A5\u63D0\u4EA4\uFF1B\u975E\u9009\u8BFE\u9996\u65E5\u63A8\u8350\u4F7F\u7528\u3002",
    direct: "\u5BFC\u5165\u8FD1\u671F\u751F\u6210\u7684 SID JSON\uFF0C\u8DF3\u8FC7\u8BFE\u7A0B\u67E5\u8BE2\u5E76\u76F4\u63A5\u52A0\u5165\u9884\u9009\uFF1B\u975E\u9009\u8BFE\u9996\u65E5\u63A8\u8350\u4F7F\u7528\u3002"
  };
  var PHASE_LABELS = {
    read_selected: "\u8BFB\u53D6\u9884\u9009\u5217\u8868",
    open_select: "\u6253\u5F00\u8BFE\u7A0B\u5217\u8868",
    query_result: "\u67E5\u8BE2\u8BFE\u7A0B",
    captcha: "\u7B49\u5F85\u9A8C\u8BC1",
    submit_result: "\u8BFB\u53D6\u9884\u9009\u7ED3\u679C",
    waiting: "\u7B49\u5F85\u4E0B\u4E00\u8F6E",
    completed: "\u5DF2\u5B8C\u6210",
    stopped: "\u5DF2\u505C\u6B62"
  };
  var ACTION_LABELS = {
    watch: "\u67E5\u8BE2\u4F59\u91CF",
    prepare_sids: "\u5BFC\u51FA SID \u6587\u4EF6",
    enroll: "\u5F00\u59CB\u81EA\u52A8\u9884\u9009",
    direct: "\u5F00\u59CB\u9884\u9009"
  };
  function mountPanel() {
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
      .panel[data-status="\u5DF2\u505C\u6B62"] #result { background:#fff4ec; border-color:#af5825; }
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
      <header><span>UCASxk \u9009\u8BFE\u52A9\u624B</span><span id="badge" role="status"></span><button id="collapse" aria-controls="body actions" title="\u6298\u53E0">\u2212</button></header>
      <main id="body"><div id="config">
        <label for="mode">\u8FD0\u884C\u6A21\u5F0F</label>
        <select id="mode">
          <option value="watch">\u89C2\u5BDF\u4E00\u6B21\u4F59\u91CF\uFF08\u4E0D\u63D0\u4EA4\uFF09</option>
          <option value="enroll">\u81EA\u52A8\u52A0\u5165\u9884\u9009\uFF08\u9009\u8BFE\u9996\u65E5\u63A8\u8350\uFF09</option>
          <option value="prepare_sids">\u51C6\u5907\u5E76\u4E0B\u8F7D SID\uFF08\u975E\u9009\u8BFE\u9996\u65E5\u63A8\u8350\uFF09</option>
          <option value="direct">\u5BFC\u5165 SID \u76F4\u63A5\u63D0\u4EA4\uFF08\u975E\u9009\u8BFE\u9996\u65E5\u63A8\u8350\uFF09</option>
        </select>
        <div id="mode-description" class="file-name"></div>
        <label for="codes">\u8BFE\u7A0B\u7F16\u7801\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09</label>
        <textarea id="codes" placeholder="180080025200M3001H"></textarea>
        <div id="sid-area" hidden>
          <label id="sid-label" for="sid-file">SID JSON\uFF08version 1\uFF09</label>
          <input id="sid-file" type="file" accept="application/json,.json">
          <div id="file-name" class="file-name">\u5C1A\u672A\u9009\u62E9\u6587\u4EF6</div>
        </div>
        <details id="advanced"><summary>\u9AD8\u7EA7\u8BBE\u7F6E</summary><div class="row">
          <div><label for="min">\u6700\u5C0F\u95F4\u9694/\u79D2</label><input id="min" type="number" min="3" step="0.1" value="3"></div>
          <div><label for="max">\u6700\u5927\u95F4\u9694/\u79D2</label><input id="max" type="number" min="3" step="0.1" value="3.1"></div>
        </div>
        <label for="ocr">\u672C\u5730 OCR \u5730\u5740</label>
        <input id="ocr"></details>
        <div class="notice">\u811A\u672C\u53EA\u4F1A\u5C06\u8BFE\u7A0B\u52A0\u5165\u9884\u9009\uFF0C\u4E0D\u4F1A\u63D0\u4EA4\u6700\u7EC8\u9009\u8BFE\u5355\u3002</div>
        </div>
        <div id="progress" hidden>
          <div id="summary" class="summary" role="status"></div>
          <p id="result"></p>
          <div id="courses" class="course-list"></div>
          <details><summary>\u8BE6\u7EC6\u65E5\u5FD7</summary><div id="logs" class="logs"></div></details>
        </div>
      </main>
      <footer id="actions">
        <button id="start" class="action">\u67E5\u8BE2\u4F59\u91CF</button>
        <button id="pause" class="action" hidden>\u6682\u505C</button>
        <button id="stop" class="action" hidden>\u505C\u6B62</button>
        <button id="back" class="action" hidden>\u8FD4\u56DE\u914D\u7F6E</button>
      </footer>
    </section>`;
    const panel = root.querySelector(".panel");
    const mode = root.querySelector("#mode");
    const codes = root.querySelector("#codes");
    const min = root.querySelector("#min");
    const max = root.querySelector("#max");
    const ocr = root.querySelector("#ocr");
    const sidArea = root.querySelector("#sid-area");
    const sidLabel = root.querySelector("#sid-label");
    const modeDescription = root.querySelector("#mode-description");
    const sidFile = root.querySelector("#sid-file");
    const fileName = root.querySelector("#file-name");
    const config = root.querySelector("#config");
    const progress = root.querySelector("#progress");
    const result = root.querySelector("#result");
    const badge = root.querySelector("#badge");
    const advanced = root.querySelector("#advanced");
    const back = root.querySelector("#back");
    const summary = root.querySelector("#summary");
    const courseList = root.querySelector("#courses");
    const logs = root.querySelector("#logs");
    const start = root.querySelector("#start");
    const pause = root.querySelector("#pause");
    const stop = root.querySelector("#stop");
    const collapse = root.querySelector("#collapse");
    let preferences = loadPreferences();
    const existingState = loadState();
    let importedCache = preferences.sidCache;
    mode.value = existingState?.active ? existingState.mode : preferences.mode;
    codes.value = preferences.codesText || (existingState ? Object.keys(existingState.courseStatus).join("\n") : "");
    min.value = String(preferences.intervalMin);
    max.value = String(preferences.intervalMax);
    ocr.value = preferences.ocrUrl;
    panel.classList.toggle("collapsed", preferences.collapsed);
    collapse.textContent = preferences.collapsed ? "+" : "\u2212";
    if (importedCache) {
      fileName.textContent = `${preferences.sidFileName || "\u5DF2\u4FDD\u5B58\u7684 SID JSON"} \xB7 ${importedCache.courses.length} \u95E8\u8BFE\u7A0B`;
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
    function showError(field, message) {
      if (advanced.contains(field)) advanced.open = true;
      root.getElementById(field.id + "-error").textContent = message;
      field.setAttribute("aria-invalid", "true");
      field.focus();
    }
    function resetErrors() {
      for (const field of fields) {
        field.removeAttribute("aria-invalid");
        root.getElementById(field.id + "-error").textContent = "";
      }
    }
    function persistPreferences() {
      const intervalMin = Number(min.value);
      const intervalMax = Number(max.value);
      preferences = {
        schemaVersion: 1,
        mode: mode.value,
        codesText: codes.value,
        intervalMin: Number.isFinite(intervalMin) ? intervalMin : preferences.intervalMin,
        intervalMax: Number.isFinite(intervalMax) ? intervalMax : preferences.intervalMax,
        ocrUrl: ocr.value.trim(),
        collapsed: panel.classList.contains("collapsed"),
        ...importedCache ? { sidCache: importedCache } : {},
        ...preferences.sidFileName ? { sidFileName: preferences.sidFileName } : {}
      };
      savePreferences(preferences);
    }
    function updateMode() {
      const selectedMode = mode.value;
      sidArea.hidden = selectedMode !== "direct" && selectedMode !== "watch";
      sidLabel.textContent = selectedMode === "watch" ? "\u5BFC\u5165 SID JSON\uFF08\u53EF\u9009\uFF0C\u7528\u4E8E\u586B\u5145\u8BFE\u7A0B\u7F16\u7801\uFF09" : "SID JSON\uFF08version 1\uFF09";
      modeDescription.textContent = MODE_DESCRIPTIONS[selectedMode];
      advanced.hidden = selectedMode === "watch" || selectedMode === "prepare_sids";
      start.textContent = ACTION_LABELS[selectedMode];
      resetErrors();
    }
    function render() {
      const state = loadState();
      const active = Boolean(state?.active);
      config.hidden = Boolean(state);
      progress.hidden = !state;
      start.hidden = Boolean(state);
      pause.hidden = stop.hidden = !active;
      back.hidden = !state || active;
      pause.textContent = state?.paused ? "\u7EE7\u7EED" : "\u6682\u505C";
      const label = !state ? "\u914D\u7F6E" : state.active ? state.paused ? "\u5DF2\u6682\u505C" : "\u8FD0\u884C\u4E2D" : PHASE_LABELS[state.phase];
      badge.textContent = label;
      panel.dataset.status = label;
      const collapsed = panel.classList.contains("collapsed");
      collapse.setAttribute("aria-expanded", String(!collapsed));
      collapse.title = collapsed ? "\u5C55\u5F00\u9009\u8BFE\u52A9\u624B" : "\u6298\u53E0\u9009\u8BFE\u52A9\u624B";
      collapse.setAttribute("aria-label", collapse.title);
      if (!state) return;
      summary.textContent = active ? `${PHASE_LABELS[state.phase]} \xB7 \u5F85\u5904\u7406 ${state.pendingCodes.length} \u95E8` : `\u8BFE\u7A0B\u7ED3\u679C \xB7 \u5171 ${Object.keys(state.courseStatus).length} \u95E8`;
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
        })
      );
      logs.textContent = state.logs.length ? state.logs.map((item) => `${item.at.slice(11, 19)} ${item.message}`).join("\n") : "\u6682\u65E0\u8FD0\u884C\u65E5\u5FD7";
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
        fileName.textContent = `${file.name} \xB7 ${importedCache.courses.length} \u95E8\u8BFE\u7A0B`;
        codes.value = directCodes(importedCache).join("\n");
        preferences.sidFileName = file.name;
        persistPreferences();
      } catch (reason) {
        importedCache = void 0;
        preferences.sidFileName = void 0;
        fileName.textContent = "\u6587\u4EF6\u65E0\u6548";
        persistPreferences();
        showError(sidFile, reason instanceof Error ? reason.message : String(reason));
      }
    });
    start.addEventListener("click", () => {
      resetErrors();
      let field = codes;
      try {
        const selectedMode = mode.value;
        let selectedCodes = parseCodes(codes.value);
        if (selectedMode === "direct") {
          field = sidFile;
          if (!importedCache) throw new Error("\u8BF7\u5148\u9009\u62E9\u6709\u6548\u7684 SID JSON \u6587\u4EF6");
          if (!selectedCodes.length) selectedCodes = directCodes(importedCache);
        }
        field = codes;
        if (!selectedCodes.length) throw new Error("\u8BF7\u81F3\u5C11\u586B\u5199\u4E00\u4E2A\u8BFE\u7A0B\u7F16\u7801");
        if (!advanced.hidden) {
          field = min;
          if (!(min.valueAsNumber >= 3)) throw new Error("\u6700\u5C0F\u95F4\u9694\u81F3\u5C11\u4E3A 3 \u79D2");
          field = max;
          if (!(max.valueAsNumber >= min.valueAsNumber)) throw new Error("\u6700\u5927\u95F4\u9694\u987B\u5927\u4E8E\u6216\u7B49\u4E8E\u6700\u5C0F\u95F4\u9694");
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
          ...importedCache ? { sidCache: importedCache } : {}
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
      event.currentTarget.textContent = panel.classList.contains("collapsed") ? "+" : "\u2212";
      persistPreferences();
      render();
    });
    window.addEventListener("ucasxk-state-change", render);
    updateMode();
    render();
  }

  // src/main.ts
  function main() {
    mountPanel();
    window.setTimeout(() => void resumeRun(), 0);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main, { once: true });
  } else {
    main();
  }
})();
