#!/usr/bin/env python3
"""skimcast: bir link (veya ses/video dosyası) ver, zaman damgalı transcript al.

Sırayla dener, ilk başarılı olan kazanır:
  YouTube altyazısı -> podcast transcript etiketi -> site altyazısı (yt-dlp) -> web sayfası metni
  -> (son çare) yerel deşifre (faster-whisper).

Çıktı stdout'a yazılır: kısa bir üst bilgi + transcript (uzunsa parça dosyalarının listesi).
Hata olursa Türkçe, anlaşılır bir mesajla 2 koduyla çıkar.
"""

import argparse
import hashlib
import json
import os
import re
import ssl
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

PART_CHARS = 20000  # bundan uzun transcript parça dosyalarına bölünür
BLOCK_SECONDS = 30  # satırlar yaklaşık bu süreli bloklara birleştirilir
TIMEOUT = 30
MIN_PAGE_CHARS = 300
UA = "skimcast/0.1 (+https://github.com/Opporhan/skimcast)"
YT_ID = re.compile(r"(?:youtu\.be/|youtube\.com/(?:watch\?(?:[^#]*&)?v=|shorts/|embed/|live/|v/))([\w-]{11})")
APPLE = re.compile(r"podcasts\.apple\.com/.*?/id(\d+)")
FEED = re.compile(r"(\.xml|\.rss|/feed|/rss)(/|\?|$)", re.IGNORECASE)


VENV = Path.home() / ".cache" / "skimcast" / "venv"


def bootstrap(extra: tuple = ()) -> None:
    """Eksik paketleri sistem Python'unu kirletmeden (ve 'externally-managed' hatasına takılmadan)
    özel bir venv'e kurar, betiği orada yeniden başlatır. Yalnızca ilk çalıştırmada olur.
    Aynı paket kümesi yeniden başlatmadan sonra hâlâ eksikse (sonsuz döngü olmasın) hata verir."""
    import subprocess

    tag = ",".join(extra) or "temel"
    tried = os.environ.get("SKIMCAST_BOOTSTRAPPED", "").split(";")
    if tag in tried:
        raise SkimError("Gerekli paketler kurulamadı. Elle deneyin: "
                        f"{sys.executable} -m pip install -r {Path(__file__).with_name('requirements.txt')} {' '.join(extra)}")

    note("Gerekli paketler kuruluyor (bir kerelik, ~1 dk)…")
    try:
        if not VENV.exists():
            subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)
        py = VENV / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
        req = Path(__file__).with_name("requirements.txt")
        subprocess.run([str(py), "-m", "pip", "install", "-q", "--disable-pip-version-check", "-r", str(req), *extra], check=True)
    except (subprocess.CalledProcessError, OSError) as e:
        raise SkimError(f"Paket kurulumu başarısız ({e}). İnternet bağlantınızı kontrol edin.") from e
    os.environ["SKIMCAST_BOOTSTRAPPED"] = ";".join([*tried, tag])
    os.execv(str(py), [str(py), str(Path(__file__).resolve()), *sys.argv[1:]])


class SkimError(Exception):
    """Kullanıcıya olduğu gibi gösterilen, anlaşılır hata."""


@dataclass
class Transcript:
    title: str
    method: str
    segments: list = field(default_factory=list)  # (saniye, metin)
    duration: float = 0.0
    link_prefix: str = ""  # zaman damgası bağlantısı için, ör. https://youtu.be/ID?t=
    timestamps: bool = True  # web sayfası metninde zaman damgası yoktur


def note(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def fmt_time(sec: float) -> str:
    sec = int(sec)
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


# ---------------------------------------------------------------- ağ ve ayrıştırma
def _ssl_context():
    """python.org'un macOS Python'unda sistem sertifikaları yoktur; certifi (bağımlılıklarla gelir) varsa onu kullan."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return None


def fetch(url: str, retries: int = 3) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=_ssl_context()) as r:
                return r.read().decode(r.headers.get_content_charset() or "utf-8", "replace")
        except OSError as e:
            permanent = isinstance(e, urllib.error.HTTPError) and e.code < 500 and e.code != 429
            if permanent or attempt == retries - 1:
                raise SkimError(f"Bağlantı kurulamadı ({url[:60]}…): {e}") from e
            time.sleep(2**attempt)
    raise AssertionError("ulaşılamaz")


def _seconds(stamp: str) -> float:
    parts = [float(p) for p in stamp.replace(",", ".").split(":")]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def parse_subtitles(text: str) -> list:
    """SRT/VTT metnini [(saniye, metin)] listesine çevirir; kayan altyazı tekrarlarını eler."""
    segs, cur_t, lines, prev = [], None, [], []
    time_re = re.compile(r"((?:\d+:)?\d+:\d+[.,]\d+)\s*-->")

    def flush():
        nonlocal cur_t, lines, prev
        if cur_t is not None:
            # kayan altyazıda bir önceki kutunun son satırları bu kutunun başında tekrarlanır
            k = max((k for k in range(len(lines) + 1) if k <= len(prev) and lines[:k] == prev[len(prev) - k:]), default=0)
            line = " ".join(lines[k:]).strip()
            if line:
                segs.append((cur_t, line))
            prev = lines
        cur_t, lines = None, []

    for raw in text.splitlines():
        m = time_re.search(raw)
        if m:
            flush()
            cur_t = _seconds(m.group(1))
        elif cur_t is not None:
            line = re.sub(r"<[^>]+>", "", raw).strip()
            if not line:
                flush()
            elif not line.isdigit():
                lines.append(line)
    flush()
    return segs


def parse_podcast_json(text: str) -> list:
    data = json.loads(text)
    return [(float(s.get("startTime", 0)), s.get("body", "")) for s in data.get("segments", [])]


def to_blocks(segments: list) -> list:
    """Kısa parçaları ~30 sn'lik, '[mm:ss] metin' biçiminde bloklara birleştirir."""
    blocks, start, buf = [], None, []
    for t, text in segments:
        text = " ".join(str(text).split())
        if not text:
            continue
        if start is None:
            start = t
        buf.append(text)
        span = t - start
        if span >= BLOCK_SECONDS and (text[-1] in ".!?…" or span >= 2 * BLOCK_SECONDS):
            blocks.append(f"[{fmt_time(start)}] {' '.join(buf)}")
            start, buf = None, []
    if buf:
        blocks.append(f"[{fmt_time(start)}] {' '.join(buf)}")
    return blocks


# ---------------------------------------------------------------- kaynaklar
def youtube_id(url: str):
    m = YT_ID.search(url)
    return m.group(1) if m else None


def _pick_track(tracks: list, langs: list):
    """Elle yazılmış altyazı > otomatik; aynı grupta tercih edilen dil sırası (langs) kazanır."""
    base = lambda t: t.language_code.split("-")[0]
    rank = lambda t: langs.index(base(t)) if base(t) in langs else len(langs)
    for pred in (
        lambda t: not t.is_generated and base(t) in langs,
        lambda t: not t.is_generated,
        lambda t: t.is_generated and base(t) in langs,
        lambda t: True,
    ):
        found = [t for t in tracks if pred(t)]
        if found:
            return min(found, key=rank)
    return None


def from_youtube(video_id: str, langs: list) -> Transcript:
    from youtube_transcript_api import YouTubeTranscriptApi

    track = _pick_track(list(YouTubeTranscriptApi().list(video_id)), langs)
    if track is None:
        raise SkimError("Bu videoda altyazı yok.")
    segs = [(s.start, s.text) for s in track.fetch()]
    kind = "otomatik" if track.is_generated else "elle"
    title = ""
    try:
        oembed = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
        title = json.loads(fetch(oembed, retries=2)).get("title", "")
    except (SkimError, ValueError):
        pass
    duration = segs[-1][0] if segs else 0.0  # yaklaşık: son altyazının başlangıcı
    return Transcript(
        title, f"youtube-altyazı ({track.language_code}, {kind})", segs, duration,
        f"https://youtu.be/{video_id}?t=",
    )


class _Silent:
    """yt-dlp'nin kendi ERROR/WARNING çıktısını bastırır; hatalar istisna olarak ele alınır."""

    def debug(self, msg): ...
    def warning(self, msg): ...
    def error(self, msg): ...


def _ydl(**extra):
    from yt_dlp import YoutubeDL

    opts = {"quiet": True, "no_warnings": True, "noprogress": True, "logger": _Silent(),
            "socket_timeout": TIMEOUT, "retries": 5, "extractor_retries": 3}
    return YoutubeDL({**opts, **extra})


def from_ytdlp(url: str, langs: list, model: str) -> Transcript:
    """yt-dlp'nin desteklediği 1000+ site: önce site altyazısı, yoksa ses + deşifre."""
    with _ydl() as y:
        info = y.extract_info(url, download=False) or {}
    title, duration = info.get("title") or "", float(info.get("duration") or 0)
    for source, label in (("subtitles", "elle"), ("automatic_captions", "otomatik")):
        tracks = info.get(source) or {}
        keys = [k for lang in langs for k in tracks if k.split("-")[0] == lang]
        if source == "subtitles":  # elle yazılmış altyazı hangi dilde olursa olsun kabul edilir
            keys += [k for k in tracks if k not in keys]
        for key in keys:
            entry = next((e for e in tracks[key] if e.get("ext") in ("vtt", "srt")), None)
            segs = parse_subtitles(fetch(entry["url"])) if entry else []
            if segs:
                return Transcript(title, f"site-altyazısı ({key}, {label})", segs, duration)
    return whisper(url, model, title, duration)


def _rss_item(feed_url: str, audio_hint, title_hint, index: int):
    root = ET.fromstring(fetch(feed_url))
    items = root.findall("./channel/item")
    if not items:
        raise SkimError("RSS'te bölüm bulunamadı.")
    norm = lambda u: (u or "").split("?")[0]
    for it in items:
        enc = it.find("enclosure")
        if (audio_hint and enc is not None and norm(enc.get("url")) == norm(audio_hint)) or (
            title_hint and (it.findtext("title") or "").strip() == title_hint.strip()
        ):
            return it
    if audio_hint or title_hint:
        raise SkimError("Linkteki bölüm RSS'te bulunamadı (çok eski olabilir). Podcast'in RSS linkini "
                        "ve --episode N ile deneyin.")
    if index >= len(items):
        raise SkimError(f"RSS'te yalnızca {len(items)} bölüm var.")
    return items[index]


def from_feed(feed_url: str, model: str, audio_hint=None, title_hint=None, index: int = 0) -> Transcript:
    item = _rss_item(feed_url, audio_hint, title_hint, index)
    title = (item.findtext("title") or "").strip()
    prefer = ["text/vtt", "application/srt", "application/x-subrip", "application/json", "text/plain"]
    # Feed'ler podcast ad alanını farklı adreslerle tanımlıyor; yalnızca yerel ada bakılır
    tags = [e for e in item if e.tag.rsplit("}", 1)[-1] == "transcript" and e.get("url")]
    tags.sort(key=lambda e: prefer.index(e.get("type")) if e.get("type") in prefer else 99)
    for tag in tags:
        try:
            body = fetch(tag.get("url"))
            segs = parse_podcast_json(body) if "json" in (tag.get("type") or "") else parse_subtitles(body)
            if not segs and (tag.get("type") or "").startswith("text/plain"):
                segs = [(0.0, body)]
            if segs:
                return Transcript(title, f"podcast-transcript-etiketi ({tag.get('type')})", segs)
        except (SkimError, ValueError):
            continue
    enc = item.find("enclosure")
    if enc is None or not enc.get("url"):
        raise SkimError("Bu bölümde ses dosyası bulunamadı.")
    return whisper(enc.get("url"), model, title, 0.0)


def from_apple(url: str, model: str) -> Transcript:
    show_id = APPLE.search(url).group(1)
    ep = urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get("i", [None])[0]
    store = re.search(r"podcasts\.apple\.com/([a-z]{2})/", url)
    country = f"&country={store.group(1)}" if store else ""
    data = json.loads(fetch(f"https://itunes.apple.com/lookup?id={show_id}&entity=podcastEpisode&limit=200{country}"))
    results = data.get("results", [])
    feed = next((r.get("feedUrl") for r in results if r.get("feedUrl")), None)
    episodes = [r for r in results if r.get("wrapperType") == "podcastEpisode"]
    chosen = next((r for r in episodes if str(r.get("trackId")) == ep), None) if ep else next(iter(episodes), None)
    if not feed or not chosen:
        raise SkimError("Apple Podcasts kaydı bulunamadı." if not ep or not episodes else
                        "Linkteki bölüm Apple'ın döndürdüğü son 200 bölüm içinde yok; podcast'in RSS linkini deneyin.")
    return from_feed(feed, model, chosen.get("episodeUrl"), chosen.get("trackName"))


def from_webpage(url: str, method: str = "web-sayfası") -> Transcript:
    import trafilatura

    html = trafilatura.fetch_url(url)
    text = trafilatura.extract(html, include_tables=True) if html else None
    if not text or len(text) < MIN_PAGE_CHARS:  # birkaç satırlık kırıntı gerçek içerik değildir
        raise SkimError("Sayfadan okunabilir metin çıkarılamadı (giriş gerektiriyor olabilir).")
    meta = trafilatura.extract_metadata(html)
    return Transcript((meta.title if meta else "") or "", method, [(0.0, text)], 0.0, "", False)


def whisper(source: str, model_size: str, title: str, duration: float) -> Transcript:
    """Son çare: sesi indirip yerel deşifre. Yavaştır; ilerleme gösterilir."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        note("Bu içerikte hazır transcript yok; sesten deşifre için faster-whisper kuruluyor (bir kerelik)…")
        bootstrap(("faster-whisper",))  # başarılıysa süreç yeniden başlar; dönmez
        raise
    with tempfile.TemporaryDirectory() as tmp:
        path = source
        if not Path(source).is_file():
            note("Ses indiriliyor…")
            with _ydl(format="bestaudio/best", outtmpl=f"{tmp}/%(id)s.%(ext)s") as y:
                path = y.prepare_filename(y.extract_info(source, download=True))
        est = f" (~{fmt_time(duration / 4)} sürebilir)" if duration else ""
        note(f"Hazır transcript yok; yerel deşifre başlıyor ({model_size}){est}. Sabırlı olun…")
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        gen, info = model.transcribe(path, vad_filter=True)
        segs, last = [], 0.0
        for s in gen:
            if s.text.strip():
                segs.append((s.start, s.text.strip()))
            if s.end - last >= 300:
                note(f"  deşifre: {fmt_time(s.end)} / {fmt_time(info.duration)}")
                last = s.end
    if not segs:
        raise SkimError("Seste konuşma bulunamadı (müzik/ortam sesi olabilir); özetlenecek metin yok.")
    return Transcript(title, f"whisper-{model_size}", segs, float(info.duration))


def get_transcript(target: str, langs: list, model: str, episode: int) -> Transcript:
    if Path(target).expanduser().is_file():
        return whisper(str(Path(target).expanduser()), model, Path(target).stem, 0.0)
    if not re.match(r"https?://", target):
        raise SkimError("Geçerli bir link (http…) ya da var olan bir dosya yolu verin.")
    host = urllib.parse.urlparse(target).netloc.lower()
    if "spotify.com" in host:
        raise SkimError(
            "Spotify içeriği korumalıdır (DRM) ve desteklenmez. Aynı podcast'in Apple Podcasts "
            "veya RSS linkini kullanın."
        )
    vid = youtube_id(target)
    if vid:
        try:
            return from_youtube(vid, langs)
        except Exception as e:
            if isinstance(e, SkimError) and "altyazı yok" not in str(e):
                raise
            note(f"YouTube altyazısı alınamadı ({type(e).__name__}); yt-dlp deneniyor…")
    if APPLE.search(target):
        return from_apple(target, model)
    if FEED.search(target):
        return from_feed(target, model, index=episode)
    try:
        return from_ytdlp(target, langs, model)
    except SkimError:
        raise
    except Exception as e:  # noqa: BLE001 - yt-dlp hata türleri çeşitli
        # Medya bulunamadı (ör. makale sayfası ya da yt-dlp'nin o siteyi çözemediği durum):
        # sayfanın yazılı metnini dene; o da olmazsa asıl hatayı göster.
        note(f"Sayfada video/ses alınamadı ({str(e).splitlines()[0][:80]}); sayfa metni deneniyor…")
        try:
            return from_webpage(target, "web-sayfası (medya alınamadı: BU VİDEO/SES TRANSKRİPTİ DEĞİL)")
        except SkimError:
            reason = str(e).splitlines()[0][:200]
            hint = "" if "404" in reason else f". yt-dlp eski olabilir: {VENV}/bin/pip install -U yt-dlp"
            raise SkimError(f"İçerik alınamadı: {reason}{hint}") from e


# ---------------------------------------------------------------- çıktı
def split_long(text: str, limit: int) -> list:
    """Tek başına sınırı aşan metni (ör. makale) satır/boşluk sınırlarından parçalara böler."""
    pieces = []
    while len(text) > limit:
        cut = text.rfind("\n", 0, limit)
        if cut <= 0:
            cut = text.rfind(" ", 0, limit)
        if cut <= 0:
            cut = limit
        pieces.append(text[:cut].rstrip())
        text = text[cut:].lstrip()
    return [*pieces, text]


def emit(t: Transcript, target: str, out: Path) -> None:
    """Transcript'i diske yazar, üst bilgi + (kısaysa) metni ya da parça listesini basar."""
    out.mkdir(parents=True, exist_ok=True)
    blocks = to_blocks(t.segments) if t.timestamps else [t.segments[0][1]]
    text = "\n".join(blocks)
    (out / "transcript.txt").write_text(text, encoding="utf-8")
    parts, cur, size = [], [], 0
    for b in (piece for block in blocks for piece in split_long(block, PART_CHARS)):
        if cur and size + len(b) > PART_CHARS:
            parts.append("\n".join(cur))
            cur, size = [], 0
        cur.append(b)
        size += len(b) + 1
    parts.append("\n".join(cur))
    files = []
    if len(text) > PART_CHARS:
        for i, p in enumerate(parts, 1):
            f = out / f"part-{i:02d}.txt"
            f.write_text(p, encoding="utf-8")
            files.append(str(f))
    meta = {"title": t.title, "source": target, "method": t.method, "duration": fmt_time(t.duration) if t.duration else "",
            "link_prefix": t.link_prefix, "chars": len(text), "parts": files}
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    print_result(meta, text)


def print_result(meta: dict, text: str) -> None:
    print("=== SKIMCAST TRANSCRIPT ===")
    for k in ("title", "source", "method", "duration", "link_prefix", "chars"):
        if meta.get(k):
            print(f"{k}: {meta[k]}")
    if meta["parts"]:
        print(f"parts: {len(meta['parts'])} (transcript uzun; her parçayı sırayla Read ile okuyun)")
        print("===")
        print("\n".join(meta["parts"]))
    else:
        print("===")
        print(text)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Link ver, zaman damgalı transcript al.")
    ap.add_argument("target", help="video/podcast/makale linki ya da yerel ses/video dosyası")
    ap.add_argument("--lang", default="tr,en", help="tercih edilen altyazı dilleri (varsayılan: tr,en)")
    ap.add_argument("--whisper-model", default="small", help="yedek deşifre modeli (tiny/base/small/medium)")
    ap.add_argument("--episode", type=int, default=0, help="RSS'te kaçıncı bölüm (0 = en yeni)")
    ap.add_argument("--fresh", action="store_true", help="önbelleği yok say")
    a = ap.parse_args(argv)
    try:
        import trafilatura  # noqa: F401
        import youtube_transcript_api  # noqa: F401
        import yt_dlp  # noqa: F401
    except ImportError:
        try:
            bootstrap()
        except SkimError as e:
            print(f"HATA: {e}", file=sys.stderr)
            return 2
    langs = [x.strip().split("-")[0] for x in a.lang.split(",") if x.strip()]
    vid = youtube_id(a.target)
    key = f"{'yt:' + vid if vid else a.target}|{a.episode}|{','.join(langs)}|{a.whisper_model}"
    out = Path(tempfile.gettempdir()) / "skimcast" / hashlib.sha1(key.encode()).hexdigest()[:12]
    try:
        if not a.fresh and (out / "meta.json").exists() and (out / "transcript.txt").exists():
            meta = json.loads((out / "meta.json").read_text(encoding="utf-8"))
            if all(Path(f).exists() for f in meta["parts"]):  # geçici klasör temizlenmiş olabilir
                note("(önbellekten)")
                print_result(meta, (out / "transcript.txt").read_text(encoding="utf-8"))
                return 0
        emit(get_transcript(a.target, langs, a.whisper_model, a.episode), a.target, out)
        return 0
    except SkimError as e:
        print(f"HATA: {e}", file=sys.stderr)
        return 2
    except Exception as e:  # noqa: BLE001 - kullanıcı traceback yerine kısa mesaj görsün
        print(f"HATA: beklenmeyen sorun ({type(e).__name__}): {str(e).splitlines()[0][:200] if str(e) else ''}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("Durduruldu.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
