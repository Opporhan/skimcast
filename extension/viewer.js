// skimcast (uzantı): viewer.js — background.js'in arşive kaydettiği transcript'i gösterir. Özet üretmez;
// zaman damgalı transcript'i arama, tıkla-git, olası reklam tespiti, favori/alıntı, kopyala/indir ve
// (cihaz üzerinde, ücretsiz/kotasız) çeviri katmanlarıyla sunar. Çeviri hariç hiçbir dış API'ye gitmez.

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
// arar. Kesin değildir — bu yüzden arayüzde "olası reklam" diye etiketleniyor. Her zaman ORİJİNAL metne
// bakılır (çeviri sonrası tekrar çalıştırılmaz) çünkü kalıp listesi orijinal dillere göre ayarlı.
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

function flashLabel(btn, label) {
  const original = btn.textContent;
  btn.textContent = label;
  setTimeout(() => { btn.textContent = original; }, 1500);
}

// ------------------------------------------------------------ çeviri (cihaz üzerinde, Translator API)
const TRANSLATE_LANGS = [
  { code: "tr", label: "Türkçe" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "ja", label: "日本語" },
  { code: "pt", label: "Português" },
  { code: "ar", label: "العربية" },
  { code: "ru", label: "Русский" },
];

async function detectSourceLanguage(sampleText) {
  if (typeof LanguageDetector === "undefined") return null;
  try {
    if ((await LanguageDetector.availability()) === "unavailable") return null;
    const detector = await LanguageDetector.create();
    const [top] = await detector.detect(sampleText.slice(0, 800));
    return top && top.detectedLanguage !== "und" && top.confidence > 0.4 ? top.detectedLanguage : null;
  } catch {
    return null;
  }
}

async function init() {
  const app = document.getElementById("app");
  const id = new URLSearchParams(location.search).get("id");
  if (!id) { app.innerHTML = `<p class="error">${t("error_no_result")}</p>`; return; }
  const key = `skimcastArchive:${id}`;

  const entry = (await chrome.storage.local.get(key))[key];
  if (!entry) { app.innerHTML = `<p class="error">${t("error_result_not_found")}</p>`; return; }

  const { meta, blocks } = entry;
  entry.highlights = entry.highlights || []; // {sec, text, ts}[] — favorilenen anlar
  document.title = meta.title || "skimcast";
  const metaLine = [meta.title, meta.duration, meta.method].filter(Boolean).join(" · ");
  const canTranslate = typeof Translator !== "undefined";

  app.innerHTML = `
    <header>
      <div class="header-top">
        <a class="back" href="library.html">${t("library_link")}</a>
        <button id="themeBtn" class="theme-btn" title="${escapeHtml(t("theme_btn"))}"></button>
      </div>
      <h1>${escapeHtml(meta.title || t("popup_title"))}</h1>
      <div class="meta">${escapeHtml(metaLine)}</div>
    </header>
    <div class="toolbar">
      <input id="search" type="text" placeholder="${escapeHtml(t("search_placeholder"))}">
      <button id="favOnlyBtn" class="toggle-btn">${t("fav_only_btn")}</button>
      <button id="copyBtn">${t("copy_btn")}</button>
      <div class="download-wrap">
        <button id="downloadBtn">${t("download_btn")}</button>
        <div id="downloadMenu" class="download-menu" hidden>
          <button id="downloadTxt">${t("download_as_txt")}</button>
          <button id="downloadPdf">${t("download_as_pdf")}</button>
        </div>
      </div>
    </div>
    ${canTranslate ? `
    <div class="toolbar translate-bar">
      <select id="translateLang"></select>
      <button id="translateBtn">${t("translate_btn")}</button>
      <button id="originalBtn" hidden>${t("translate_original_btn")}</button>
      <span id="translateStatus" class="hint" hidden></span>
    </div>` : ""}
    <p id="noMatches" class="hint" hidden>${t("no_matches")}</p>
    <div class="content" id="content"></div>
    <div id="toast" class="toast"></div>
  `;

  mountThemeButton(document.getElementById("themeBtn"));

  const toastEl = document.getElementById("toast");
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
  }

  const contentEl = document.getElementById("content");
  // state.texts[i]: o an EKRANDA GÖRÜNEN metin (orijinal ya da çevrilmiş) — kopyala/indir/favori/arama
  // hep buradan okur, blocks[i].text her zaman orijinal kalır (geri dönebilmek için).
  const state = { texts: blocks.map((b) => b.text), lang: null };
  const highlightKey = (i) => (blocks[i].sec != null ? `sec:${blocks[i].sec}` : `i:${i}`);
  const isHighlighted = (i) => entry.highlights.some((h) => h.key === highlightKey(i));

  async function persistHighlights() {
    await chrome.storage.local.set({ [key]: entry });
  }

  async function toggleHighlight(i, starBtn) {
    const hKey = highlightKey(i);
    const idx = entry.highlights.findIndex((h) => h.key === hKey);
    if (idx === -1) {
      const b = blocks[i];
      entry.highlights.push({ key: hKey, sec: b.sec, text: state.texts[i], title: meta.title, url: meta.linkPrefix, ts: Date.now() });
      starBtn.textContent = "★";
      starBtn.classList.add("starred");
      const url = jumpUrl(meta, b.sec);
      const quote = `"${state.texts[i]}" — ${meta.title}${b.sec != null ? ` [${fmtTime(b.sec)}]` : ""}${url ? `\n${url}` : ""}`;
      let copied = true;
      try { await navigator.clipboard.writeText(quote); } catch { copied = false; }
      showToast(copied ? t("fav_added_copied") : t("fav_added"));
    } else {
      entry.highlights.splice(idx, 1);
      starBtn.textContent = "☆";
      starBtn.classList.remove("starred");
      showToast(t("fav_removed"));
    }
    await persistHighlights();
  }

  function currentFullText() {
    return blocks.map((b, i) => (b.sec != null ? `[${fmtTime(b.sec)}] ` : "") + state.texts[i]).join("\n");
  }

  blocks.forEach((b, i) => {
    const row = document.createElement("div");
    row.className = "block";
    row.dataset.text = state.texts[i].toLocaleLowerCase("tr");
    row.dataset.fav = isHighlighted(i) ? "1" : "0";

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
    textSpan.textContent = state.texts[i];
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

    const starBtn = document.createElement("button");
    starBtn.className = "star-btn" + (isHighlighted(i) ? " starred" : "");
    starBtn.title = t("fav_hint");
    starBtn.textContent = isHighlighted(i) ? "★" : "☆";
    starBtn.addEventListener("click", async () => {
      await toggleHighlight(i, starBtn);
      row.dataset.fav = isHighlighted(i) ? "1" : "0";
      if (favOnlyOn) applyFilters();
    });
    row.appendChild(starBtn);

    contentEl.appendChild(row);
  });

  // ------------------------------------------------------------ arama + favori filtresi
  const searchInput = document.getElementById("search");
  const favOnlyBtn = document.getElementById("favOnlyBtn");
  const noMatches = document.getElementById("noMatches");
  const rows = [...contentEl.querySelectorAll(".block")];
  let favOnlyOn = false;

  function applyFilters() {
    const q = searchInput.value.trim().toLocaleLowerCase("tr");
    let anyVisible = false;
    for (const row of rows) {
      const matchesSearch = !q || row.dataset.text.includes(q);
      const matchesFav = !favOnlyOn || row.dataset.fav === "1";
      const visible = matchesSearch && matchesFav;
      row.style.display = visible ? "" : "none"; // NOT `row.hidden`: .block'un kendi "display: flex" kuralı
      // (yazar stili) tarayıcının varsayılan "[hidden]{display:none}" kuralını eziyordu — gizlenen satırlar
      // aslında hiç gizlenmiyordu. Doğrudan inline style her zaman kazanır.
      if (visible) anyVisible = true;
      const textSpan = row.querySelector(".text");
      if (!q) {
        textSpan.textContent = textSpan.textContent; // vurgulamayı temizle
      } else if (visible) {
        const idx = row.dataset.text.indexOf(q);
        const raw = textSpan.textContent;
        textSpan.innerHTML = `${escapeHtml(raw.slice(0, idx))}<mark>${escapeHtml(raw.slice(idx, idx + q.length))}</mark>${escapeHtml(raw.slice(idx + q.length))}`;
      }
    }
    noMatches.hidden = (!q && !favOnlyOn) || anyVisible;
  }
  searchInput.addEventListener("input", applyFilters);
  favOnlyBtn.addEventListener("click", () => {
    favOnlyOn = !favOnlyOn;
    favOnlyBtn.classList.toggle("active", favOnlyOn);
    applyFilters();
  });

  const initialQuery = new URLSearchParams(location.search).get("q");
  if (initialQuery) {
    searchInput.value = initialQuery;
    applyFilters();
    rows.find((row) => row.style.display !== "none")?.scrollIntoView({ block: "center" });
  }

  // ------------------------------------------------------------ kopyala / indir
  document.getElementById("copyBtn").addEventListener("click", async (e) => {
    try {
      await navigator.clipboard.writeText(currentFullText());
      flashLabel(e.currentTarget, t("copied"));
    } catch { /* pano izni yoksa sessizce geç */ }
  });

  const safeName = () => (meta.title || "transcript").replace(/[\\/:*?"<>|]+/g, " ").trim();

  function downloadTxt() {
    const blob = new Blob([currentFullText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Kendi PDF üretici kütüphanesi eklemek yerine tarayıcının kendi "Yazdır → PDF olarak kaydet"
  // mekanizmasını kullanıyoruz: temiz, yazdırmaya uygun bir sayfa açıp otomatik yazdırma diyaloğunu
  // tetikliyoruz. Tamamen yerel, hiçbir kütüphane/ağ isteği gerekmiyor.
  function downloadPdf() {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(meta.title || "transcript")}</title>
<style>
  body { font: 15px/1.6 -apple-system, "Segoe UI", sans-serif; color: #1d1d1f; max-width: 700px; margin: 48px auto; padding: 0 24px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .meta { color: #6e6e73; font-size: 13px; margin-bottom: 24px; }
  .line { margin: 0 0 10px; }
  .time { color: #5b4fe0; font-variant-numeric: tabular-nums; margin-right: 6px; }
</style></head><body>
  <h1>${escapeHtml(meta.title || "")}</h1>
  <div class="meta">${escapeHtml([meta.method, meta.duration].filter(Boolean).join(" · "))}</div>
  ${blocks.map((b, i) => `<p class="line">${b.sec != null ? `<span class="time">[${fmtTime(b.sec)}]</span>` : ""}${escapeHtml(state.texts[i])}</p>`).join("\n")}
  <script>window.onload = () => window.print();<\/script>
</body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    chrome.tabs.create({ url: URL.createObjectURL(blob) });
  }

  const downloadBtn = document.getElementById("downloadBtn");
  const downloadMenu = document.getElementById("downloadMenu");
  downloadBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    downloadMenu.hidden = !downloadMenu.hidden;
  });
  document.addEventListener("click", () => { downloadMenu.hidden = true; });
  document.getElementById("downloadTxt").addEventListener("click", () => { downloadMenu.hidden = true; downloadTxt(); });
  document.getElementById("downloadPdf").addEventListener("click", () => { downloadMenu.hidden = true; downloadPdf(); });

  // ------------------------------------------------------------ çeviri (cihaz üzerinde)
  if (!canTranslate) return;

  const translateSelect = document.getElementById("translateLang");
  const translateBtn = document.getElementById("translateBtn");
  const originalBtn = document.getElementById("originalBtn");
  const statusEl = document.getElementById("translateStatus");

  const sourceLang = await detectSourceLanguage(blocks.map((b) => b.text).join(" "));
  if (!sourceLang) {
    statusEl.hidden = false;
    statusEl.textContent = t("translate_no_source");
    translateBtn.disabled = true;
    translateSelect.disabled = true;
    return;
  }
  translateSelect.innerHTML = TRANSLATE_LANGS.filter((l) => l.code !== sourceLang)
    .map((l) => `<option value="${l.code}">${escapeHtml(l.label)}</option>`).join("");

  function applyTexts(texts, lang) {
    state.texts = texts;
    state.lang = lang;
    rows.forEach((row, i) => {
      row.dataset.text = texts[i].toLocaleLowerCase("tr");
      row.querySelector(".text").textContent = texts[i];
    });
    applyFilters();
    originalBtn.hidden = lang === null;
  }

  translateBtn.addEventListener("click", async () => {
    const target = translateSelect.value;
    translateBtn.disabled = true;
    statusEl.hidden = false;

    const cached = entry.translations?.[target];
    if (cached && cached.length === blocks.length) {
      applyTexts(cached, target);
      statusEl.textContent = t("translate_done");
      translateBtn.disabled = false;
      return;
    }

    try {
      statusEl.textContent = t("translate_preparing");
      const translator = await Translator.create({
        sourceLanguage: sourceLang,
        targetLanguage: target,
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => {
            statusEl.textContent = `${t("translate_downloading")} ${Math.round(e.loaded * 100)}%`;
          });
        },
      });
      const translated = [];
      for (let i = 0; i < blocks.length; i++) {
        statusEl.textContent = `${t("translate_progress")} ${i + 1}/${blocks.length}`;
        // Tek bir cümlede çeviri motoru hata verirse (nadiren olabiliyor) tüm işlemi iptal etmek yerine
        // o cümleyi orijinal haliyle bırakıp devam ediyoruz — bir hata yüzünden saatlerce süren bir
        // çeviriyi baştan kaybetmek istemiyoruz.
        try {
          translated.push((await translator.translate(blocks[i].text)) || blocks[i].text);
        } catch {
          translated.push(blocks[i].text);
        }
      }
      applyTexts(translated, target);
      statusEl.textContent = t("translate_done");
      entry.translations = { ...(entry.translations || {}), [target]: translated };
      await chrome.storage.local.set({ [key]: entry }); // sonraki açılışta tekrar çevirmeye gerek kalmasın
    } catch (e) {
      statusEl.textContent = `${t("translate_error")} ${e.message || e}`;
    } finally {
      translateBtn.disabled = false;
    }
  });

  originalBtn.addEventListener("click", () => {
    applyTexts(blocks.map((b) => b.text), null);
    statusEl.hidden = true;
  });
}

init();
