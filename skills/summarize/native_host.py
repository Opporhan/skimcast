#!/usr/bin/env python3
"""skimcast native messaging host (Chrome uzantısı için).

Sürekli çalışan bir süreç DEĞİLDİR: Chrome, uzantı `chrome.runtime.sendNativeMessage` çağırdığında bu
betiği anlık olarak başlatır, tek bir isteği stdin'den okur, cevabı stdout'a yazar ve süreç kendiliğinden
biter. Böylece kullanıcının elle başlatıp açık tutması gereken bir sunucu olmuyor.

Asıl iş transcript.py'ye ait (youtube_transcript_api / yt-dlp): tarayıcıdan doğrudan erişilemeyen
(YouTube'un "proof of origin" bot koruması nedeniyle) transcript API'sine buradan, gerçek bir Python
süreci olarak ulaşılıyor — kimlik taklidi ya da koruma atlatma yok, kütüphane zaten bu şekilde çalışıyor.

Kurulum: extension/install_native_host.py (tek seferlik, native messaging host kaydı).
Protokol: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging (4 baytlık
küçük-endian uzunluk + UTF-8 JSON, hem giriş hem çıkışta).
"""

import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import transcript as tr

# Uzantı etkileşimli bir arayüz: kullanıcı saniyeler içinde bir sonuç bekliyor. transcript.py'nin son
# çare yolu olan whisper (yerel ses deşifresi) CPU'da gerçek zamanlı ya da daha yavaş çalışıyor — uzun
# bir video için onlarca dakika sürüp "hiç bitmiyor" hissi verebilir. Bu yüzden burada whisper'ı kapatıp
# hazır altyazı yoksa hemen net bir hata veriyoruz (Claude Code + skimcast plugin'i whisper ile çalışır,
# orada bekleme zaten beklenen ve ilerleme gösteriliyor).
def _no_whisper(*_args, **_kwargs):
    raise tr.SkimError(
        "Bu videoda hazır altyazı yok. Yerel deşifre (whisper) dakikalarca sürebileceği için uzantıda "
        "kapalı. Hazır altyazısı olan başka bir video dene, ya da uzun deşifre için Claude Code + "
        "skimcast plugin'ini kullan."
    )


tr.whisper = _no_whisper


def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) < 4:
        return None
    length = struct.unpack("<I", raw_len)[0]
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def send_message(obj) -> None:
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


# transcript.py'nin to_blocks()'uyla AYNI ~30sn'lik birleştirme mantığının bir KOPYASI — transcript.py'ye
# (Claude Code plugin'iyle PAYLAŞILIYOR) dokunmuyoruz. Tek fark: her gösterim bloğunun içine giren HAM
# (ince taneli, YouTube'un kendi altyazı parçası başına bir tane) segmentleri de ayrıca saklıyoruz.
# Bunlar olmadan "videoyla senkron takip" bir bloğun (~30sn, birden fazla cümle) içindeki bir kelimenin
# yerini KABACA tahmin etmek zorunda kalıyordu — araya bir müzik/sessizlik girdiğinde bu tahmin anlamsız
# hale geliyordu ("araya müzik girince devam ediyor" şikayeti buradan geliyordu). Artık her kelime
# grubunun GERÇEK başlangıç saniyesi var; senkron, hangi ince segmentin o an okunduğunu tam olarak biliyor.
def blocks_with_words(segments, block_seconds=30):
    blocks = []
    start, buf_text, buf_words = None, [], []

    def flush():
        if buf_text:
            blocks.append({"sec": start, "text": " ".join(buf_text), "words": buf_words[:]})

    for t, text in segments:
        text = " ".join(str(text).split())
        if not text:
            continue
        if start is None:
            start = t
        buf_text.append(text)
        buf_words.append([t, text])
        span = t - start
        if span >= block_seconds and (text[-1] in ".!?…" or span >= 2 * block_seconds):
            flush()
            start, buf_text, buf_words = None, [], []
    flush()
    return blocks


def main() -> None:
    try:
        import trafilatura  # noqa: F401
        import youtube_transcript_api  # noqa: F401
        import yt_dlp  # noqa: F401
    except ImportError:
        try:
            tr.bootstrap()  # başarılıysa süreç yeniden başlar (execv); stdin/stdout Chrome'a bağlı kalır
        except tr.SkimError as e:
            send_message({"ok": False, "error": str(e)})
            return

    msg = read_message()
    if not msg or msg.get("action") != "getTranscript" or not msg.get("url"):
        send_message({"ok": False, "error": "Geçersiz istek."})
        return
    langs = [x.strip().split("-")[0] for x in msg.get("lang", "tr,en").split(",") if x.strip()]
    try:
        # tr.load() (disk önbelleği + parça dosyalarına bölme) yerine doğrudan get_transcript(): önbellek
        # sadece BLOKLANMIŞ metni tutuyor, kelime kelime senkron için gereken ince taneli zaman damgalarını
        # değil. Bedeli: aynı video tekrar getirilirse önbellekten değil, ağdan gelir — kabul edilebilir
        # (uzantının kendi arşivi zaten aynı videoyu gereksiz yere tekrar getirmeyi önlüyor).
        t = tr.get_transcript(msg["url"], langs, "small", 0)
        if t.timestamps:
            blocks = blocks_with_words(t.segments)
            text = "\n".join(f"[{tr.fmt_time(b['sec'])}] {b['text']}" for b in blocks)
        else:
            blocks = []
            text = t.segments[0][1] if t.segments else ""
        meta = {
            "title": t.title, "method": t.method,
            "duration": tr.fmt_time(t.duration) if t.duration else "",
            "link_prefix": t.link_prefix,
        }
        send_message({"ok": True, "meta": meta, "text": text, "blocks": blocks})
    except tr.SkimError as e:
        send_message({"ok": False, "error": str(e)})
    except Exception as e:  # noqa: BLE001 - uzantıya traceback yerine kısa mesaj dön
        send_message({"ok": False, "error": f"Beklenmeyen hata ({type(e).__name__}): {e}"})


if __name__ == "__main__":
    main()
