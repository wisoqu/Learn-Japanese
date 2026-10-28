/* ==========================================================================
   main.js — запуск
   ========================================================================== */

import { bootApp, syncLoop } from "./app.js";
import { settings } from "./settings.js";
import { progress } from "./srs.js";

function fail(msg) {
  const boot = document.getElementById("boot");
  if (!boot) return;
  boot.innerHTML = `<div style="text-align:center;padding:30px;max-width:420px">
    <div style="font-family:var(--font-kana);font-size:64px;color:var(--vermilion)">⚠️</div>
    <h2 style="margin:14px 0 6px">Не удалось загрузить</h2>
    <p class="muted small" style="margin:0">${msg}</p>
    <p class="small" style="margin-top:14px">Проверьте, что файл <code>app/data/kana.json</code> доступен,
       и перезапустите приложение. Или запустите <code>python3 tools/generate_data.py --source tools/kanjivg-src</code>.</p>
  </div>`;
}

settings.applyTheme();

(async () => {
  try {
    await bootApp();
    const boot = document.getElementById("boot");
    const app = document.getElementById("app");
    app.hidden = false;
    if (boot) {
      boot.classList.add("done");
      setTimeout(() => boot.remove(), 420);
    }
    // Keep the backend in sync without blocking the UI.
    syncLoop();
    setInterval(syncLoop, 5 * 60 * 1000);
    window.addEventListener("beforeunload", () => progress.save(true));
  } catch (e) {
    console.error(e);
    fail(String(e && e.message ? e.message : e));
  }
})();
