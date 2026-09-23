// skimcast (uzantı): youtube_sync.js — YouTube izleme sayfasına enjekte edilen küçük bir içerik betiği.
// Tek işi: oynatılan videonun kimliğini ve o anki oynatma zamanını (throttle'lanmış) arka plana (background.js)
// bildirmek. Aynı videonun skimcast transcript sekmesi açıksa ve kullanıcı orada "🔗 Videoyla Eşitle"yi
// açtıysa, background bu bilgiyi o sekmeye iletiyor — transcript, gerçek video izlenirken kendiliğinden
// o an konuşulan satıra kayıyor ("videoyla senkron takip"). Bu betik transcript'i okumuyor/göstermiyor,
// sayfaya hiçbir görünür değişiklik yapmıyor — sadece "hangi video, kaçıncı saniye" bilgisini yolluyor.

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
}

attach();
// YouTube bir SPA — sayfa hiç yenilenmeden video/URL değişebiliyor (bir sonraki videoya geçme, ilgili
// video tıklama, vb.). Kendi navigasyon olayını dinliyoruz; garanti olsun diye periyodik de kontrol ediyoruz.
document.addEventListener("yt-navigate-finish", attach);
setInterval(attach, 1000);
