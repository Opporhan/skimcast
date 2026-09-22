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
    <div class="search-row">
      <input id="search" type="text" placeholder="${escapeHtml(t("search_placeholder"))}">
    </div>
    <div class="action-row">
      <button id="favOnlyBtn" class="toggle-btn">${t("fav_only_btn")}</button>
      <button id="timeToggleBtn" class="toggle-btn">${t("time_toggle_btn")}</button>
      <button id="moveBtn">${t("move_to_folder_btn")}</button>
      <button id="copyBtn">${t("copy_btn")}</button>
      <button id="downloadBtn">${t("download_btn")}</button>
    </div>
    ${canTranslate ? `
    <div class="translate-bar">
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

  // includeTimestamps verilmezse ekrandaki o anki tercihi (showTimestamps) kullanır — kopyala böyle
  // çalışır; indirme modalında ayrıca açıkça seçilebiliyor.
  function currentFullText(includeTimestamps = showTimestamps) {
    return blocks.map((b, i) => (includeTimestamps && b.sec != null ? `[${fmtTime(b.sec)}] ` : "") + state.texts[i]).join("\n");
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

  // Zaman damgaları varsayılan kapalı — ekranı sade tutmak için; isteyen "🕐" ile açıp kapatabiliyor.
  // Aynı tercih kopyalarken de kullanılıyor (indirirken ayrıca, bağımsız olarak seçilebiliyor).
  let showTimestamps = false;
  const timeToggleBtn = document.getElementById("timeToggleBtn");
  timeToggleBtn.addEventListener("click", () => {
    showTimestamps = !showTimestamps;
    timeToggleBtn.classList.toggle("active", showTimestamps);
    contentEl.classList.toggle("show-times", showTimestamps);
  });

  const initialQuery = new URLSearchParams(location.search).get("q");
  if (initialQuery) {
    searchInput.value = initialQuery;
    applyFilters();
    rows.find((row) => row.style.display !== "none")?.scrollIntoView({ block: "center" });
  }

  // ------------------------------------------------------------ kopyala / indir
  const copyBtn = document.getElementById("copyBtn");
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(currentFullText());
      flashLabel(copyBtn, `✓ ${t("copied")}`);
      showToast(t("copied"));
    } catch { /* pano izni yoksa sessizce geç */ }
  });

  const safeName = () => (meta.title || "transcript").replace(/[\\/:*?"<>|]+/g, " ").trim();

  function downloadTxt(includeTimestamps) {
    const blob = new Blob([currentFullText(includeTimestamps)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Gerçek bir PDF dosyası üretip DOĞRUDAN indirir (yeni sekme/yazdırma diyaloğu açmadan) — jsPDF +
  // Türkçe karakterleri (ı ş ğ ü ö ç İ) destekleyen gömülü bir font (vendor/notosans-font.js) ile.
  // Standart PDF fontları (Helvetica vb.) Türkçe'ye özgü karakterleri içermediği için gömülü font şart.
  function downloadPdf(includeTimestamps) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.addFileToVFS("NotoSans.ttf", NOTOSANS_TTF_BASE64);
    doc.addFont("NotoSans.ttf", "NotoSans", "normal");
    doc.setFont("NotoSans");

    const margin = 48, pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
    const maxW = pageW - margin * 2;
    let y = margin;
    const addLine = (text, size, gap) => {
      doc.setFontSize(size);
      for (const line of doc.splitTextToSize(text, maxW)) {
        if (y > pageH - margin) { doc.addPage(); y = margin; }
        doc.text(line, margin, y);
        y += size * 1.35;
      }
      y += gap;
    };
    addLine(meta.title || "", 16, 6);
    doc.setTextColor(110, 110, 115);
    addLine([meta.method, meta.duration].filter(Boolean).join(" · "), 10, 14);
    doc.setTextColor(29, 29, 31);
    blocks.forEach((b, i) => {
      const prefix = includeTimestamps && b.sec != null ? `[${fmtTime(b.sec)}] ` : "";
      addLine(prefix + state.texts[i], 11, 8);
    });
    doc.save(`${safeName()}.pdf`);
  }

  function openDownloadModal() {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML = `
        <div class="modal">
          <h2>${t("download_btn")}</h2>
          <label class="checkbox-row"><input type="checkbox" id="dlTimes"${showTimestamps ? " checked" : ""}> ${t("download_include_times")}</label>
          <div class="modal-actions">
            <button id="asTxt" class="primary">${t("download_as_txt")}</button>
            <button id="asPdf" class="primary">${t("download_as_pdf")}</button>
          </div>
          <div class="modal-actions"><span class="spacer"></span><button id="dlCancel">${t("modal_cancel")}</button></div>
        </div>`;
      document.body.appendChild(overlay);
      const close = (choice) => { overlay.remove(); resolve(choice); };
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(null); });
      overlay.querySelector("#dlCancel").addEventListener("click", () => close(null));
      const withTimes = () => overlay.querySelector("#dlTimes").checked;
      overlay.querySelector("#asTxt").addEventListener("click", () => close({ format: "txt", times: withTimes() }));
      overlay.querySelector("#asPdf").addEventListener("click", () => close({ format: "pdf", times: withTimes() }));
    });
  }

  document.getElementById("downloadBtn").addEventListener("click", async () => {
    const choice = await openDownloadModal();
    if (!choice) return;
    if (choice.format === "txt") downloadTxt(choice.times);
    if (choice.format === "pdf") downloadPdf(choice.times);
  });

  // ------------------------------------------------------------ dosyaya taşı
  const FOLDERS_KEY = "skimcastFolders";
  const ARCHIVE_INDEX_KEY = "skimcastArchiveIndex";

  async function getFolders() {
    const { [FOLDERS_KEY]: folders = [] } = await chrome.storage.local.get(FOLDERS_KEY);
    return folders;
  }

  async function assignFolder(folderName) {
    entry.folder = folderName;
    await chrome.storage.local.set({ [key]: entry });
    const { [ARCHIVE_INDEX_KEY]: index = [] } = await chrome.storage.local.get(ARCHIVE_INDEX_KEY);
    await chrome.storage.local.set({
      [ARCHIVE_INDEX_KEY]: index.map((e) => (e.id === id ? { ...e, folder: folderName } : e)),
    });
  }

  function folderIconHtml(icon) {
    return icon && icon.startsWith("data:") ? `<img src="${icon}" alt="">` : escapeHtml(icon || "📁");
  }

  async function openMoveToFolderModal() {
    const folders = await getFolders();
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML = `
        <div class="modal">
          <h2>${t("move_to_folder_title")}</h2>
          <div class="folder-picker-list">
            <button class="folder-pick" data-folder="">${folderIconHtml("📂")} ${escapeHtml(t("no_folder"))}</button>
            ${folders.map((f) => `<button class="folder-pick" data-folder="${escapeHtml(f.name)}">${folderIconHtml(f.icon)} ${escapeHtml(f.name)}</button>`).join("")}
          </div>
          <div class="modal-actions">
            <input id="newFolderInline" placeholder="${escapeHtml(t("new_folder_name_placeholder"))}">
            <button id="createAndMove" class="primary">${t("modal_create")}</button>
          </div>
          <div class="modal-actions"><span class="spacer"></span><button id="moveCancel">${t("modal_cancel")}</button></div>
        </div>`;
      document.body.appendChild(overlay);
      const close = (v) => { overlay.remove(); resolve(v); };
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(null); });
      overlay.querySelector("#moveCancel").addEventListener("click", () => close(null));
      overlay.querySelectorAll(".folder-pick").forEach((btn) => {
        btn.addEventListener("click", () => close({ folder: btn.dataset.folder, isNew: false }));
      });
      const nameInput = overlay.querySelector("#newFolderInline");
      const createAndMove = () => {
        const name = nameInput.value.trim();
        if (name) close({ folder: name, isNew: true });
      };
      overlay.querySelector("#createAndMove").addEventListener("click", createAndMove);
      nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") createAndMove(); });
    });
  }

  document.getElementById("moveBtn").addEventListener("click", async () => {
    const result = await openMoveToFolderModal();
    if (!result) return;
    if (result.isNew) {
      const folders = await getFolders();
      if (!folders.some((f) => f.name === result.folder)) {
        folders.push({ name: result.folder, icon: "📁" });
        await chrome.storage.local.set({ [FOLDERS_KEY]: folders });
      }
    }
    await assignFolder(result.folder);
    showToast(result.folder ? `${t("moved_to_folder_toast")} "${result.folder}"` : t("removed_from_folder_toast"));
  });

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
