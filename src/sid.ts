import type { CourseLookup, SidCache } from "./types";

export function parseCodes(text: string): string[] {
  return [...new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.replace(/#.*$/, "").trim())
      .filter(Boolean),
  )];
}

export function parseSidCache(text: string): SidCache {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("SID 文件不是有效 JSON");
  }
  if (!value || typeof value !== "object") throw new Error("SID 文件结构无效");
  const cache = value as Partial<SidCache>;
  if (cache.version !== 1 || !Array.isArray(cache.courses)) {
    throw new Error("仅支持 version 1 的 SID 文件");
  }
  const seen = new Set<string>();
  for (const item of cache.courses) {
    if (!item || typeof item.code !== "string" || !item.code.trim()) throw new Error("SID 文件存在空课程编码");
    if (typeof item.name !== "string" || !item.name.trim()) throw new Error(`课程 ${item.code} 缺少名称`);
    if (typeof item.sid !== "string" || !item.sid.trim()) throw new Error(`课程 ${item.code} 的 SID 为空`);
    if (item.limit !== null && typeof item.limit !== "number") throw new Error(`课程 ${item.code} 的限选人数无效`);
    if (item.selected !== null && typeof item.selected !== "number") throw new Error(`课程 ${item.code} 的已选人数无效`);
    if (typeof item.selectable !== "boolean") throw new Error(`课程 ${item.code} 的 selectable 无效`);
    if (seen.has(item.code)) throw new Error(`SID 文件存在重复课程编码: ${item.code}`);
    seen.add(item.code);
  }
  return cache as SidCache;
}

export function makeSidCache(codes: string[], lookups: Record<string, CourseLookup>): SidCache {
  return {
    version: 1,
    created_at: new Date().toISOString(),
    courses: codes.map((code) => {
      const lookup = lookups[code];
      if (!lookup) throw new Error(`缺少课程 ${code} 的查询结果`);
      return { ...lookup.row };
    }),
  };
}

export function sidFilename(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const timestamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
  return `ucasxk-sids-${timestamp}.json`;
}

export function downloadSidCache(cache: SidCache): void {
  const blob = new Blob([JSON.stringify(cache, null, 2) + "\n"], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = sidFilename();
  link.click();
  URL.revokeObjectURL(link.href);
}
