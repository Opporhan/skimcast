// skimcast (uzantı): result.js — background.js'in chrome.storage.local'e yazdığı özeti okur, gösterir.

function t(key) { return chrome.i18n.getMessage(key) || key; }

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Küçük, güvenli bir markdown -> HTML dönüştürücü: **kalın**, [metin](url), paragraflar, "- " listeleri.
function renderMarkdown(md) {
  const lines = escapeHtml(md).split(/\r?\n/);
  let html = "", inList = false;
  const flushList = () => { if (inList) { html += "</ul>"; inList = false; } };
  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  let para = [];
  const flushPara = () => {
    if (para.length) { html += `<p>${inline(para.join(" "))}</p>`; para = []; }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    const li = line.match(/^[-*]\s+(.*)/);
    if (li) {
      flushPara();
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(li[1])}</li>`;
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return html;
}

async function init() {
  const app = document.getElementById("app");
  const id = new URLSearchParams(location.search).get("id");
  if (!id) { app.innerHTML = `<p class="error">${t("error_no_result")}</p>`; return; }

  const key = `skimcastResult:${id}`;
  const { [key]: result } = await chrome.storage.local.get(key);
  if (!result) { app.innerHTML = `<p class="error">${t("error_result_not_found")}</p>`; return; }

  const { meta, markdown } = result;
  document.title = meta.title || "skimcast";
  const metaLine = [meta.title, meta.duration, meta.method].filter(Boolean).join(" · ");

  app.innerHTML = `
    <header>
      <h1>${escapeHtml(meta.title || t("popup_title"))}</h1>
      <div class="meta">${escapeHtml(metaLine)}</div>
    </header>
    <div class="actions">
      <button id="copyBtn">${t("copy_btn")}</button>
    </div>
    <div class="content">${renderMarkdown(markdown)}</div>
  `;

  document.getElementById("copyBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      const btn = document.getElementById("copyBtn");
      const original = btn.textContent;
      btn.textContent = t("copied");
      setTimeout(() => { btn.textContent = original; }, 1500);
    } catch { /* pano izni yoksa sessizce geç */ }
  });
}

init();
