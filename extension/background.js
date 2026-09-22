// skimcast (uzantı): background.js — transcript'i toplar, arşive kaydeder, görüntüleyici sekmesini açar.
// Podcast RSS / Apple Podcasts / web sayfası: doğrudan JS fetch ile (aşağıda). YouTube ise tarayıcıdan
// artık erişilemiyor (bkz. fromYoutube) — bunun için skills/summarize/native_host.py'ye (Python,
// youtube_transcript_api) native messaging ile bağlanıyoruz; sürekli çalışan bir sunucu değil, Chrome
// anlık olarak başlatıp kapatıyor.
//
// Eskiden burada bir de Groq'a (ücretsiz LLM API'si) istek atıp özet çıkarma adımı vardı. Bir gece
// boyunca kota/model/hız-sınırı sorunlarıyla uğraştıktan sonra (bkz. git geçmişi) bilinçli olarak
// vazgeçildi: ücretsiz bulut LLM'lerin kotaları güvenilir bir ürün için yetersiz. Bunun yerine zaten
// sağlam çalışan parçaya (transcript çıkarma) odaklanıldı — özet yerine aranabilir/atlanabilir bir
// transcript görüntüleyici + kişisel arşiv.

const BLOCK_SECONDS = 30;
const MIN_PAGE_CHARS = 300;

class SkimError extends Error {}

function fmtTime(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function toBlocks(segments) {
  const blocks = [];
  let start = null, buf = [];
  for (const [t, raw] of segments) {
    const text = String(raw).replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (start === null) start = t;
    buf.push(text);
    const span = t - start;
    if (span >= BLOCK_SECONDS && (/[.!?…]$/.test(text) || span >= 2 * BLOCK_SECONDS)) {
      blocks.push(`[${fmtTime(start)}] ${buf.join(" ")}`);
      start = null; buf = [];
    }
  }
  if (buf.length) blocks.push(`[${fmtTime(start)}] ${buf.join(" ")}`);
  return blocks;
}

async function fetchText(url) {
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": "skimcast-extension/0.1" } });
  } catch (e) {
    throw new SkimError(`Bağlantı kurulamadı (${url.slice(0, 60)}…): ${e.message}`);
  }
  if (!res.ok) throw new SkimError(`Bağlantı kurulamadı (${url.slice(0, 60)}…): HTTP ${res.status}`);
  return res.text();
}

// ---------------------------------------------------------------- YouTube (native messaging üzerinden)
const YT_ID_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/|v\/))([\w-]{11})/;

function youtubeId(url) {
  const m = url.match(YT_ID_RE);
  return m ? m[1] : null;
}

// YouTube'un caption/get_transcript API'leri artık tarayıcıdan (gerçek, oturum açmış kullanıcının
// imzasıyla bile) çalışmıyor: bir "proof of origin" (pot) token istiyor, bu da yalnızca gerçek, işletim
// sistemi seviyesinde bir fare/klavye etkileşimiyle üretiliyor — bir uzantının kod olarak üretemeyeceği
// bir şey (denendi, doğrulandı: gerçek tıklama çalışıyor, .click() ve chrome.debugger ile üretilen
// "tıklamalar" çalışmıyor). Bunu atlatmaya çalışmak (sahte-ama-güvenilir olay üretmek) yapmayacağımız bir
// şey. Bunun yerine YouTube'u bu korumaya hiç takılmayan gerçek bir Python süreciyle (youtube_transcript_api)
// okuyoruz: Chrome, transcript istendiğinde skills/summarize/native_host.py'yi anlık başlatıp kapatıyor
// (native messaging) — sürekli açık duran bir sunucu değil. Kurulum tek seferlik: extension/install_native_host.py.
const NATIVE_HOST = "com.skimcast.native_host";

function fromYoutube(url, langs) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: "getTranscript", url, lang: langs.join(",") }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new SkimError(
          "YouTube için yerel yardımcı program kurulu değil ya da Chrome'a kayıtlı değil (tek seferlik kurulum " +
          "gerekiyor). Terminalde çalıştır: python3 extension/install_native_host.py — sonra Chrome'u yeniden " +
          `başlat. (${chrome.runtime.lastError.message})`
        ));
        return;
      }
      if (!response || !response.ok) {
        reject(new SkimError(response?.error || "Yerel yardımcı programdan yanıt alınamadı."));
        return;
      }
      resolve({ native: true, meta: response.meta, text: response.text });
    });
  });
}

// ---------------------------------------------------------------- podcast RSS / Apple
function parseSubtitles(text) {
  const segs = []; let curT = null, lines = [], prev = [];
  const timeRe = /((?:\d+:)?\d+:\d+[.,]\d+)\s*-->/;
  const toSec = (stamp) => {
    const parts = stamp.replace(",", ".").split(":").map(Number);
    while (parts.length < 3) parts.unshift(0);
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  };
  const flush = () => {
    if (curT !== null) {
      let k = 0;
      for (let n = Math.min(lines.length, prev.length); n > 0; n--) {
        if (lines.slice(0, n).join("\u0001") === prev.slice(prev.length - n).join("\u0001")) { k = n; break; }
      }
      const line = lines.slice(k).join(" ").trim();
      if (line) segs.push([curT, line]);
      prev = lines;
    }
    curT = null; lines = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(timeRe);
    if (m) { flush(); curT = toSec(m[1]); }
    else if (curT !== null) {
      const line = raw.replace(/<[^>]+>/g, "").trim();
      if (!line) flush();
      else if (!/^\d+$/.test(line)) lines.push(line);
    }
  }
  flush();
  return segs;
}

function parsePodcastJson(text) {
  const data = JSON.parse(text);
  return (data.segments || []).map((s) => [Number(s.startTime || 0), s.body || ""]);
}

async function rssItem(feedUrl, audioHint, titleHint) {
  const xml = new DOMParser().parseFromString(await fetchText(feedUrl), "application/xml");
  if (xml.querySelector("parsererror")) throw new SkimError("RSS okunamadı (bozuk XML).");
  const items = [...xml.querySelectorAll("channel > item")];
  if (!items.length) throw new SkimError("RSS'te bölüm bulunamadı.");
  const norm = (u) => (u || "").split("?")[0];
  if (audioHint || titleHint) {
    for (const it of items) {
      const enc = it.querySelector("enclosure");
      const t = it.querySelector("title")?.textContent?.trim();
      if ((audioHint && enc && norm(enc.getAttribute("url")) === norm(audioHint)) ||
          (titleHint && t === titleHint.trim())) return it;
    }
    throw new SkimError("Linkteki bölüm RSS'te bulunamadı (çok eski olabilir).");
  }
  return items[0]; // en yeni bölüm
}

async function fromFeed(feedUrl, audioHint, titleHint) {
  const item = await rssItem(feedUrl, audioHint, titleHint);
  const title = item.querySelector("title")?.textContent?.trim() || "";
  const prefer = ["text/vtt", "application/srt", "application/x-subrip", "application/json", "text/plain"];
  const tags = [...item.getElementsByTagName("*")]
    .filter((e) => e.localName === "transcript" && e.getAttribute("url"))
    .sort((a, b) => {
      const rank = (e) => { const i = prefer.indexOf(e.getAttribute("type")); return i === -1 ? 99 : i; };
      return rank(a) - rank(b);
    });
  for (const tag of tags) {
    try {
      const body = await fetchText(tag.getAttribute("url"));
      const type = tag.getAttribute("type") || "";
      let segs = type.includes("json") ? parsePodcastJson(body) : parseSubtitles(body);
      if (!segs.length && type.startsWith("text/plain")) segs = [[0, body]];
      if (segs.length) return { title, method: `podcast-transcript-etiketi (${type})`, segments: segs, duration: 0, linkPrefix: "", timestamps: true };
    } catch { /* bu etiket olmadı, sıradakini dene */ }
  }
  throw new SkimError("Bu bölümde hazır transcript etiketi yok. (Uzantı sürümü sesi deşifre edemez; " +
    "Claude Code + skimcast eklentisi bunu whisper ile yapabilir.)");
}

async function fromApple(url) {
  const showId = url.match(/podcasts\.apple\.com\/.*?\/id(\d+)/)?.[1];
  const ep = new URL(url).searchParams.get("i");
  const country = url.match(/podcasts\.apple\.com\/([a-z]{2})\//)?.[1];
  const lookupUrl = `https://itunes.apple.com/lookup?id=${showId}&entity=podcastEpisode&limit=200` + (country ? `&country=${country}` : "");
  const data = JSON.parse(await fetchText(lookupUrl));
  const results = data.results || [];
  const feed = results.find((r) => r.feedUrl)?.feedUrl;
  const episodes = results.filter((r) => r.wrapperType === "podcastEpisode");
  const chosen = ep ? episodes.find((r) => String(r.trackId) === ep) : episodes[0];
  if (!feed || !chosen) {
    throw new SkimError(!ep || !episodes.length ? "Apple Podcasts kaydı bulunamadı." :
      "Linkteki bölüm Apple'ın döndürdüğü son 200 bölüm içinde yok; podcast'in RSS linkini deneyin.");
  }
  return fromFeed(feed, chosen.episodeUrl, chosen.trackName);
}

// ---------------------------------------------------------------- web sayfası
async function fromWebpage(url) {
  const html = await fetchText(url);
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,nav,header,footer,aside,noscript").forEach((e) => e.remove());
  const text = (doc.body?.innerText || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < MIN_PAGE_CHARS) throw new SkimError("Sayfadan okunabilir metin çıkarılamadı (giriş gerektiriyor olabilir).");
  const title = doc.querySelector("title")?.textContent?.trim() || "";
  return { title, method: "web-sayfası", segments: [[0, text]], duration: 0, linkPrefix: "", timestamps: false };
}

// ---------------------------------------------------------------- yönlendirme
const FEED_RE = /(\.xml|\.rss|\/feed|\/rss)(\/|\?|$)/i;
const APPLE_RE = /podcasts\.apple\.com\/.*?\/id\d+/;

async function getTranscript(target, langs) {
  let host;
  try { host = new URL(target).hostname.toLowerCase(); } catch { throw new SkimError("Geçerli bir link (http…) girin."); }
  if (host.includes("spotify.com")) {
    throw new SkimError("Spotify içeriği korumalıdır (DRM) ve desteklenmez. Aynı podcast'in Apple Podcasts veya RSS linkini kullanın.");
  }
  if (youtubeId(target)) return fromYoutube(target, langs);
  if (APPLE_RE.test(target)) return fromApple(target);
  if (FEED_RE.test(target)) return fromFeed(target);
  try {
    return await fromWebpage(target);
  } catch (e) {
    throw e instanceof SkimError ? e : new SkimError(String(e.message || e));
  }
}

function buildTranscriptText(t) {
  const blocks = t.timestamps ? toBlocks(t.segments) : [t.segments[0][1]];
  return blocks.join("\n");
}

// ---------------------------------------------------------------- kimlik + arşiv
// FNV-1a: podcast/web linkleri için basit, hızlı, senkron bir hash — kriptografik bir amacı yok, sadece
// aynı link tekrar getirilince aynı arşiv kaydının üzerine yazılsın diye (YouTube'da video ID zaten var).
function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function stableId(url) {
  const vid = youtubeId(url);
  return vid ? `yt:${vid}` : `u:${hashString(url)}`;
}

function parseTimeLabel(label) {
  const parts = label.split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

// Otomatik altyazılar (YouTube/whisper) konuşma olmayan anları "(müzik)", "[Music]", "(alkış)" gibi
// parantez/köşeli parantez içinde işaretliyor — bunlar gerçek konuşma değil, arama/çeviri/alıntıda
// gürültü yaratıyor. Bilinen etiketleri (TR+EN) satırdan siler; satırın tamamı bir etiketten ibaretse
// (ör. sadece "(müzik)") blok tamamen atlanır.
const NON_SPEECH_RE = /[([](müzik|music|gülüşme\w*|laugh\w*|alkış\w*|applause|gürültü\w*|noise|sessizlik|silence|anlaşılamıyor|inaudible|crosstalk|arka plan( müziği| sesi)?|background( music| noise)?)[)\]]/gi;

function stripNonSpeech(text) {
  return text.replace(NON_SPEECH_RE, "").replace(/\s{2,}/g, " ").trim();
}

// Hem native (Python) tarafının hem de kendi toBlocks()'umuzun ürettiği "[mm:ss] metin" satırlarını
// {sec, text} nesnelerine çevirir — görüntüleyici ve kütüphane (arama, tıkla-git, reklam tespiti)
// bunun üzerinden çalışır. Zaman damgası yoksa (web sayfası) sec null kalır.
function parseTimedBlocks(text) {
  const blocks = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\[(\d{1,2}(?::\d{2}){1,2})\]\s?(.*)$/);
    const sec = m ? parseTimeLabel(m[1]) : null;
    const cleaned = stripNonSpeech(m ? m[2] : line);
    if (!cleaned) continue; // satır sadece "(müzik)" gibi bir etiketti, atla
    blocks.push({ sec, text: cleaned });
  }
  return blocks;
}

const archiveKey = (id) => `skimcastArchive:${id}`;
const ARCHIVE_INDEX_KEY = "skimcastArchiveIndex";

// Arşiv iki parçada tutulur: her kayıt kendi anahtarında (tam metin, olası büyük), ve hafif bir dizin
// (skimcastArchiveIndex) sadece kütüphane sayfasını hızlıca doldurmak için. Aynı video/link tekrar
// getirilirse (stableId aynı çıkar) kayıt güncellenir, kopya oluşmaz.
async function saveToArchive(id, url, meta, blocks) {
  const entry = { id, url, meta, blocks, ts: Date.now() };
  const { [ARCHIVE_INDEX_KEY]: index = [] } = await chrome.storage.local.get(ARCHIVE_INDEX_KEY);
  const nextIndex = [
    { id, title: meta.title, method: meta.method, duration: meta.duration, ts: entry.ts },
    ...index.filter((e) => e.id !== id),
  ];
  await chrome.storage.local.set({ [archiveKey(id)]: entry, [ARCHIVE_INDEX_KEY]: nextIndex });
  return entry;
}

// Tek iş: transcript'i almak, arşive kaydetmek, görüntüleyici sekmesini açmak. Artık bir LLM'e istek
// atmıyoruz (bkz. proje geçmişi: Groq'un ücretsiz katman kotaları + servis çalışanının uzun işlerin
// ortasında Chrome tarafından sonlandırılması bütün geceyi almıştı) — transcript alma saniyeler
// sürdüğü için servis çalışanının ömrüyle ilgili bir risk de yok.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action !== "fetch") return;
  (async () => {
    try {
      const t = await getTranscript(msg.url, ["tr", "en"]);
      const meta = t.native
        ? { title: t.meta.title, method: t.meta.method, duration: t.meta.duration, linkPrefix: t.meta.link_prefix }
        : { title: t.title, method: t.method, duration: t.duration ? fmtTime(t.duration) : "", linkPrefix: t.linkPrefix };
      const text = t.native ? t.text : buildTranscriptText(t);
      const blocks = parseTimedBlocks(text);

      const id = stableId(msg.url);
      await saveToArchive(id, msg.url, meta, blocks);
      chrome.tabs.create({ url: chrome.runtime.getURL(`viewer.html?id=${encodeURIComponent(id)}`) });
      sendResponse({ ok: true, meta });
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof SkimError ? e.message : `Beklenmeyen hata: ${e.message || e}` });
    }
  })();
  return true; // asenkron yanıt
});
