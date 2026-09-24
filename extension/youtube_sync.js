// skimcast (uzantı): youtube_sync.js — YouTube izleme sayfasına enjekte edilen içerik betiği. İki işi var:
// 1) Oynatılan videonun kimliğini ve o anki oynatma zamanını (throttle'lanmış) arka plana (background.js)
//    bildirmek — "videoyla senkron takip" (skimcast sekmede "🔗" açıkken transcript kendiliğinden kayar).
// 2) Sayfanın sağ sütununa (normalde "sıradaki video" listesinin olduğu yer) tam boy bir skimcast paneli
//    yerleştirmek — transcript'i ayrı bir sekmede değil, videonun hemen yanında gösterir. Transcript arşivde
//    yoksa "Transcript'i Getir" düğmesi çıkar; varsa panel viewer.html'i bir iframe içinde yükler.

function currentVideoId() {
  let u;
  try { u = new URL(location.href); } catch { return null; }
  if (u.pathname === "/watch") return u.searchParams.get("v");
  const shortsM = u.pathname.match(/^\/shorts\/([\w-]{11})/);
  if (shortsM) return shortsM[1];
  const liveM = u.pathname.match(/^\/live\/([\w-]{11})/);
  if (liveM) return liveM[1];
  return null;
}

let lastSentAt = 0;
function onTimeUpdate(video, videoId) {
  const now = Date.now();
  if (now - lastSentAt < 400) return; // saniyede ~2 güncelleme yeterli, mesaj trafiğini gereksiz artırma
  lastSentAt = now;
  try {
    chrome.runtime.sendMessage({ type: "skimcast-time-update", videoId, currentTime: video.currentTime });
  } catch { /* uzantı yeniden yüklenmiş olabilir, sessizce geç */ }
}

// Kenar panelindeki (iframe içindeki viewer.js) bir zaman damgasına tıklanınca artık yeni bir sekme
// AÇMIYORUZ — aynı sayfadaki video zaten orada, doğrudan onu saniyeye atlatıyoruz. viewer.js iframe
// içindeyken bunun yerine postMessage ile buraya bildiriyor.
window.addEventListener("message", (e) => {
  if (e.source !== document.getElementById(SIDEBAR_IFRAME_ID)?.contentWindow) return;
  if (e.data?.type !== "skimcast-seek") return;
  const video = document.querySelector("video.html5-main-video") || document.querySelector("video");
  if (video && typeof e.data.sec === "number") video.currentTime = e.data.sec;
});

let attachedVideo = null;
let attachedId = null;
function attach() {
  const videoId = currentVideoId();
  const video = document.querySelector("video.html5-main-video") || document.querySelector("video");
  if (!videoId || !video) return;
  if (video === attachedVideo && videoId === attachedId) return;
  if (attachedVideo && attachedVideo._skimcastHandler) {
    attachedVideo.removeEventListener("timeupdate", attachedVideo._skimcastHandler);
  }
  const handler = () => onTimeUpdate(video, videoId);
  video.addEventListener("timeupdate", handler);
  video._skimcastHandler = handler;
  attachedVideo = video;
  attachedId = videoId;
  ensureSidebarPanel(videoId);
}

// ------------------------------------------------------------ kenar paneli
const PANEL_ID = "skimcast-sidebar-panel";
const SIDEBAR_IFRAME_ID = "skimcast-sidebar-iframe";
const archiveKey = (id) => `skimcastArchive:${id}`;

// Uzantının kendi _locales/<dil>/messages.json'ından okuyor (background.js'in sağ tık menüsü başlığı için
// yaptığının aynısı) — içerik betiği viewer.js'nin i18n sistemini (lang.js) doğrudan kullanamıyor.
let messagesCache = null;
async function loadMessages() {
  if (messagesCache) return messagesCache;
  const { skimcastUiLang } = await chrome.storage.local.get("skimcastUiLang");
  const lang = skimcastUiLang || (chrome.i18n.getUILanguage().split("-")[0] === "tr" ? "tr" : "en");
  try {
    const res = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
    messagesCache = await res.json();
  } catch {
    messagesCache = {};
  }
  return messagesCache;
}
async function tt(key, fallback) {
  const messages = await loadMessages();
  return messages[key]?.message || fallback;
}

let panelVideoId = null;

function findSecondaryColumn() {
  return document.querySelector("#secondary #secondary-inner") || document.querySelector("#secondary");
}

async function buildPanelShell() {
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <div class="skimcast-sb-header">
      <span>skimcast</span>
      <button type="button" class="skimcast-sb-toggle" title="${escapeAttr(await tt("sidebar_collapse_hint", "Collapse"))}">▾</button>
    </div>
    <div class="skimcast-sb-body"></div>
  `;
  panel.querySelector(".skimcast-sb-toggle").addEventListener("click", () => {
    const collapsed = panel.classList.toggle("skimcast-collapsed");
    panel.querySelector(".skimcast-sb-toggle").textContent = collapsed ? "▸" : "▾";
  });
  return panel;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}

async function renderCta(body, videoId) {
  body.innerHTML = `
    <div class="skimcast-sb-cta">
      <p>${await tt("sidebar_cta_text", "See this video's searchable, click-to-jump transcript right here.")}</p>
      <button type="button" class="skimcast-sb-fetch">${await tt("fetch_btn", "Get transcript")}</button>
      <p class="skimcast-sb-status" hidden></p>
    </div>`;
  const btn = body.querySelector(".skimcast-sb-fetch");
  const status = body.querySelector(".skimcast-sb-status");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    status.hidden = false;
    status.textContent = await tt("status_fetching", "Fetching transcript…");
    try {
      const res = await chrome.runtime.sendMessage({ type: "skimcast-fetch-silent", url: location.href });
      if (!res?.ok) throw new Error(res?.error || "?");
      if (panelVideoId === videoId) renderIframe(body, videoId);
    } catch (e) {
      status.textContent = `${await tt("error_prefix", "Error:")} ${e.message || e}`;
      btn.disabled = false;
    }
  });
}

function renderIframe(body, videoId) {
  const src = chrome.runtime.getURL(`viewer.html?id=${encodeURIComponent(`yt:${videoId}`)}`);
  body.innerHTML = `<iframe id="${SIDEBAR_IFRAME_ID}" src="${src}" allow="clipboard-write"></iframe>`;
}

// Video değiştiğinde (SPA navigasyonu) paneli o videoya göre yeniden kuruyoruz: arşivde zaten varsa
// doğrudan iframe, yoksa "Transcript'i Getir" çağrısı. Panelin kendisi (başlık, küçült düğmesi) sabit
// kalıyor, sadece gövdesi değişiyor.
async function ensureSidebarPanel(videoId) {
  if (panelVideoId === videoId && document.getElementById(PANEL_ID)) return;
  panelVideoId = videoId;

  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    const column = findSecondaryColumn();
    if (!column) { panelVideoId = null; return; } // sayfa henüz tam yüklenmedi, attach() zaten tekrar deneyecek
    panel = await buildPanelShell();
    column.insertBefore(panel, column.firstChild);
  }

  const body = panel.querySelector(".skimcast-sb-body");
  const { [archiveKey(`yt:${videoId}`)]: entry } = await chrome.storage.local.get(archiveKey(`yt:${videoId}`));
  if (panelVideoId !== videoId) return; // bu sırada video tekrar değişmiş olabilir
  if (entry) renderIframe(body, videoId);
  else await renderCta(body, videoId);
}

// Popup'tan ya da sağ tık menüsünden "Transcript'i Getir" tetiklendiğinde (background.js:fetchAndOpen)
// — bu video zaten bu sekmede açıksa arka plan yeni sekme açmak yerine buraya haber veriyor. panelVideoId'yi
// sıfırlayıp ensureSidebarPanel'i zorla yeniden çalıştırıyoruz ki artık arşivde olan kaydı görüp iframe'e
// geçsin (aksi halde "zaten bu videoya göre kurulu" diye hiçbir şey yapmadan çıkardı).
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "skimcast-refresh-panel" && msg.videoId) {
    panelVideoId = null;
    ensureSidebarPanel(msg.videoId);
  }
});

attach();
// YouTube bir SPA — sayfa hiç yenilenmeden video/URL değişebiliyor (bir sonraki videoya geçme, ilgili
// video tıklama, vb.). Kendi navigasyon olayını dinliyoruz; garanti olsun diye periyodik de kontrol ediyoruz.
document.addEventListener("yt-navigate-finish", attach);
setInterval(attach, 1000);
