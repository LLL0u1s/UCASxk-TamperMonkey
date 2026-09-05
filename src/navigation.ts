import type { NamedField } from "./types";

export function navigateGet(path: string): void {
  window.location.assign(path);
}

export function submitNavigation(path: string, fields: NamedField[]): void {
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

export function navigationStatus(): number | undefined {
  const entry = performance.getEntriesByType("navigation")[0] as
    | (PerformanceNavigationTiming & { responseStatus?: number })
    | undefined;
  return entry?.responseStatus;
}
