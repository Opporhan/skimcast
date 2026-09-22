// skimcast (uzantı): viewer.js — background.js'in arşive kaydettiği transcript'i gösterir. Özet üretmez;
// zaman damgalı transcript'i arama, tıkla-git, olası reklam tespiti ve alıntı/kopyala/indir katmanlarıyla
// sunar (bkz. proje kararı: LLM'e dayalı özetleme bir gece süren kota/güvenilirlik sorunları yüzünden
// terk edildi — bu sayfa artık hiçbir dış API'ye gitmiyor, tamamen yerel çalışıyor).

function t(key) { return chrome.i18n.getMessage(key) || key; }

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtTime(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Kaba, isteğe bağlı bir sezgisel: transcript metninde sponsor/reklam okuması gibi görünen kalıpları
// arar. Kesin değildir (bir topluluk veritabanına değil, tek bir metne dayanıyor) — bu yüzden arayüzde
// "olası reklam" diye etiketleniyor, kesin bir iddia gibi sunulmuyor.
const AD_PATTERNS = [
  /\bsponsor(lu|luk|luğunda|ed)?\b/i,
  /(bu (video|bölüm)\w*|this (video|episode))\s+.{0,40}(sponsorluğunda|tarafından sunul\w*|destekle\w*|is sponsored by|brought to you by)/i,
  /\btoday'?s sponsor\b/i,
  /\buse (code|promo code)\b/i,
  /\bindirim kodu\b/i,
  /\baffiliate link\b/i,
  /\bpartnered with\b/i,
  /\bpaid partnership\b/i,
  /\bthanks to .{0,30} for sponsoring\b/i,
];
function isLikelyAd(text) { return AD_PATTERNS.some((re) => re.test(text)); }

function jumpUrl(meta, sec) {
  return meta.linkPrefix && sec != null ? `${meta.linkPrefix}${Math.floor(sec)}` : null;
}

function openInTab(url) {
  chrome.tabs.create({ url, active: true });
}

async function flashLabel(btn, label) {
  const original = btn.textContent;
  btn.textContent = label;
  setTimeout(() => { btn.textContent = original; }, 1500);
}

async function init() {
  const app = document.getElementById("app");
  const id = new URLSearchParams(location.search).get("id");
  if (!id) { app.innerHTML = `<p class="error">${t("error_no_result")}</p>`; return; }
  const key = `skimcastArchive:${id}`;

  const entry = (await chrome.storage.local.get(key))[key];
  if (!entry) { app.innerHTML = `<p class="error">${t("error_result_not_found")}</p>`; return; }

  const { meta, blocks } = entry;
  document.title = meta.title || "skimcast";
  const metaLine = [meta.title, meta.duration, meta.method].filter(Boolean).join(" · ");

  app.innerHTML = `
    <header>
      <a class="back" href="library.html">${t("library_link")}</a>
      <h1>${escapeHtml(meta.title || t("popup_title"))}</h1>
      <div class="meta">${escapeHtml(metaLine)}</div>
    </header>
    <div class="toolbar">
      <input id="search" type="text" placeholder="${escapeHtml(t("search_placeholder"))}">
      <button id="copyBtn">${t("copy_btn")}</button>
      <button id="downloadBtn">${t("download_btn")}</button>
    </div>
    <p id="noMatches" class="hint" hidden>${t("no_matches")}</p>
    <div class="content" id="content"></div>
  `;

  const contentEl = document.getElementById("content");
  const fullText = blocks.map((b) => (b.sec != null ? `[${fmtTime(b.sec)}] ` : "") + b.text).join("\n");

  // Her blok için: (varsa) tıkla-git zaman damgası, metin, (varsa) "olası reklam" rozeti + atlama linki,
  // ve bir "alıntıla" düğmesi. Arama filtrelemesi data-text üzerinden çalışır, DOM'u yeniden kurmaz.
  blocks.forEach((b, i) => {
    const row = document.createElement("div");
    row.className = "block";
    row.dataset.text = b.text.toLocaleLowerCase("tr");

    if (b.sec != null) {
      const time = document.createElement(jumpUrl(meta, b.sec) ? "button" : "span");
      time.className = "time";
      time.textContent = fmtTime(b.sec);
      const url = jumpUrl(meta, b.sec);
      if (url) time.addEventListener("click", () => openInTab(url));
      row.appendChild(time);
    }

    const textSpan = document.createElement("span");
    textSpan.className = "text";
    textSpan.textContent = b.text;
    row.appendChild(textSpan);

    if (isLikelyAd(b.text)) {
      const badge = document.createElement("span");
      badge.className = "ad-badge";
      badge.textContent = t("ad_badge");
      row.appendChild(badge);

      const next = blocks.slice(i + 1).find((n) => n.sec != null);
      const skipUrl = jumpUrl(meta, next ? next.sec : b.sec);
      if (skipUrl) {
        const skip = document.createElement("button");
        skip.className = "ad-skip";
        skip.textContent = t("ad_skip");
        skip.addEventListener("click", () => openInTab(skipUrl));
        row.appendChild(skip);
      }
    }

    const quoteBtn = document.createElement("button");
    quoteBtn.className = "quote-btn";
    quoteBtn.textContent = t("quote_btn");
    quoteBtn.addEventListener("click", async () => {
      const url = jumpUrl(meta, b.sec);
      const quote = `"${b.text}" — ${meta.title}${b.sec != null ? ` [${fmtTime(b.sec)}]` : ""}${url ? `\n${url}` : ""}`;
      try {
        await navigator.clipboard.writeText(quote);
        flashLabel(quoteBtn, t("copied"));
      } catch { /* pano izni yoksa sessizce geç */ }
    });
    row.appendChild(quoteBtn);

    contentEl.appendChild(row);
  });

  // ------------------------------------------------------------ arama (anlık filtre + vurgulama)
  const searchInput = document.getElementById("search");
  const noMatches = document.getElementById("noMatches");
  const rows = [...contentEl.querySelectorAll(".block")];

  function applySearch(qRaw) {
    const q = qRaw.trim().toLocaleLowerCase("tr");
    let anyVisible = false;
    for (const row of rows) {
      const match = !q || row.dataset.text.includes(q);
      row.hidden = !match;
      if (match) anyVisible = true;
      const textSpan = row.querySelector(".text");
      if (!q) {
        textSpan.textContent = textSpan.textContent; // vurgulamayı temizle (zaten düz metin)
      } else if (match) {
        const original = row.dataset.text;
        const idx = original.indexOf(q);
        const raw = textSpan.textContent;
        textSpan.innerHTML = `${escapeHtml(raw.slice(0, idx))}<mark>${escapeHtml(raw.slice(idx, idx + q.length))}</mark>${escapeHtml(raw.slice(idx + q.length))}`;
      }
    }
    noMatches.hidden = !q || anyVisible;
  }
  searchInput.addEventListener("input", () => applySearch(searchInput.value));

  const initialQuery = new URLSearchParams(location.search).get("q");
  if (initialQuery) {
    searchInput.value = initialQuery;
    applySearch(initialQuery);
    contentEl.querySelector(".block:not([hidden])")?.scrollIntoView({ block: "center" });
  }

  // ------------------------------------------------------------ kopyala / indir
  document.getElementById("copyBtn").addEventListener("click", async (e) => {
    try {
      await navigator.clipboard.writeText(fullText);
      flashLabel(e.currentTarget, t("copied"));
    } catch { /* pano izni yoksa sessizce geç */ }
  });

  document.getElementById("downloadBtn").addEventListener("click", () => {
    const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(meta.title || "transcript").replace(/[\\/:*?"<>|]+/g, " ").trim()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

init();
