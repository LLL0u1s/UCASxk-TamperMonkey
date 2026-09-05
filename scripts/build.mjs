import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

const banner = `// ==UserScript==
// @name         UCASxk 选课助手
// @namespace    https://github.com/LLL0u1s/UCASxk-TamperMonkey
// @version      0.2.1
// @description  在 UCAS xkgo 页面监控课程并经本地 OCR 将课程加入预选
// @match        https://xkgo.ucas.ac.cn:3000/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==`;

await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/ucasxk.user.js",
  bundle: true,
  format: "iife",
  target: ["chrome120"],
  banner: { js: banner },
  legalComments: "none",
  sourcemap: false,
});
