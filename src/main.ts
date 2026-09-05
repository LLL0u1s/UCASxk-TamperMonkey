import { resumeRun } from "./engine";
import { mountPanel } from "./ui";

function main(): void {
  mountPanel();
  window.setTimeout(() => void resumeRun(), 0);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main, { once: true });
} else {
  main();
}
