// skimcast (uzantı): popup.js — arayüz, dil seçimi, Gemini API anahtarı ayarı. Transcript alma +
// özetleme + sonuç sayfasını açma tamamı background.js'te biter.

const LANGS = [
  { code: "tr", native: "Türkçe", en: "Turkish" },
  { code: "en", native: "English", en: "English" },
  { code: "es", native: "Español", en: "Spanish" },
  { code: "fr", native: "Français", en: "French" },
  { code: "de", native: "Deutsch", en: "German" },
  { code: "ja", native: "日本語", en: "Japanese" },
  { code: "pt", native: "Português", en: "Portuguese" },
  { code: "ar", native: "العربية", en: "Arabic" },
  { code: "ru", native: "Русский", en: "Russian" },
];

function t(key) { return chrome.i18n.getMessage(key) || key; }

function applyI18n() {
  document.title = t("ext_name");
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
}

function fillLangSelect() {
  const sel = document.getElementById("lang");
  for (const l of LANGS) {
    const opt = document.createElement("option");
    opt.value = l.code; opt.textContent = l.native;
    sel.appendChild(opt);
  }
  const other = document.createElement("option");
  other.value = "other"; other.textContent = t("lang_other_option");
  sel.appendChild(other);
  // arayüz diline göre makul bir varsayılan seç
  const uiLang = chrome.i18n.getUILanguage().split("-")[0];
  if (LANGS.some((l) => l.code === uiLang)) sel.value = uiLang;
  sel.addEventListener("change", () => {
    document.getElementById("langOther").style.display = sel.value === "other" ? "block" : "none";
  });
}

function languageName() {
  const sel = document.getElementById("lang").value;
  if (sel === "other") return document.getElementById("langOther").value.trim() || "English";
  return LANGS.find((l) => l.code === sel)?.en || "English";
}

function captionLangs() {
  const sel = document.getElementById("lang").value;
  const code = sel === "other" ? null : sel;
  return [...new Set([code, "en"].filter(Boolean))].join(",");
}

async function run() {
  const btn = document.getElementById("go");
  const statusEl = document.getElementById("status");
  const errorEl = document.getElementById("error");
  errorEl.hidden = true;
  statusEl.hidden = false; statusEl.textContent = t("status_fetching");
  btn.disabled = true;
  try {
    const url = document.getElementById("url").value.trim();
    if (!url) throw new Error(t("error_no_url"));
    // YouTube'da sekme öne gelince bu popup kapanabilir; background.js işi tek başına bitirir.
    const res = await chrome.runtime.sendMessage({ action: "summarize", url, lang: captionLangs(), langName: languageName() });
    if (!res.ok) throw new Error(res.error);
    statusEl.textContent = t("status_done");
  } catch (e) {
    statusEl.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = (t("error_prefix") ? t("error_prefix") + " " : "") + (e.message || String(e));
  } finally {
    btn.disabled = false;
  }
}

async function initSettings() {
  const input = document.getElementById("apiKey");
  const details = document.getElementById("settings");
  const { skimcastApiKey } = await chrome.storage.local.get("skimcastApiKey");
  if (skimcastApiKey) input.value = skimcastApiKey;
  else details.open = true; // anahtar yoksa ayarları açık göster, kullanıcı kaçırmasın

  document.getElementById("saveKey").addEventListener("click", async () => {
    const key = input.value.trim();
    await chrome.storage.local.set({ skimcastApiKey: key });
    const statusEl = document.getElementById("keyStatus");
    statusEl.textContent = t("api_key_saved");
    setTimeout(() => { statusEl.textContent = ""; }, 2000);
    if (key) details.open = false;
  });
}

async function init() {
  applyI18n();
  fillLangSelect();
  await initSettings();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /^https?:\/\//.test(tab.url)) document.getElementById("url").value = tab.url;
  } catch { /* aktif sekme okunamadı, kullanıcı elle yapıştırır */ }
  document.getElementById("go").addEventListener("click", run);
}

init();
