// skimcast (uzantı): popup.js — link gir, transcript'i getir. Özetleme/dil seçimi/API anahtarı yok
// artık (bkz. proje kararı: LLM özetleme terk edildi) — background.js transcript'i alıp arşive kaydeder
// ve görüntüleyici sekmesini kendisi açar.

function applyI18n() {
  document.title = t("ext_name");
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
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
    const res = await chrome.runtime.sendMessage({ action: "fetch", url });
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

async function init() {
  // Bu sayfa kütüphaneden ("skimcast" linki) NORMAL BİR SEKME olarak da açılabiliyor. document.referrer
  // güvenilir çıkmadı (uzantı sayfaları arası yönlendirmede boş kalabiliyor) — bunun yerine kütüphanedeki
  // linkin kendisi ?standalone=1 ekliyor, biz de ondan bakıyoruz. Sadece o durumda ortalıyoruz (popup.css).
  if (new URLSearchParams(location.search).get("standalone")) {
    document.documentElement.classList.add("standalone-page");
  }
  await initLang();
  applyI18n();
  mountThemeButton(document.getElementById("themeBtn"));
  mountLangButton(document.getElementById("langBtn"));
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /^https?:\/\//.test(tab.url)) document.getElementById("url").value = tab.url;
  } catch { /* aktif sekme okunamadı, kullanıcı elle yapıştırır */ }
  document.getElementById("go").addEventListener("click", run);
}

init();
