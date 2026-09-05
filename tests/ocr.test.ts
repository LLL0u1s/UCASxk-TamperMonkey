import { describe, expect, it } from "vitest";
import { normalizeOcrUrl } from "../src/ocr";

describe("OCR URL safety", () => {
  it("accepts loopback URLs", () => {
    expect(normalizeOcrUrl("http://127.0.0.1:8765")).toBe("http://127.0.0.1:8765/v1/ocr");
    expect(normalizeOcrUrl("http://localhost:8765/")).toBe("http://localhost:8765/v1/ocr");
  });

  it("rejects remote and HTTPS endpoints", () => {
    expect(() => normalizeOcrUrl("http://192.168.1.2:8765")).toThrow(/localhost/);
    expect(() => normalizeOcrUrl("https://127.0.0.1:8765")).toThrow(/HTTP/);
  });
});
