// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("userscript metadata", () => {
  it("matches the configured course site and uses the package version", () => {
    const script = readFileSync(new URL("../scripts/build.mjs", import.meta.url), "utf8");
    expect(script).toContain("@namespace    https://github.com/LLL0u1s/UCASxk-TamperMonkey");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect([...script.matchAll(/^\/\/ @match\s+(\S+)/gm)].map((match) => match[1]))
      .toEqual(["https://xkgodj.ucas.ac.cn/*"]);
    expect(script.match(/^\/\/ @version\s+(\S+)/m)?.[1]).toBe(pkg.version);
    expect(script).toContain("@connect      127.0.0.1");
    expect(script).not.toMatch(/JSESSIONID|browser_fingerprint|Identity=/);
  });

  it("does not use a blocking confirmation dialog", () => {
    const ui = readFileSync(new URL("../src/ui.ts", import.meta.url), "utf8");
    expect(ui).not.toContain("window.confirm");
    expect(ui).toContain("自动加入预选（选课首日推荐）");
  });
});
