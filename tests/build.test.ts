// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("userscript metadata", () => {
  it("limits the script to xkgo and the OCR connection to loopback", () => {
    const script = readFileSync(new URL("../scripts/build.mjs", import.meta.url), "utf8");
    expect(script).toContain("@match        https://xkgo.ucas.ac.cn:3000/*");
    expect(script).toContain("@connect      127.0.0.1");
    expect(script).not.toMatch(/JSESSIONID|browser_fingerprint|Identity=/);
  });
});
