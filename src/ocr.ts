import type { OcrResponse } from "./types";

export function normalizeOcrUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("OCR 地址格式无效");
  }
  if (url.protocol !== "http:") throw new Error("OCR 服务必须使用本机 HTTP 地址");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("OCR 服务地址必须是 localhost");
  }
  return `${url.origin}/v1/ocr`;
}

export function recognizeCaptcha(baseUrl: string, image: string): Promise<OcrResponse> {
  const url = normalizeOcrUrl(baseUrl);
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: "POST",
      url,
      headers: {
        "Content-Type": "application/json",
        "X-UCASXK-Client": "tampermonkey",
      },
      data: JSON.stringify({ image }),
      timeout: 10_000,
      onload(response) {
        if (response.status !== 200) {
          reject(new Error(`OCR 服务返回 ${response.status}`));
          return;
        }
        try {
          const result = JSON.parse(response.responseText) as OcrResponse;
          if (
            typeof result.text !== "string" ||
            typeof result.confidence !== "number" ||
            typeof result.accepted !== "boolean"
          ) throw new Error("响应结构无效");
          resolve(result);
        } catch (error) {
          reject(new Error(`OCR 响应无法解析: ${String(error)}`));
        }
      },
      onerror: () => reject(new Error("无法连接本地 OCR 服务")),
      ontimeout: () => reject(new Error("本地 OCR 服务响应超时")),
    });
  });
}
