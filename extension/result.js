// skimcast (uzantı): result.js — background.js'in chrome.storage.local'e yazdığı özeti okur, gösterir.
// Özet akış (streaming) halinde geliyor: background.js metni yazıldıkça bu anahtara yazıyor, biz de
// chrome.storage.onChanged ile dinleyip canlı güncelliyoruz (uzun videolarda boş ekranda beklemek yerine
// metin yazılırken görünür).

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

  let result = (await chrome.storage.local.get(key))[key];
  if (!result) { app.innerHTML = `<p class="error">${t("error_result_not_found")}</p>`; return; }

  const meta = result.meta;
  document.title = meta.title || "skimcast";
  const metaLine = [meta.title, meta.duration, meta.method].filter(Boolean).join(" · ");

  app.innerHTML = `
    <header>
      <h1>${escapeHtml(meta.title || t("popup_title"))}</h1>
      <div class="meta">${escapeHtml(metaLine)}</div>
    </header>
    <div class="actions">
      <button id="copyBtn">${t("copy_btn")}</button>
      <span id="statusLine" class="hint"></span>
    </div>
    <div class="content" id="content"></div>
    <p class="error" id="errorLine" hidden></p>
  `;

  const contentEl = document.getElementById("content");
  const statusEl = document.getElementById("statusLine");
  const errorEl = document.getElementById("errorLine");

  function render(r) {
    contentEl.innerHTML = renderMarkdown(r.markdown || "");
    statusEl.textContent = r.status === "streaming" ? t("status_streaming") : "";
    if (r.status === "error") {
      errorEl.hidden = false;
      errorEl.textContent = (t("error_prefix") ? t("error_prefix") + " " : "") + (r.error || "");
    } else {
      errorEl.hidden = true;
    }
  }
  render(result);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[key]) return;
    result = changes[key].newValue;
    if (result) render(result);
  });

  document.getElementById("copyBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(result.markdown || "");
      const btn = document.getElementById("copyBtn");
      const original = btn.textContent;
      btn.textContent = t("copied");
      setTimeout(() => { btn.textContent = original; }, 1500);
    } catch { /* pano izni yoksa sessizce geç */ }
  });
}

init();
