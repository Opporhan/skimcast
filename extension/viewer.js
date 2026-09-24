// skimcast (uzantı): viewer.js — background.js'in arşive kaydettiği transcript'i gösterir. Özet üretmez;
// zaman damgalı transcript'i arama, tıkla-git, olası reklam tespiti, favori/alıntı, kopyala/indir ve
// (cihaz üzerinde, ücretsiz/kotasız) çeviri katmanlarıyla sunar. Çeviri hariç hiçbir dış API'ye gitmez.

// Tırnak işaretlerini de kaçırıyor (önceki sürüm kaçırmıyordu) — video başlığı, favori metni gibi
// kullanıcı içeriği bir HTML özniteliğinin (data-id="...", title="..." gibi) içine konduğunda, metinde
// bir " geçerse önceki haliyle özniteliği erken kapatıp sayfayı bozabilirdi.
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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

// YouTube kenar panelinde (bkz. youtube_sync.js) bir iframe içinde çalışırken, video zaten aynı sayfada
// oynuyor — bir zaman damgasına tıklayınca yeni sekme açmak yerine üst pencereye (YouTube sayfasının
// kendisine) postMessage ile "şu saniyeye atla" diyoruz, o da gerçek <video> elementini oraya sarıyor.
// Bağımsız bir sekmede (embedded değilken) eskisi gibi videoyu yeni sekmede o zamandan açıyoruz.
const isEmbedded = window !== window.top;

function jumpTo(url, sec) {
  if (isEmbedded && sec != null) {
    window.parent.postMessage({ type: "skimcast-seek", sec }, "*");
    return;
  }
  chrome.tabs.create({ url, active: true });
}

// ------------------------------------------------------------ kelime kelime takip (sesli okuma + videoyla senkron)
// Bir satırın metnini tek tek kelimelere sarıp (span.word) o an "sırada" olan kelimeyi sarıyla vurgulamak
// için. Bu yapı SADECE o an aktif olan satırda geçici olarak kuruluyor — kalıcı olsaydı arama vurgusu
// (applyFilters, <mark> ile innerHTML'i değiştiriyor) ve çeviri (applyTexts, textContent'i değiştiriyor)
// ile çakışırdı. Satır aktif olmaktan çıkınca deactivateWordTracking düz metne geri döndürüyor.
function wordsHtml(text) {
  let wi = 0;
  return text.split(/(\s+)/).map((tok) => {
    if (!tok || /^\s+$/.test(tok)) return tok;
    return `<span class="word" data-widx="${wi++}">${escapeHtml(tok)}</span>`;
  }).join("");
}

function activateWordTracking(row, text) {
  const textSpan = row?.querySelector(".text");
  if (textSpan) textSpan.innerHTML = wordsHtml(text);
}

function deactivateWordTracking(row) {
  const textSpan = row?.querySelector(".text");
  if (textSpan && textSpan.querySelector(".word")) textSpan.textContent = textSpan.textContent;
}

function highlightWord(row, idx) {
  if (!row) return;
  const prev = row.querySelector(".word.word-active");
  if (prev) prev.classList.remove("word-active");
  if (idx == null || idx < 0) return;
  row.querySelectorAll(".word")[idx]?.classList.add("word-active");
}

// SpeechSynthesisUtterance'ın "boundary" olayı charIndex veriyor (metindeki karakter konumu) — hangi
// kelimeye denk geldiğini bulmak için kendi kelime bölmemizle (wordsHtml ile aynı mantık) eşliyoruz.
function wordIndexAtChar(text, charIndex) {
  if (charIndex == null) return -1;
  const tokens = text.split(/(\s+)/);
  let pos = 0, wi = 0;
  for (const tok of tokens) {
    if (!tok) continue;
    if (/^\s+$/.test(tok)) { pos += tok.length; continue; }
    if (charIndex < pos + tok.length) return wi;
    pos += tok.length;
    wi++;
  }
  return Math.max(wi - 1, 0);
}

// Butona art arda hızlı basılırsa (1.5sn içinde), önceki sürüm "orijinal" metni o an ekranda duran
// (zaten değiştirilmiş, ör. "✓ Kopyalandı") metinden okuyordu — bu yüzden buton kalıcı olarak takılı
// kalabiliyordu. Artık gerçek orijinal metni bir kere, elemente kendi verisi olarak saklıyoruz.
function flashLabel(btn, label) {
  // Düğme artık ikon+etiket olarak iki ayrı span'a bölünmüş olabilir (dar ekranda etiket gizleniyor,
  // ikon her zaman görünüyor) — varsa sadece etiketi değiştiriyoruz, ikon yerinde kalıyor.
  const target = btn.querySelector(".btn-label") || btn;
  if (target.dataset.originalLabel === undefined) target.dataset.originalLabel = target.textContent;
  target.textContent = label;
  clearTimeout(btn._flashTimer);
  btn._flashTimer = setTimeout(() => { target.textContent = target.dataset.originalLabel; }, 1500);
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

// Bloklar (transcript'in gösterim birimi) ~30-60 saniyelik, genelde birden fazla cümleden oluşan
// metinler — cihaz üzerindeki çeviri modeline TEK SEFERDE koca bir blok vermek (özellikle sayı, isim
// gibi ayrıntıları) atlamasına/yanlış söylemesine yol açabiliyor: model uzun girdilerde özetleme
// eğilimine kayabiliyor. Her CÜMLEYİ ayrı ayrı çevirip birleştirmek, modelin her seferinde küçük, tam
// bir birim üzerinde çalışmasını sağlıyor — orijinal anlama daha sadık, daha eksiksiz bir çeviri.
function splitSentences(text) {
  const parts = text.match(/[^.!?…]+[.!?…]+(?:\s+|$)|[^.!?…]+$/g);
  return parts ? parts.map((s) => s.trim()).filter(Boolean) : [text];
}

// Sayılar (özellikle iki tane yakın sayı olunca, ör. "160'tan 180'e") küçük çeviri modeli tarafından
// "dil bilgisi" gibi işlenip yuvarlanabiliyor/atlanabiliyor — bir sayı gerçek bir kelime değil, OLDUĞU
// GİBİ kalması gereken bir değer. Çevirmeden önce her sayıyı, modelin "çeviri" diye bir şey yapmayacağı
// düz bir yer tutucuyla (⟦0⟧, ⟦1⟧…) değiştirip, çeviri bittikten sonra ORİJİNAL sayı metnini (birebir,
// biçimlendirmesi/ondalığı bozulmadan) geri koyuyoruz — model hiç "görmediği" için değiştiremiyor/atlayamıyor.
function protectNumbers(text) {
  const numbers = [];
  const protectedText = text.replace(/\d[\d.,]*\d|\d/g, (m) => {
    numbers.push(m);
    return `⟦${numbers.length - 1}⟧`;
  });
  return { protectedText, numbers };
}
function restoreNumbers(text, numbers) {
  return text.replace(/⟦(\d+)⟧/g, (m, idx) => numbers[Number(idx)] ?? m);
}

// "Birebir tam çeviri" için kaba ama işe yarar bir kalite kapısı: çıktı, kaynağa göre KELİME SAYISI
// olarak çok kısaysa (%40'ın altı), model muhtemelen bir şeyleri atlayıp özetlemiş demektir. Çok kısa
// cümlelerde (2 kelime ve altı) bu oran güvenilir değil, kontrol etmiyoruz.
function isSuspiciouslyShort(sourceText, translatedText) {
  const srcWords = sourceText.split(/\s+/).filter(Boolean).length;
  if (srcWords <= 2) return false;
  const outWords = translatedText.split(/\s+/).filter(Boolean).length;
  return outWords < srcWords * 0.4;
}

// Sadece dili DEĞİL, tespit edilemediyse SEBEBİNİ de döndürüyor — "bu videonun dili tespit edilemedi"
// (içerikle ilgili, tek seferlik bir sorun) ile "bu cihaz/tarayıcı özelliği hiç desteklemiyor" (kalıcı,
// hiçbir videoda çalışmayacak) birbirinden çok farklı şeyler; kullanıcıya ikisini de aynı belirsiz
// mesajla göstermek kafa karıştırıyordu. "unsupported" → Translator de aynı altyapıyı (Gemini Nano)
// kullandığı için o da çalışmayacak demektir, ikisi için TEK bir net mesaj gösteriyoruz.
async function detectSourceLanguage(sampleText) {
  if (typeof LanguageDetector === "undefined") return { lang: null, reason: "no-api" };
  try {
    if ((await LanguageDetector.availability()) === "unavailable") return { lang: null, reason: "unsupported" };
    const detector = await LanguageDetector.create();
    const [top] = await detector.detect(sampleText.slice(0, 800));
    const lang = top && top.detectedLanguage !== "und" && top.confidence > 0.4 ? top.detectedLanguage : null;
    return { lang, reason: lang ? "ok" : "low-confidence" };
  } catch {
    return { lang: null, reason: "error" };
  }
}

// Cihaz üzerindeki çeviri motoru bazı girdilerde "<b9000></b900>" ya da ">> >>" gibi anlamsız, kendi
// iç işaretleyicilerini sızdırabiliyor (bilinen bir model tuhaflığı, hangi dilden hangi dile olursa
// olsun görülebiliyor). Bunları temizliyoruz; temizlik sonrası metin boş kalırsa (tamamen sızıntıdan
// ibaretse) orijinal metne düşüyoruz — hiçbir zaman bozuk/anlamsız bir çıktı gösterilmiyor.
// Önceki regex ("<b9000>", "</b900>" gibi harf+rakam etiket sanıp) sadece belirli bir kalıba uyan
// sızıntıları yakalıyordu — kullanıcı "< / b9000>" gibi ARADA BOŞLUK olan bir varyant bildirdi, o hiç
// eşleşmiyordu. Artık kalıp aramıyoruz: köşeli parantez içinde NE OLURSA OLSUN (boşluklu, rakamlı,
// harfli, karışık) hepsini atıyoruz — bu motorun kendi iç işaretleyicileri konuşulan dilde asla
// görünmeyecek bir şey, o yüzden agresif olmak güvenli. Hangi dile çevrilirse çevrilsin aynı şekilde çalışır.
// Çeviri mantığını (cümle cümle bölme, sayı koruma, sızıntı temizliği) her iyileştirdiğimizde bu sayıyı
// artırıyoruz — entry.translations önbelleği, hangi sürümle üretildiği bu numarayla eşleşmiyorsa
// (translateBtn dinleyicisine bkz.) geçersiz sayılıp otomatik yeniden çevriliyor. Bunsuz, önceden bir
// kere çevrilmiş bir video hep eski (düzeltmeden önceki) çeviriyi göstermeye devam ederdi.
const TRANSLATION_CACHE_VERSION = 4;
const LEAKED_TAG_RE = /<[^<>]*>/g;
function cleanTranslation(text, fallback) {
  if (!text) return fallback;
  let cleaned = text.replace(LEAKED_TAG_RE, "");
  // Eşleşmeyen tek "<" ya da ">" karakterlerinden ibaret parçalar da (kaç tane/boşluklu olursa olsun)
  // gerçek sızıntı — kelime kelime ayırıp tamamen bu karakterlerden oluşan token'ları atıyoruz.
  cleaned = cleaned.split(/\s+/).filter((tok) => tok && !/^[<>]+$/.test(tok)).join(" ").trim();
  return cleaned || fallback;
}

async function init() {
  await initLang();
  const app = document.getElementById("app");
  const id = new URLSearchParams(location.search).get("id");
  if (!id) { app.innerHTML = `<p class="error">${t("error_no_result")}</p>`; return; }
  const key = `skimcastArchive:${id}`;

  const entry = (await chrome.storage.local.get(key))[key];
  if (!entry) { app.innerHTML = `<p class="error">${t("error_result_not_found")}</p>`; return; }

  const { meta, blocks } = entry;
  entry.highlights = entry.highlights || []; // {sec, text, ts}[] — favorilenen anlar
  document.title = meta.title || "skimcast";
  // Başlık zaten yukarıdaki h1'de var — burada tekrarlamıyoruz, yöntemi ("youtube-altyazı (en, otomatik)"
  // gibi) de göstermiyoruz çünkü kullanıcıya bir anlam ifade etmiyor. Sadece video/podcast süresi kalıyor.
  // meta.duration bazı kaynaklarda (podcast RSS, web sayfası) hep boş/0 geliyor — o durumda transcript'in
  // son zaman damgasından yaklaşık süreyi kendimiz hesaplıyoruz, tamamen boş kalmasın.
  const lastSec = [...blocks].reverse().find((b) => b.sec != null)?.sec;
  const metaLine = meta.duration || (lastSec != null ? fmtTime(lastSec) : "");
  const canTranslate = typeof Translator !== "undefined";
  const canSpeak = typeof speechSynthesis !== "undefined";
  const ytVideoId = id.startsWith("yt:") ? id.slice(3) : null; // "🔗 Videoyla Eşitle" sadece YouTube'da anlamlı

  app.innerHTML = `
    <header>
      <div class="header-top">
        <a class="back" href="library.html"${isEmbedded ? ' target="_blank"' : ""}>${t("library_link")}</a>
        <div class="header-btns">
          <button id="langBtn" class="theme-btn" title="Language"></button>
          <button id="themeBtn" class="theme-btn" title="${escapeHtml(t("theme_btn"))}"></button>
        </div>
      </div>
      <h1>${escapeHtml(meta.title || t("popup_title"))}</h1>
      <div class="meta">${escapeHtml(metaLine)}</div>
    </header>
    ${meta.chapters?.length ? `
    <div class="chapters-row" id="chaptersRow">
      ${meta.chapters.map((c) => `<button class="chapter-chip" data-sec="${c.sec}">${escapeHtml(fmtTime(c.sec))} · ${escapeHtml(c.title)}</button>`).join("")}
    </div>` : ""}
    <div class="search-row">
      <input id="search" type="text" placeholder="${escapeHtml(t("search_placeholder"))}">
    </div>
    <div class="action-row">
      <button id="favOnlyBtn" class="toggle-btn" title="${escapeHtml(t("fav_only_btn"))}"><span class="btn-icon star-ico">☆</span><span class="btn-label">${t("fav_only_btn")}</span></button>
      <button id="timeToggleBtn" class="toggle-btn" title="${escapeHtml(t("time_toggle_btn"))}"><span class="btn-icon">🕐</span><span class="btn-label">${t("time_toggle_btn")}</span></button>
      <button id="moveBtn" title="${escapeHtml(t("move_to_folder_btn"))}"><span class="btn-icon">📁</span><span class="btn-label">${t("move_to_folder_btn")}</span></button>
      <button id="noteBtn" class="toggle-btn" title="${escapeHtml(t("video_note_hint"))}"><span class="btn-icon">📝</span><span class="btn-label">${t("video_note_btn")}</span></button>
      ${ytVideoId ? `<button id="syncBtn" class="toggle-btn" title="${escapeHtml(t("sync_hint"))}"><span class="btn-icon">🔗</span><span class="btn-label">${t("sync_btn")}</span></button>` : ""}
      <span class="toolbar-divider"></span>
      <button id="copyBtn" title="${escapeHtml(t("copy_btn"))}"><span class="btn-icon">📋</span><span class="btn-label">${t("copy_btn")}</span></button>
      <button id="downloadBtn" title="${escapeHtml(t("download_btn"))}"><span class="btn-icon">⬇️</span><span class="btn-label">${t("download_btn")}</span></button>
    </div>
    <div id="videoNoteBox" class="video-note-box" hidden>
      <textarea id="videoNoteText" class="video-note" placeholder="${escapeHtml(t("video_note_placeholder"))}"></textarea>
    </div>
    <div class="toolbar-section">
      <div class="toolbar-label">${t("section_translate")}</div>
      ${canTranslate ? `
      <div class="translate-bar">
        <select id="translateLang"></select>
        <button id="translateBtn">${t("translate_btn")}</button>
        <button id="originalBtn" hidden>${t("translate_original_btn")}</button>
        <span id="translateStatus" class="hint" hidden></span>
      </div>` : `<p class="hint">${t("translate_unsupported_device")}</p>`}
    </div>
    ${canSpeak ? `
    <div class="toolbar-section">
      <div class="toolbar-label">${t("section_tts")}</div>
      <div class="translate-bar">
        <button id="ttsBtn">🔊 ${t("tts_btn")}</button>
        <select id="ttsVoice"></select>
        <select id="ttsRate">
          <option value="1">1x</option>
          <option value="1.25">1.25x</option>
          <option value="1.5" selected>1.5x</option>
          <option value="2">2x</option>
          <option value="2.5">2.5x</option>
        </select>
        <button id="ttsStopBtn" hidden>⏹ ${t("tts_stop_btn")}</button>
      </div>
    </div>` : ""}
    <p id="noMatches" class="hint" hidden>${t("no_matches")}</p>
    <div class="content" id="content"></div>
    <div id="toast" class="toast"></div>
  `;

  mountThemeButton(document.getElementById("themeBtn"));
  mountLangButton(document.getElementById("langBtn"));

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
  // "Yıldızlı" olmak ile "bir klasöre kayıtlı" olmak birbirinden bağımsız — e-postada yıldızlamak ile
  // bir etikete koymak nasıl ayrıysa, burada da öyle. h.starred===false olsa bile kayıt (ve klasörü)
  // duruyor; sadece "starred !== false" (eski kayıtlarda alan hiç yoksa da true sayılır) yıldızlı sayılır.
  const isHighlighted = (i) => entry.highlights.some((h) => h.key === highlightKey(i) && h.starred !== false);

  async function persistHighlights() {
    await chrome.storage.local.set({ [key]: entry });
  }

  // Bu videoya/bölüme dair genel bir not — tek bir favori/satırla değil, videonun tamamıyla ilgili
  // ("özet", "sonra tekrar bak" gibi kişisel notlar). ÜÇ AYRI not kavramı (video notu / favori notu /
  // serbest not) kafa karıştırıyordu — artık HEPSİ aynı paylaşılan depoda (skimcastNotes, Notlarım
  // sekmesinde görünen liste): bu, o depodaki "videoId'si bu videoya eşit, satıra bağlı olmayan
  // (sourceKey yok)" tek kaydı okuyup/yazıyor. Yani burada yazdığın şey zaten Notlarım'da — ayrıca
  // "taşımana" gerek yok.
  const NOTES_KEY = "skimcastNotes";
  async function getNotes() {
    const { [NOTES_KEY]: notes = [] } = await chrome.storage.local.get(NOTES_KEY);
    return notes;
  }
  async function saveNotes(notes) {
    await chrome.storage.local.set({ [NOTES_KEY]: notes });
  }
  function newNoteId() {
    return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  const noteBtn = document.getElementById("noteBtn");
  const videoNoteBox = document.getElementById("videoNoteBox");
  const videoNoteText = document.getElementById("videoNoteText");

  // Geriye dönük uyumluluk: bu özelliğin daha önceki bir sürümünde not entry.videoNote'ta saklanıyordu.
  // Hiç eşleşen paylaşılan not yoksa ama entry.videoNote doluysa, veri kaybı olmasın diye onu kullan —
  // ilk kayıtta (aşağıdaki input dinleyicisi) zaten düzgün yere (skimcastNotes) taşınmış olacak.
  const existingVideoNote = (await getNotes()).find((n) => n.videoId === id && !n.sourceKey);
  videoNoteText.value = existingVideoNote?.body ?? entry.videoNote ?? "";
  noteBtn.classList.toggle("active", !!videoNoteText.value.trim());

  noteBtn.addEventListener("click", () => {
    videoNoteBox.hidden = !videoNoteBox.hidden;
    if (!videoNoteBox.hidden) videoNoteText.focus();
  });
  let noteSaveTimer = null;
  videoNoteText.addEventListener("input", () => {
    clearTimeout(noteSaveTimer);
    noteSaveTimer = setTimeout(async () => {
      const body = videoNoteText.value.trim();
      const notes = await getNotes();
      const existing = notes.find((n) => n.videoId === id && !n.sourceKey);
      if (body) {
        if (existing) {
          await saveNotes(notes.map((n) => (n === existing
            ? { ...n, body, title: meta.title || n.title, sourceUrl: entry.url, sourceTitle: meta.title || "" }
            : n)));
        } else {
          notes.unshift({
            id: newNoteId(), title: meta.title || "", body, folder: "", ts: Date.now(),
            videoId: id, sourceUrl: entry.url, sourceTitle: meta.title || "",
          });
          await saveNotes(notes);
        }
      } else if (existing) {
        await saveNotes(notes.filter((n) => n !== existing));
      }
      if (entry.videoNote) { entry.videoNote = undefined; await persistHighlights(); } // eski alanı temizle
      noteBtn.classList.toggle("active", !!body);
    }, 500);
  });

  async function toggleHighlight(i, starBtn) {
    const hKey = highlightKey(i);
    const existing = entry.highlights.find((h) => h.key === hKey);
    if (!existing || existing.starred === false) {
      const b = blocks[i];
      if (existing) {
        existing.starred = true; // daha önce dosyaya taşınıp yıldızı kaldırılmıştı, tekrar yıldızlanıyor
      } else {
        entry.highlights.push({ key: hKey, sec: b.sec, text: state.texts[i], title: meta.title, url: meta.linkPrefix, starred: true, ts: Date.now() });
      }
      starBtn.textContent = "★";
      starBtn.classList.add("starred");
      const url = jumpUrl(meta, b.sec);
      const quote = `"${state.texts[i]}" — ${meta.title}${b.sec != null ? ` [${fmtTime(b.sec)}]` : ""}${url ? `\n${url}` : ""}`;
      let copied = true;
      try { await navigator.clipboard.writeText(quote); } catch { copied = false; }
      showToast(copied ? t("fav_added_copied") : t("fav_added"));
    } else if (existing.folder) {
      // Bir klasöre kayıtlı — yıldızı kaldırmak onu klasörden SİLMEZ, sadece "yıldızlı" işaretini kaldırır.
      // Tamamen silmek için kütüphanedeki "Kaldır" kullanılıyor.
      existing.starred = false;
      starBtn.textContent = "☆";
      starBtn.classList.remove("starred");
      showToast(t("fav_unstarred_kept"));
    } else {
      entry.highlights = entry.highlights.filter((h) => h.key !== hKey);
      starBtn.textContent = "☆";
      starBtn.classList.remove("starred");
      showToast(t("fav_removed"));
    }
    await persistHighlights();
  }

  // Bir satırı bir klasöre atar — yıldızlanmış olması ŞART DEĞİL: yıldızlama hızlı "beğendim + kopyala"
  // içindir, dosyaya koymak ayrı, bilinçli bir organizasyon kararı. Kayıt yoksa burada oluşturuluyor
  // (starred:false ile — sadece dosyalanmış, favori değil). FOLDERS_KEY/getFolders/openMoveToFolderModal
  // aşağıda tanımlı (fonksiyon bildirimleri hoisted, burada tanımdan önce çağırmak sorun değil).
  // Yazma sonrası depodan TEKRAR OKUYUP doğruluyoruz — "taşındı" demek için gerçekten kaydedilmiş
  // olması gerekiyor, aksi halde sessizce yanlış bir onay vermiş oluruz.
  async function assignHighlightFolder(i, folderName) {
    const hKey = highlightKey(i);
    let h = entry.highlights.find((x) => x.key === hKey);
    if (h) {
      h.folder = folderName;
    } else {
      const b = blocks[i];
      entry.highlights.push({ key: hKey, sec: b.sec, text: state.texts[i], title: meta.title, url: meta.linkPrefix, starred: false, folder: folderName, ts: Date.now() });
    }
    await persistHighlights();
    const { [key]: saved } = await chrome.storage.local.get(key);
    return saved?.highlights?.find((x) => x.key === hKey)?.folder === folderName;
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
      if (url) time.addEventListener("click", () => jumpTo(url, b.sec));
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
      const skipSec = next ? next.sec : b.sec;
      const skipUrl = jumpUrl(meta, skipSec);
      if (skipUrl) {
        const skip = document.createElement("button");
        skip.className = "ad-skip";
        skip.textContent = t("ad_skip");
        skip.addEventListener("click", () => jumpTo(skipUrl, skipSec));
        row.appendChild(skip);
      }
    }

    // Favoriyi kendi klasörüne taşıma — sadece yıldızlandıktan sonra anlamlı, o yüzden başta gizli.
    // Şu an hangi klasörde olduğu düğmenin üzerinde görünüyor (📁 Genel / 📁 Klasör adı) — taşımanın
    // gerçekten işe yarayıp yaramadığını başka bir sayfaya gitmeden burada görebilesin diye.
    const folderBtn = document.createElement("button");
    folderBtn.className = "star-folder-btn";
    const setFolderLabel = (name) => { folderBtn.textContent = name ? `📁 ${name}` : "📁"; };
    const currentHighlight = () => entry.highlights.find((h) => h.key === highlightKey(i));
    setFolderLabel(currentHighlight()?.folder);
    folderBtn.title = t("move_to_folder_title");
    // Artık yıldızlanmış olması ŞART DEĞİL — her satırda görünüyor, doğrudan (yıldızlamadan) bir
    // klasöre koyabilirsin. Yıldızlama ayrı, hızlı bir "beğendim + kopyala" eylemi olarak kalıyor.
    folderBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const result = await openMoveToFolderModal();
      if (!result) return;
      if (result.isNew) {
        const existing = await getFolders();
        if (!existing.some((f) => f.name === result.folder)) {
          existing.push({ name: result.folder, icon: "📁" });
          await chrome.storage.local.set({ [FOLDERS_KEY]: existing });
        }
      }
      const ok = await assignHighlightFolder(i, result.folder);
      if (ok) {
        setFolderLabel(result.folder);
        showToast(result.folder ? `${t("moved_to_folder_toast")} "${result.folder}"` : t("removed_from_folder_toast"));
      } else {
        showToast(t("move_failed_toast"));
      }
    });

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
    row.appendChild(folderBtn);

    contentEl.appendChild(row);
  });

  // ------------------------------------------------------------ arama + favori filtresi
  const searchInput = document.getElementById("search");
  const favOnlyBtn = document.getElementById("favOnlyBtn");
  const noMatches = document.getElementById("noMatches");
  const rows = [...contentEl.querySelectorAll(".block")];
  let favOnlyOn = false;

  // Bölümler (chapters): her çip, o bölümün başladığı zamana en yakın (>=) transcript satırına kaydırır.
  document.querySelectorAll(".chapter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const sec = Number(chip.dataset.sec);
      const idx = blocks.findIndex((b) => b.sec != null && b.sec >= sec);
      (idx === -1 ? rows[rows.length - 1] : rows[idx])?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // ------------------------------------------------------------ videoyla senkron takip (follow-along)
  // youtube_sync.js YouTube sekmesinden oynatma zamanını background.js'e bildiriyor, o da eşleşen
  // (videoId'si aynı olan) görüntüleyici sekmesine iletiyor. Burada sadece dinleyip o ana kadar
  // konuşulmuş SON bloğu vurguluyor/kaydırıyoruz — gerçek videoyu izlerken transcript kendiliğinden takip
  // ediyor. Kayıt (register) YouTube sekmesi açıkken bile sadece kullanıcı açıkça 🔗'yi açtığında olur —
  // varsayılan kapalı, sürpriz kaydırma/otomatik davranış istemiyoruz.
  if (ytVideoId) {
    const syncBtn = document.getElementById("syncBtn");
    let syncOn = false;
    let lastSyncIdx = -1;

    function clearSyncHighlight() {
      if (lastSyncIdx !== -1 && rows[lastSyncIdx]) {
        rows[lastSyncIdx].classList.remove("synced");
        deactivateWordTracking(rows[lastSyncIdx]);
      }
      lastSyncIdx = -1;
    }

    function onTimeSync(currentTime) {
      if (!syncOn) return;
      let idx = -1;
      for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].sec != null && blocks[i].sec <= currentTime) idx = i; else break;
      }
      if (idx === -1) return;
      if (idx !== lastSyncIdx) {
        clearSyncHighlight();
        lastSyncIdx = idx;
        rows[idx].classList.add("synced");
        activateWordTracking(rows[idx], state.texts[idx]);
        rows[idx].scrollIntoView({ behavior: "smooth", block: "center" });
      }
      // Kelime kelime takip. Bu blok sunucudan (YouTube, bkz. server/main.py) geldiyse blocks[idx].words var — bloğu
      // oluşturan HAM, ince taneli altyazı parçalarının (her biri kendi GERÇEK başlama saniyesiyle) listesi.
      // O an hangi parçanın okunduğunu TAM olarak buluyoruz (araya müzik/sessizlik girse bile yanlış yere
      // atlamıyor — o parçanın son kelimesinde bekliyor).
      //
      // Çeviri gösterilirken (İngilizce video, Türkçe okuyorsun gibi) ekrandaki kelimeler ARTIK orijinal
      // parçalarla birebir eşleşmiyor (çeviri kelimeleri yeniden sıralayıp birleştirebiliyor) — bu yüzden
      // çevrilmiş metni parçaların kelime SAYISI ORANINA göre aynı sayıda gruba bölüyoruz (parça 1 kaynak
      // metnin %20'siyse, çevrilmiş metnin de ~%20'sini kapsıyor) ve o grup içinde ilerliyoruz. Birebir
      // kelime hizalaması değil ama dil ne olursa olsun ORİJİNAL sesin GERÇEK zamanlamasına göre akıyor —
      // önceki sürümde çeviri, orijinalin gerisinde kalıyordu çünkü tüm bloğa (30-60sn) kaba bir tahminle
      // yayılıyordu; artık her dilde aynı, çok daha dar (~2-5sn) aralıkta takip ediyor.
      const rawWords = blocks[idx].words;
      if (rawWords?.length) {
        let wIdx = -1;
        for (let i = 0; i < rawWords.length; i++) {
          if (rawWords[i].sec <= currentTime) wIdx = i; else break;
        }
        if (wIdx !== -1) {
          const cue = rawWords[wIdx];
          const nextCueSec = rawWords[wIdx + 1]?.sec;
          const cueDur = nextCueSec != null ? Math.max(nextCueSec - cue.sec, 0.5) : 2;
          const withinProgress = Math.min(Math.max((currentTime - cue.sec) / cueDur, 0), 1);

          const displayWordCount = state.texts[idx].split(/\s+/).filter(Boolean).length;
          const cueWordCounts = rawWords.map((c) => c.text.split(/\s+/).filter(Boolean).length);
          const totalSourceWords = cueWordCounts.reduce((a, b) => a + b, 0) || 1;
          const sourceWordsBefore = cueWordCounts.slice(0, wIdx).reduce((a, b) => a + b, 0);
          const startDisplayIdx = Math.round((sourceWordsBefore / totalSourceWords) * displayWordCount);
          const endDisplayIdx = Math.round(((sourceWordsBefore + cueWordCounts[wIdx]) / totalSourceWords) * displayWordCount);
          const groupLen = Math.max(endDisplayIdx - startDisplayIdx, 1);
          const withinIdx = Math.min(Math.floor(withinProgress * groupLen), groupLen - 1);
          highlightWord(rows[idx], startDisplayIdx + withinIdx);
        }
        return;
      }
      const text = state.texts[idx];
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      if (wordCount > 0) {
        const blockStart = blocks[idx].sec;
        const nextStart = blocks.slice(idx + 1).find((b) => b.sec != null)?.sec;
        const blockDur = nextStart != null ? Math.max(nextStart - blockStart, 1) : 8;
        const progress = Math.min(Math.max((currentTime - blockStart) / blockDur, 0), 1);
        highlightWord(rows[idx], Math.min(Math.floor(progress * wordCount), wordCount - 1));
      }
    }

    // "Sessizce çalışmıyor" durumunu fark edilir kılmak için: 🔗'yi açtıktan sonra birkaç saniye içinde
    // hiç zaman güncellemesi gelmezse (en sık sebep: YouTube sekmesi, içerik betiği eklenmeden ÖNCE zaten
    // açıktı — uzantı yeniden yüklense bile açık sekmelere yeni içerik betiği enjekte edilmiyor) kullanıcıya
    // ne yapması gerektiğini söylüyoruz, sessizce "hiçbir şey olmuyormuş" hissi bırakmıyoruz.
    let syncWatchdog = null;
    function armSyncWatchdog() {
      clearTimeout(syncWatchdog);
      syncWatchdog = setTimeout(() => { if (syncOn) showToast(t("sync_no_signal_toast")); }, 4000);
    }

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "skimcast-time-sync") {
        clearTimeout(syncWatchdog);
        onTimeSync(msg.currentTime);
      }
    });

    syncBtn.addEventListener("click", () => {
      syncOn = !syncOn;
      syncBtn.classList.toggle("active", syncOn);
      if (syncOn) {
        chrome.runtime.sendMessage({ type: "skimcast-register-viewer", videoId: ytVideoId }).catch(() => {});
        armSyncWatchdog();
      } else {
        clearSyncHighlight();
        clearTimeout(syncWatchdog);
        chrome.runtime.sendMessage({ type: "skimcast-register-viewer", videoId: null }).catch(() => {});
      }
    });

    window.addEventListener("beforeunload", () => {
      if (syncOn) chrome.runtime.sendMessage({ type: "skimcast-register-viewer", videoId: null }).catch(() => {});
    });

    // YouTube kenar panelinde (iframe içinde) açıkken senkron takibin zaten AMACI bu — elle "🔗"ye
    // basmaya gerek yok, video zaten hemen yanında oynuyor.
    if (isEmbedded) syncBtn.click();
  }

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
    favOnlyBtn.querySelector(".star-ico").textContent = favOnlyOn ? "★" : "☆";
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

  // ------------------------------------------------------------ kaldığın yerden devam et
  // Arama sorgusuyla açılmadıysan, en son nereye kadar okuduğunu hatırlayıp oraya kaydırıyoruz —
  // kütüphanedeki "Devam Et" rozetiyle AYNI veriyi (entry.lastReadIndex) kullanıyor. Kaydırma
  // pozisyonunu periyodik (debounce'lu) kaydediyoruz; en baştaysan ya da sona geldiysen "devam etmenin"
  // bir anlamı yok, ilerlemeyi o durumda temizliyoruz. Kütüphanenin (her videoyu tek tek açmadan "devam
  // et" gösterebilmesi için) hafif dizinine (skimcastArchiveIndex) da bir yüzde aynası bırakıyoruz.
  if (!initialQuery && entry.lastReadIndex != null && rows[entry.lastReadIndex]) {
    rows[entry.lastReadIndex].scrollIntoView({ block: "center" });
    showToast(t("resume_toast"));
  }

  function currentTopRowIndex() {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].style.display === "none") continue;
      if (rows[i].getBoundingClientRect().bottom > 80) return i;
    }
    return rows.length - 1;
  }

  let progressSaveTimer = null;
  window.addEventListener("scroll", () => {
    clearTimeout(progressSaveTimer);
    progressSaveTimer = setTimeout(async () => {
      const idx = currentTopRowIndex();
      const meaningful = idx > 0 && idx < rows.length - 2;
      entry.lastReadIndex = meaningful ? idx : undefined;
      entry.lastReadTs = meaningful ? Date.now() : undefined;
      await persistHighlights();
      const progressPercent = meaningful ? Math.round((idx / (rows.length - 1)) * 100) : undefined;
      const { skimcastArchiveIndex: idxList = [] } = await chrome.storage.local.get("skimcastArchiveIndex");
      await chrome.storage.local.set({
        skimcastArchiveIndex: idxList.map((e) => (e.id === id ? { ...e, progressPercent } : e)),
      });
    }, 1200);
  }, { passive: true });

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

  // Kaynak dili hem çeviri hem sesli okuma kullanıyor — burada bir kere tespit edip ikisine de
  // veriyoruz. Sesli okuma bunu almadan önce hep İngilizce/varsayılan sesle okumaya çalışıyordu
  // (Türkçe metni yanlış telaffuzla), çünkü dil hiç belirtilmiyordu.
  const sourceLangResult = (canSpeak || canTranslate)
    ? await detectSourceLanguage(blocks.map((b) => b.text).join(" ")) : { lang: null, reason: "no-api" };
  const sourceLang = sourceLangResult.lang;

  // ------------------------------------------------------------ sesli okuma (cihaz üzerinde, Web Speech API)
  // Videoyu hiç açmadan, sadece dinleyerek "tüketmek" için — ekrandaki hangi metin görünüyorsa (orijinal
  // ya da çevrilmiş) onu okuyor. Tamamen tarayıcı içinde, API anahtarı/ağ isteği yok.
  let refreshTtsVoices = null; // çeviri dili değişince (applyTexts) ses listesini tazelemek için
  if (canSpeak) {
    const ttsBtn = document.getElementById("ttsBtn");
    const ttsVoiceSelect = document.getElementById("ttsVoice");
    const ttsRateSelect = document.getElementById("ttsRate");
    const ttsStopBtn = document.getElementById("ttsStopBtn");
    let ttsState = "idle"; // idle | playing | paused
    let ttsVoices = [];
    const TTS_VOICE_KEY_PREFIX = "skimcastTtsVoice:";

    // getVoices() ilk çağrıda genelde boş dizi döndürüyor, ses listesi asenkron yükleniyor.
    function getVoicesAsync() {
      return new Promise((resolve) => {
        const existing = speechSynthesis.getVoices();
        if (existing.length) { resolve(existing); return; }
        speechSynthesis.addEventListener("voiceschanged", () => resolve(speechSynthesis.getVoices()), { once: true });
        setTimeout(() => resolve(speechSynthesis.getVoices()), 500); // bazı tarayıcılarda olay hiç gelmiyor
      });
    }

    // macOS'un "eğlenceli" (novelty) sesleri — kasıtlı olarak tuhaf/hasta/robotik seslendirmek için
    // tasarlanmış (ör. Albert resmi olarak "boğuk/hasta sesli" diye belgeleniyor). Bir transcript'i
    // ciddi ciddi okumak için hiç uygun değiller, tamamen listeden çıkarıyoruz. (Araştırılıp doğrulandı.)
    const NOVELTY_VOICE_NAMES = [
      "Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Deranged",
      "Good News", "Hysterical", "Pipe Organ", "Organ", "Trinoids", "Whisper", "Zarvox",
      "Jester", "Junior", "Wobble", "Superstar", "Rocko", "Sandy", "Shelley",
      "Eddy", "Flo", "Grandma", "Grandpa", "Fred", "Ralph",
      // macOS, işletim sistemi dili Türkçeyse bu şaka sesleri Türkçe isimle geliyor:
      "İyi Haber", "Kötü Haber", "Org",
    ];
    function isNoveltyVoice(v) {
      return NOVELTY_VOICE_NAMES.some((n) => v.name === n || v.name.startsWith(n + " "));
    }

    function voicesForLang(langCode) {
      const base = langCode ? langCode.split("-")[0].toLowerCase() : null;
      return ttsVoices.filter((v) => (!base || v.lang.toLowerCase().startsWith(base)) && !isNoveltyVoice(v));
    }

    // Kaliteli (nöral/"Natural") sesleri öne alıyoruz — tarayıcının kendi varsayılan sıralaması genelde
    // en eski/en robotik sesi ilk sıraya koyuyor, "kötü ve korkunç" hissi büyük ölçüde buradan geliyordu.
    function sortVoicesByQuality(voices) {
      const score = (v) => (/natural|neural|premium/i.test(v.name) ? 0 : 1);
      return [...voices].sort((a, b) => score(a) - score(b));
    }

    async function populateTtsVoices() {
      const lang = state.lang || sourceLang;
      const langVoices = sortVoicesByQuality(voicesForLang(lang));
      if (!langVoices.length) {
        ttsVoiceSelect.innerHTML = `<option value="">${escapeHtml(t("tts_no_voice"))}</option>`;
        ttsVoiceSelect.disabled = true;
        return;
      }
      ttsVoiceSelect.disabled = false;
      // "Microsoft "/"Google " öneki tekrar ediyor, kısaltıp gerçek ses adını (genelde bir kişi adı,
      // dolayısıyla kadın/erkek ayrımı da bundan anlaşılıyor) öne çıkarıyoruz. 🌐 = çevrimiçi (nöral) ses.
      ttsVoiceSelect.innerHTML = langVoices.map((v) => {
        const label = v.name.replace(/^(Microsoft|Google)\s+/, "").replace(/\s+Online \(Natural\).*$/, "");
        return `<option value="${escapeHtml(v.name)}">${v.localService === false ? "🌐 " : ""}${escapeHtml(label)}</option>`;
      }).join("");
      const voiceKey = TTS_VOICE_KEY_PREFIX + lang;
      const { [voiceKey]: saved } = await chrome.storage.local.get(voiceKey);
      if (saved && langVoices.some((v) => v.name === saved)) ttsVoiceSelect.value = saved;
    }
    refreshTtsVoices = populateTtsVoices;

    ttsVoiceSelect.addEventListener("change", () => {
      const lang = state.lang || sourceLang;
      chrome.storage.local.set({ [TTS_VOICE_KEY_PREFIX + lang]: ttsVoiceSelect.value });
    });

    let currentReadingIndex = -1;

    function ttsUpdateBtn() {
      ttsBtn.textContent = ttsState === "playing" ? `⏸ ${t("tts_pause_btn")}`
        : ttsState === "paused" ? `▶ ${t("tts_resume_btn")}` : `🔊 ${t("tts_btn")}`;
      ttsStopBtn.hidden = ttsState === "idle";
    }

    // Her satırın "▶"sı, o an okunmakta olan satırdayken "⏹"e dönüşüyor — okurken durdurmak için
    // toolbar'a geri dönmeye gerek kalmıyor, tam okuduğun yerden durdurabiliyorsun.
    function updateRowButtons() {
      rows.forEach((row, i) => {
        const btn = row.querySelector(".tts-play-from");
        if (!btn) return;
        const isActive = ttsState !== "idle" && i === currentReadingIndex;
        btn.textContent = isActive ? "⏹" : "▶";
        btn.title = isActive ? t("tts_stop_btn") : t("tts_play_from_hint");
      });
    }

    function ttsSpeakFrom(index) {
      if (index >= blocks.length) { ttsStop(); return; }
      const text = state.texts[index];
      if (!text.trim()) { ttsSpeakFrom(index + 1); return; } // boş satırı atla
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = parseFloat(ttsRateSelect.value);
      // Ekranda o an görünen dile göre ses seçiliyor: çevrilmişse hedef dil, değilse tespit edilen
      // kaynak dil. Seçtiğin ses varsa (ttsVoiceSelect) doğrudan onu kullanıyoruz — sadece lang
      // belirtmek tarayıcının rastgele/düşük kaliteli bir sesi seçmesine yol açabiliyordu.
      const lang = state.lang || sourceLang;
      if (lang) utter.lang = lang;
      const chosenVoice = ttsVoices.find((v) => v.name === ttsVoiceSelect.value);
      if (chosenVoice) utter.voice = chosenVoice;
      // Kelime kelime takip: tarayıcı/ses "boundary" olayını destekliyorsa charIndex GERÇEK (tahmini
      // değil) kelime konumunu veriyor — sarıyla o an okunan kelimeyi vurguluyoruz. Her ses/tarayıcı
      // bunu tetiklemeyebilir (bazı çevrimiçi sesler hiç vermiyor); o durumda sessizce sadece satır
      // vurgusunda kalınır, hata vermez.
      utter.onboundary = (ev) => {
        if (ev.name && ev.name !== "word") return;
        highlightWord(rows[index], wordIndexAtChar(text, ev.charIndex));
      };
      utter.onend = () => { if (ttsState === "playing") ttsSpeakFrom(index + 1); };
      utter.onerror = () => { if (ttsState === "playing") ttsSpeakFrom(index + 1); };
      rows.forEach((r) => { r.classList.remove("reading"); deactivateWordTracking(r); });
      rows[index].classList.add("reading");
      activateWordTracking(rows[index], text);
      currentReadingIndex = index;
      updateRowButtons();
      rows[index].scrollIntoView({ behavior: "smooth", block: "center" });
      speechSynthesis.speak(utter);
    }

    function ttsStop() {
      ttsState = "idle"; // onend/onerror'ın devam etmemesi için cancel()'dan ÖNCE ayarlanıyor
      speechSynthesis.cancel();
      rows.forEach((r) => { r.classList.remove("reading"); deactivateWordTracking(r); });
      currentReadingIndex = -1;
      ttsUpdateBtn();
      updateRowButtons();
    }

    function ttsPlayFrom(index) {
      // Önceden duraklatılmış/kuyrukta kalan bir okuma varsa önce temizle — aksi halde tarayıcı
      // "duraklatılmış" durumda takılı kalıp yeni satırdan başlamayı hiç başlatmıyordu.
      speechSynthesis.cancel();
      ttsState = "playing";
      ttsUpdateBtn();
      ttsSpeakFrom(index);
    }

    ttsBtn.addEventListener("click", () => {
      if (ttsState === "idle") {
        ttsPlayFrom(0);
      } else if (ttsState === "playing") {
        speechSynthesis.pause();
        ttsState = "paused";
        ttsUpdateBtn();
      } else {
        speechSynthesis.resume();
        ttsState = "playing";
        ttsUpdateBtn();
      }
    });
    ttsStopBtn.addEventListener("click", ttsStop);

    // Her satırın yanındaki "▶" — sadece istediğin yerden, o satırdan itibaren okumaya başlatıyor
    // (baştan dinlemek zorunda kalmadan). O an okunan satırdaysa aynı düğme "⏹" olarak durduruyor.
    rows.forEach((row, i) => {
      const playFromBtn = document.createElement("button");
      playFromBtn.className = "tts-play-from";
      playFromBtn.title = t("tts_play_from_hint");
      playFromBtn.textContent = "▶";
      playFromBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (ttsState !== "idle" && i === currentReadingIndex) ttsStop();
        else ttsPlayFrom(i);
      });
      row.appendChild(playFromBtn);
    });

    ttsVoices = await getVoicesAsync();
    await populateTtsVoices();
  }

  // ------------------------------------------------------------ çeviri (cihaz üzerinde)
  if (!canTranslate) return;

  const translateSelect = document.getElementById("translateLang");
  const translateBtn = document.getElementById("translateBtn");
  const originalBtn = document.getElementById("originalBtn");
  const statusEl = document.getElementById("translateStatus");

  if (!sourceLang) {
    statusEl.hidden = false;
    // "unsupported"/"no-api": cihaz/tarayıcı özelliği hiç desteklemiyor — kalıcı, hangi video olursa
    // olsun aynı sonuç. "low-confidence"/"error": bu videoya/içeriğe özel, tek seferlik bir durum. İkisini
    // aynı belirsiz mesajla göstermek "bir bug mı var" diye düşündürüyordu.
    statusEl.textContent = sourceLangResult.reason === "unsupported" || sourceLangResult.reason === "no-api"
      ? t("translate_unsupported_device") : t("translate_no_source");
    translateBtn.disabled = true;
    translateSelect.disabled = true;
    return;
  }
  // Kaynak dili listeden çıkarmıyoruz (ör. İngilizce her zaman seçenek olarak kalsın) — dil tespiti
  // yanılabiliyor, kullanıcı istediği hedefi her zaman görebilsin.
  translateSelect.innerHTML = TRANSLATE_LANGS
    .map((l) => `<option value="${l.code}">${escapeHtml(l.label)}</option>`).join("");
  // Her seferinde dil seçmek zorunda kalmasın diye en son hangi dile çevirdiyse (bu videoda değilse
  // bile) o dil önceden seçili geliyor — genelde hep aynı dile çevrilir.
  const DEFAULT_TRANSLATE_LANG_KEY = "skimcastDefaultTranslateLang";
  const { [DEFAULT_TRANSLATE_LANG_KEY]: defaultLang } = await chrome.storage.local.get(DEFAULT_TRANSLATE_LANG_KEY);
  if (defaultLang && defaultLang !== sourceLang) translateSelect.value = defaultLang;

  function applyTexts(texts, lang) {
    state.texts = texts;
    state.lang = lang;
    rows.forEach((row, i) => {
      row.dataset.text = texts[i].toLocaleLowerCase("tr");
      row.querySelector(".text").textContent = texts[i];
    });
    applyFilters();
    originalBtn.hidden = lang === null;
    refreshTtsVoices?.(); // dil değişti, sesli okuma listesi de bu dile göre güncellensin
  }

  translateBtn.addEventListener("click", async () => {
    const target = translateSelect.value;
    translateBtn.disabled = true;
    statusEl.hidden = false;

    if (target === sourceLang) { // zaten bu dilde — çevirmeye gerek yok, orijinali göster
      applyTexts(blocks.map((b) => b.text), null);
      statusEl.textContent = t("translate_done");
      translateBtn.disabled = false;
      return;
    }

    await chrome.storage.local.set({ [DEFAULT_TRANSLATE_LANG_KEY]: target });

    // Önbellek SÜRÜMLÜ: çeviri mantığını (cümle cümle bölme, sayı koruma, vb.) her iyileştirdiğimde bu
    // sayıyı artırıyorum — eski, bu iyileştirmelerden ÖNCE üretilmiş önbellek otomatik geçersiz sayılıyor.
    // Bunsuz, bir kullanıcı bir videoyu bir kere çevirip sonra biz motoru düzeltsek bile hep eski (hatalı)
    // çeviriyi görmeye devam ederdi — "düzelttim" deyip hiçbir şey değişmemiş gibi görünürdü.
    const cached = entry.translationsVersion === TRANSLATION_CACHE_VERSION ? entry.translations?.[target] : null;
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
      // Önceki sürüm blokları TEK TEK sırayla çeviriyordu — uzun videolarda bekleme uzuyordu. İki
      // iyileştirme: (1) birden fazla bloğu AYNI ANDA çeviriyoruz (CONCURRENCY kadar), (2) her blok
      // biter bitmez ekrana anında yansıtıyoruz — kullanıcı en baştan itibaren okumaya başlayabiliyor,
      // geri kalanı arka planda tamamlanıyor, sonunu beklemesi gerekmiyor.
      const CONCURRENCY = 4;
      const translated = new Array(blocks.length);
      let completed = 0, nextIndex = 0;
      async function worker() {
        while (nextIndex < blocks.length) {
          const i = nextIndex++;
          // Bloğu CÜMLE CÜMLE çeviriyoruz (yukarıdaki splitSentences notuna bkz.) — sırayla, aynı
          // translator oturumuyla; her cümlede ayrı ayrı hata toleransı var.
          const sentences = splitSentences(blocks[i].text);
          const translatedParts = [];
          for (const sentence of sentences) {
            try {
              const { protectedText, numbers } = protectNumbers(sentence);
              let cleaned = cleanTranslation(await translator.translate(protectedText), protectedText);
              // Çıktı şüpheli derecede kısaysa bir kere daha deniyoruz — model aynı girdide farklı bir
              // denemede daha tam bir çıktı üretebiliyor. AMA: hâlâ kısa çıksa bile artık ORİJİNAL DİLE
              // DÜŞMÜYORUZ — bu, Türkçe gibi eklemeli dillerde YANLIŞ ALARM veriyordu (doğru bir Türkçe
              // çeviri, İngilizce kaynaktan kelime SAYISI olarak çok daha kısa olabilir — "sondan
              // eklemeli" bir dilde bu normal, eksik demek değil) ve sonuçta çevrilmiş Türkçe metnin
              // İÇİNE rastgele İngilizce cümleler karışmasına yol açıyordu — kullanıcı bunu (haklı olarak)
              // hata olarak bildirdi. Dil karışması, terslikli-ama-tek-dilde bir çeviriden HER ZAMAN daha
              // kötü — o yüzden elimizdeki çeviriyi (kısa da olsa) kullanıyoruz, orijinali göstermiyoruz.
              if (isSuspiciouslyShort(sentence, cleaned)) {
                try {
                  const retry = cleanTranslation(await translator.translate(protectedText), protectedText);
                  if (!isSuspiciouslyShort(sentence, retry)) cleaned = retry;
                } catch { /* yeniden deneme başarısız, ilk sonuçla devam */ }
              }
              if (numbers.length) cleaned = restoreNumbers(cleaned, numbers);
              translatedParts.push(cleaned);
            } catch {
              // Tek bir cümlede çeviri motoru hata verirse tüm bloğu iptal etmek yerine o cümleyi
              // orijinal haliyle bırakıp devam ediyoruz.
              translatedParts.push(sentence);
            }
          }
          translated[i] = translatedParts.join(" ");
          completed++;
          statusEl.textContent = `${t("translate_progress")} ${completed}/${blocks.length}`;
          rows[i].querySelector(".text").textContent = translated[i];
          rows[i].dataset.text = translated[i].toLocaleLowerCase("tr");
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      applyTexts(translated, target);
      statusEl.textContent = t("translate_done");
      entry.translations = { ...(entry.translationsVersion === TRANSLATION_CACHE_VERSION ? entry.translations || {} : {}), [target]: translated };
      entry.translationsVersion = TRANSLATION_CACHE_VERSION;
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
