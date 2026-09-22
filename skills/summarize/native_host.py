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
        meta, text = tr.load(msg["url"], langs, "small", 0)
        send_message({"ok": True, "meta": meta, "text": text})
    except tr.SkimError as e:
        send_message({"ok": False, "error": str(e)})
    except Exception as e:  # noqa: BLE001 - uzantıya traceback yerine kısa mesaj dön
        send_message({"ok": False, "error": f"Beklenmeyen hata ({type(e).__name__}): {e}"})


if __name__ == "__main__":
    main()
