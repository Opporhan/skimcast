// skimcast (uzantı): result.js — background.js'in chrome.storage.local'e bıraktığı transcript'i okuyup
// ÖZETLEMEYİ BURADA (bu sekmede, summarize.js'teki fonksiyonlarla) başlatır ve sonucu yine
// chrome.storage.local'e yazar, chrome.storage.onChanged ile kendi görünümünü günceller. Özetleme
// background.js'in servis çalışanında değil, burada çalışıyor: Chrome servis çalışanlarını uzun süren
// işlerin ortasında sonlandırabiliyordu (uzun videolarda "Özetleniyor" sonsuza kadar takılı kalıyordu),
// normal bir sekme bu şekilde öldürülmüyor.

const resultKey = (id) => `skimcastResult:${id}`;

async function setResult(id, patch) {
  const key = resultKey(id);
  const { [key]: cur } = await chrome.storage.local.get(key);
  await chrome.storage.local.set({ [key]: { ...cur, ...patch } });
}

async function runSummary(id, meta, text, langName) {
  try {
    const apiKey = await getApiKey();
    const markdown = await summarizeLong(apiKey, meta, text, langName);
    await setResult(id, { markdown, status: "done" });
  } catch (e) {
    await setResult(id, { status: "error", error: e instanceof SkimError ? e.message : String(e.message || e) });
  }
}

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
    </div>
    <div class="content" id="content"></div>
    <p class="error" id="errorLine" hidden></p>
  `;

  const contentEl = document.getElementById("content");
  const errorEl = document.getElementById("errorLine");

  function render(r) {
    if (r.status === "loading") {
      contentEl.innerHTML = `<p class="hint">${t("status_loading")}</p>`;
    } else {
      contentEl.innerHTML = renderMarkdown(r.markdown || "");
    }
    if (r.status === "error") {
      errorEl.hidden = false;
      errorEl.textContent = (t("error_prefix") ? t("error_prefix") + " " : "") + (r.error || "");
    } else {
      errorEl.hidden = true;
    }
  }
  render(result);

  // Özetleme henüz başlamadıysa (status "loading" ve metin daha işlenmemiş) burada başlat.
  if (result.status === "loading" && result.text) runSummary(id, meta, result.text, result.langName);

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
