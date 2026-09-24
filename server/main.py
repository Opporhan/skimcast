#!/usr/bin/env python3
"""skimcast sunucu: uzantının YouTube transcript isteklerini karşılayan küçük bir HTTP servisi.

Neden var: YouTube'un altyazı API'si artık tarayıcıdan (gerçek oturum/çerezle bile) çalışmıyor - bir
"proof of origin" token istiyor ki bunu yalnızca gerçek bir işletim sistemi etkileşimi üretebiliyor
(bkz. extension/background.js'teki açıklama). Eskiden bunu kullanıcının kendi bilgisayarında çalışan bir
Python "native messaging host"a (skills/summarize/native_host.py) havale ediyorduk - ama bu, her
kullanıcının Python kurup tek seferlik bir kurulum betiği çalıştırmasını şart koşuyordu. Sıradan
kullanıcılar (öğrenci/öğretmen) için bu engel kabul edilemez bulundu; bunun yerine transcript'i BURADA,
barındırılan bir sunucuda çekip uzantıya JSON olarak döndürüyoruz - kurulum gerektirmiyor.

Not: Bu, projenin "tamamen cihazda/yerel" mimarisinden TEK istisna - sadece YouTube transcript'inin
kendisi bu sunucudan geçiyor. Çeviri, sesli okuma, kütüphane, notlar vs. hâlâ tamamen kullanıcının
tarayıcısında/cihazında kalıyor; bu sunucu hiçbir şey saklamıyor, sadece anlık olarak transcript'i
YouTube'dan çekip iletiyor.

Yanıt biçimi, eski native_host.py ile AYNI (uzantı tarafında değişiklik minimum kalsın diye):
{ "ok": true, "meta": {...}, "text": "...", "blocks": [{"sec": .., "text": "..", "words": [[sec,text],..]}] }
"""

import os
import sys
import threading
import time
from pathlib import Path

from flask import Flask, jsonify, request

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "skills" / "summarize"))
import transcript as tr  # noqa: E402

app = Flask(__name__)

# Whisper (yerel ses deşifresi) burada kapalı: bu istek/yanıt döngüsü saniyeler içinde cevap vermeli,
# whisper CPU'da dakikalarca sürebilir (native_host.py'deki aynı gerekçe).
def _no_whisper(*_args, **_kwargs):
    raise tr.SkimError(
        "Bu videoda hazır altyazı yok. Yerel deşifre gerektiriyor, bu servis onu desteklemiyor."
    )


tr.whisper = _no_whisper

# ---------------------------------------------------------------------------------- basit kota koruması
# Herkese açık bir uç nokta olduğu için (kimlik doğrulama yok) art niyetli/otomatik aşırı istek trafiğine
# karşı çok basit, bellek-içi bir IP başına limit. Kalıcı/dağıtık bir çözüm değil (her Cloud Run örneği
# kendi sayacını tutar, soğuk başlangıçta sıfırlanır) - amaç mükemmel bir rate-limiter değil, kazara/kötü
# niyetli aşırı kullanımın faturayı büyütmesini engelleyen ucuz bir emniyet supabı.
RATE_LIMIT = 30  # IP başına pencere içinde izin verilen istek
RATE_WINDOW = 600  # saniye (10 dk)
_hits: dict[str, list[float]] = {}
_hits_lock = threading.Lock()


def rate_limited(ip: str) -> bool:
    now = time.time()
    with _hits_lock:
        recent = [t for t in _hits.get(ip, []) if now - t < RATE_WINDOW]
        recent.append(now)
        _hits[ip] = recent
        return len(recent) > RATE_LIMIT


# native_host.py'deki blocks_with_words()'ün BİREBİR kopyası (bkz. oradaki yorum: transcript.py'nin
# to_blocks()'uyla aynı ~30sn birleştirme mantığı, ek olarak her gösterim bloğunun içine giren ham
# segmentleri de saklıyor - videoyla kelime kelime senkron takip için gerekli).
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


@app.route("/transcript")
def transcript_endpoint():
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "?").split(",")[0].strip()
    if rate_limited(ip):
        return jsonify({"ok": False, "error": "Çok fazla istek. Birkaç dakika sonra tekrar dene."}), 429

    url = request.args.get("url", "")
    if not url:
        return jsonify({"ok": False, "error": "Geçersiz istek: url eksik."}), 400
    langs = [x.strip().split("-")[0] for x in request.args.get("lang", "tr,en").split(",") if x.strip()]

    try:
        t = tr.get_transcript(url, langs, "small", 0)
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
        return jsonify({"ok": True, "meta": meta, "text": text, "blocks": blocks})
    except tr.SkimError as e:
        return jsonify({"ok": False, "error": str(e)}), 200
    except Exception as e:  # noqa: BLE001 - uzantıya traceback yerine kısa mesaj dön
        return jsonify({"ok": False, "error": f"Beklenmeyen hata ({type(e).__name__}): {e}"}), 200


@app.route("/")
def health():
    return jsonify({"ok": True, "service": "skimcast-server"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
