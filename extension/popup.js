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

// skimcast'in otomatik çekemediği içerikler (altyazısız video, üyelik gerektiren bir makale, elle
// deşifre ettiğin bir ses kaydı) için: kullanıcı kendi metnini yapıştırır, biz arşivleriz. "[mm:ss]"
// ile başlayan satırlar varsa zaman damgalı transcript gibi (tıkla-git YOK ama arama/favori/çeviri
// hepsi çalışır), yoksa boş satırla ayrılmış paragrafları ayrı blok olarak alıyoruz.
async function runManual() {
  const btn = document.getElementById("manualSave");
  const errorEl = document.getElementById("manualError");
  errorEl.hidden = true;
  const title = document.getElementById("manualTitle").value.trim();
  const text = document.getElementById("manualText").value.trim();
  if (!text) {
    errorEl.hidden = false;
    errorEl.textContent = t("manual_error_empty");
    return;
  }
  btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ action: "addManual", title, text });
    if (!res.ok) throw new Error(res.error);
    document.getElementById("manualTitle").value = "";
    document.getElementById("manualText").value = "";
    document.getElementById("manualForm").hidden = true;
  } catch (e) {
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
  document.getElementById("manualToggle").addEventListener("click", () => {
    const form = document.getElementById("manualForm");
    form.hidden = !form.hidden;
    if (!form.hidden) document.getElementById("manualTitle").focus();
  });
  document.getElementById("manualSave").addEventListener("click", runManual);
}

init();
