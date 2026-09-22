// skimcast (uzantı): background.js — transcript'i tarayıcıda toplar.
// Python sürümünün (skills/summarize/transcript.py) küçük bir alt kümesi: yt-dlp ve whisper YOK
// (bir uzantı bunları çalıştıramaz). Yalnızca doğrudan JS ile çekilebilenler: YouTube (gerçek "Transkripti
// göster" düğmesine tıklayıp DOM'u okuyarak — YouTube'un caption/get_transcript API'leri artık ham fetch()
// isteklerini reddediyor, bkz. fromYoutube), podcast RSS'teki <podcast:transcript> etiketi,
// Apple Podcasts (RSS'e yönlendirir), web sayfası metni.

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

// ---------------------------------------------------------------- YouTube
const YT_ID_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/|v\/))([\w-]{11})/;

function youtubeId(url) {
  const m = url.match(YT_ID_RE);
  return m ? m[1] : null;
}

// YouTube'un caption/timedtext ve youtubei/v1/get_transcript API'leri artık ham fetch() isteklerine
// (imzalı gerçek oturumla bile) boş yanıt ya da "Precondition check failed" ile karşılık veriyor —
// bot koruması. Bunu aşmaya çalışmak (istemci kimliği taklit etmek, korumayı atlatmak) yapmayacağımız
// bir şey. Bunun yerine gerçek bir kullanıcı gibi davranıyoruz: videoyu bir sekmede açıp YouTube'un kendi
// "Transkripti göster" düğmesine tıklıyoruz ve YouTube'un kendi (meşru, gerçek oturumla başarılı olan)
// isteğinin doldurduğu DOM'u okuyoruz. Bu satır satır fonksiyon, chrome.scripting.executeScript ile
// sayfaya enjekte edildiği için tamamen kendi içinde olmalı (background.js'teki başka hiçbir şeye erişemez).
function scrapeTranscriptInPage() {
  return new Promise((resolve) => {
    const q = (sel, root) => (root || document).querySelector(sel);
    const qa = (sel, root) => [...(root || document).querySelectorAll(sel)];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    (async () => {
      const expandBtn = q("tp-yt-paper-button#expand, #expand");
      if (expandBtn) { expandBtn.click(); await sleep(300); }

      let btn = null;
      for (let i = 0; i < 15 && !btn; i++) {
        btn = q("ytd-video-description-transcript-section-renderer button");
        if (!btn) await sleep(300);
      }
      if (!btn) return resolve({ error: "no-button" });
      btn.click();

      let segs = [];
      for (let i = 0; i < 25; i++) {
        await sleep(400);
        segs = qa("ytd-transcript-segment-renderer");
        if (segs.length) break;
      }
      if (!segs.length) return resolve({ error: "no-segments" });

      const out = segs.map((s) => {
        const timeEl = q(".segment-timestamp", s);
        const textEl = q(".segment-text", s);
        let timeText, text;
        if (timeEl && textEl) {
          timeText = timeEl.innerText.trim();
          text = textEl.innerText.trim();
        } else {
          const full = s.innerText.trim();
          const m = full.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*\n?/);
          timeText = m ? m[1] : "0:00";
          text = m ? full.slice(m[0].length).trim() : full;
        }
        const parts = timeText.split(":").map(Number);
        const sec = parts.every((n) => !Number.isNaN(n)) ? parts.reduce((a, b) => a * 60 + b, 0) : 0;
        return [sec, text];
      }).filter(([, t]) => t);

      resolve({ title: document.title.replace(/ - YouTube$/, ""), segments: out });
    })();
  });
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === "complete") { chrome.tabs.onUpdated.removeListener(listener); resolve(); }
    }).catch(() => {});
  });
}

async function fromYoutube(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const openTabs = await chrome.tabs.query({});
  let tab = openTabs.find((t) => t.url && youtubeId(t.url) === videoId);
  const createdByUs = !tab;
  if (!tab) {
    tab = await chrome.tabs.create({ url: watchUrl, active: false });
    await waitForTabComplete(tab.id);
    await new Promise((r) => setTimeout(r, 1500)); // YouTube'un kendi bileşenlerinin render olması için
  }
  let result;
  try {
    const [{ result: r }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrapeTranscriptInPage });
    result = r;
  } catch (e) {
    throw new SkimError(`YouTube sekmesinde transcript okunamadı: ${e.message || e}`);
  } finally {
    if (createdByUs) chrome.tabs.remove(tab.id).catch(() => {});
  }
  if (!result || result.error === "no-button") {
    throw new SkimError("Bu videoda transcript bulunamadı (YouTube'da \"Transkripti göster\" düğmesi yok; video altyazısız olabilir).");
  }
  if (result.error === "no-segments") {
    throw new SkimError("Transcript paneli açıldı ama metin gelmedi. Video altyazısız olabilir ya da YouTube geçici bir sorun yaşıyor olabilir; tekrar deneyin.");
  }
  const segs = result.segments;
  const duration = segs.length ? segs[segs.length - 1][0] : 0;
  return {
    title: result.title || "", method: "youtube-altyazı (tarayıcı üzerinden)", segments: segs, duration,
    linkPrefix: `https://youtu.be/${videoId}?t=`, timestamps: true,
  };
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
  const vid = youtubeId(target);
  if (vid) return fromYoutube(vid); // dil seçimi yok: YouTube'un panelde gösterdiği altyazı kullanılır
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action !== "getTranscript") return;
  const langs = (msg.lang || "tr,en").split(",").map((s) => s.trim().split("-")[0]).filter(Boolean);
  getTranscript(msg.url, langs)
    .then((t) => sendResponse({
      ok: true,
      meta: { title: t.title, method: t.method, duration: t.duration ? fmtTime(t.duration) : "", linkPrefix: t.linkPrefix },
      text: buildTranscriptText(t),
    }))
    .catch((e) => sendResponse({ ok: false, error: e instanceof SkimError ? e.message : `Beklenmeyen hata: ${e.message || e}` }));
  return true; // asenkron yanıt
});
