#!/usr/bin/env python3
"""skimcast MCP sunucusu: Claude Desktop gibi terminalsiz istemcilerde link -> transcript aracı.

Özeti istemcideki Claude yazar (ayrı LLM ya da API anahtarı yok); bu sunucu yalnızca transcript'i getirir.
Eksik paketleri transcript.py ile aynı özel venv'e kurar (ilk açılışta ~1 dk sürebilir).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import transcript as tr

try:
    import mcp  # noqa: F401
    import trafilatura  # noqa: F401
    import youtube_transcript_api  # noqa: F401
    import yt_dlp  # noqa: F401
except ImportError:
    try:
        tr.bootstrap(("mcp>=1.2,<2",))  # başarılıysa süreç yeniden başlar; dönmez
    except tr.SkimError as e:
        print(f"HATA: {e}", file=sys.stderr)
        sys.exit(2)

from mcp.server.fastmcp import FastMCP


def _rules() -> str:
    skill = (Path(__file__).with_name("SKILL.md")).read_text(encoding="utf-8")
    body = skill[skill.index("## 2."):]  # kaynak güvenilirliği + özet biçimi + kalite kuralları
    return (
        "Kullanıcı bir video/podcast/makale linki verip özet isterse get_transcript aracını çağır. "
        "Çıktı uzunsa 'part' değerini artırarak tüm parçaları sırayla al. Sonra aşağıdaki kurallarla özeti yaz "
        "(kural metninde geçen 'transcript.py', 'Read' ve parça dosyaları bu ortamda yok; get_transcript çıktısını kullan).\n\n"
        + body
    )


server = FastMCP("skimcast", instructions=_rules())


@server.tool()
def get_transcript(url: str, part: int = 1, lang: str = "tr,en", whisper_model: str = "small", episode: int = 0) -> str:
    """Bir YouTube/podcast/web videosu, makale linkinin (ya da yerel ses/video dosyasının) zaman damgalı transcript'ini döndürür.

    Uzun içerikte metin parçalara bölünür: part=1 ile başla, yanıtta belirtilen toplam parçaya kadar artır.
    lang: tercih edilen altyazı dilleri; episode: RSS'te kaçıncı bölüm (0 = en yeni).
    """
    langs = [x.strip().split("-")[0] for x in lang.split(",") if x.strip()]
    try:
        meta, text = tr.load(url, langs, whisper_model, episode)
    except tr.SkimError as e:
        return f"HATA: {e}"
    except Exception as e:  # noqa: BLE001 - istemciye traceback yerine kısa mesaj dön
        return f"HATA: beklenmeyen sorun ({type(e).__name__}): {str(e)[:200]}"
    parts = meta["parts"]
    if parts and not 1 <= part <= len(parts):
        return f"HATA: part 1 ile {len(parts)} arasında olmalı."
    head = [f"{k}: {meta[k]}" for k in ("title", "source", "method", "duration", "link_prefix", "chars") if meta.get(k)]
    if parts:
        head.append(f"part: {part}/{len(parts)}" + (f" (devamı için part={part + 1} ile tekrar çağır)" if part < len(parts) else " (son parça)"))
        text = Path(parts[part - 1]).read_text(encoding="utf-8")
    return "\n".join(head) + "\n===\n" + text


if __name__ == "__main__":
    server.run()
