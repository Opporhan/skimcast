// skimcast (uzantı): lang.js — uygulamanın arayüz dilini (popup, görüntüleyici, kütüphane — hepsi)
// tarayıcı dilinden BAĞIMSIZ olarak değiştirebilmek için. chrome.i18n.getMessage() her zaman tarayıcının
// kendi diline bakıyor, kullanıcı başına değiştirilemiyor — bu yüzden ilgili _locales/<dil>/messages.json
// dosyasını kendimiz fetch edip t() bunun üzerinden çalışıyor. Tercih chrome.storage.local'de tek bir
// anahtar (skimcastUiLang) olarak tutuluyor, tüm sayfalarda ortak.
const UI_LANG_KEY = "skimcastUiLang"; // "tr" | "en"
let _messages = null;

function browserDefaultLang() {
  return chrome.i18n.getUILanguage().split("-")[0] === "tr" ? "tr" : "en";
}

async function getUiLang() {
  const { [UI_LANG_KEY]: lang } = await chrome.storage.local.get(UI_LANG_KEY);
  if (lang) return lang;
  // Bu cihazda hiç ayarlanmamış — kullanıcı aynı Google hesabıyla başka bir cihazda dil seçtiyse,
  // chrome.storage.sync (Chrome'un kendi ücretsiz, sunucusuz senkronizasyonu — ekstra ağ isteği/maliyet
  // yok) üzerinden o tercihi buraya taşıyoruz. Kurumsal politika vb. yüzden storage.sync kapalıysa
  // sessizce tarayıcı diline düşüyoruz.
  try {
    const { [UI_LANG_KEY]: synced } = await chrome.storage.sync.get(UI_LANG_KEY);
    if (synced) { chrome.storage.local.set({ [UI_LANG_KEY]: synced }); return synced; }
  } catch { /* storage.sync kullanılamıyor, sorun değil */ }
  return browserDefaultLang();
}

async function initLang() {
  const lang = await getUiLang();
  try {
    const res = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
    const data = await res.json();
    _messages = {};
    for (const k in data) _messages[k] = data[k].message;
  } catch {
    _messages = null; // yüklenemezse chrome.i18n'e (tarayıcı diline) düşer
  }
}

// Diğer tüm dosyaların kullandığı t() — artık burada, tek bir yerde.
function t(key) {
  if (_messages && _messages[key] !== undefined) return _messages[key];
  return chrome.i18n.getMessage(key) || key;
}

async function setUiLang(lang) {
  await chrome.storage.local.set({ [UI_LANG_KEY]: lang });
  chrome.storage.sync.set({ [UI_LANG_KEY]: lang }).catch(() => {}); // diğer cihazlara da taşınsın
  location.reload(); // her yeri (butonlar, başlıklar, tüm metin) tazeden en basit ve güvenilir yol
}

async function mountLangButton(btn) {
  if (!btn) return;
  const lang = await getUiLang();
  btn.textContent = lang === "tr" ? "🌐 TR" : "🌐 EN";
  btn.title = "Türkçe / English";
  btn.addEventListener("click", async () => setUiLang((await getUiLang()) === "tr" ? "en" : "tr"));
}
