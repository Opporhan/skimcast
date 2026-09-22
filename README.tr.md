# skimcast

**Linki yapıştır, zaman damgalı özeti al.** YouTube videosu, podcast, video sitesi veya makaleden transcript çıkarıp özetleyen bir [Claude Code](https://claude.com/claude-code) plugin'i. API anahtarı yok, n8n yok, ek maliyet yok.

```
/skimcast:summarize https://www.youtube.com/watch?v=rb7TVW77ZCs
```

→ genel bir özet ve altında **tıklanabilir `[dd:ss]` bağlantılı**, dakikalara göre kronolojik döküm. 4 dakikalık video ~20 sn, 1,5 saatlik podcast ~40 sn. Gerçek çıktılar: [YouTube örneği](docs/example-youtube.md) · [90 dakikalık podcast örneği](docs/example-podcast.md).

## Kurulum

```
/plugin marketplace add Opporhan/skimcast
/plugin install skimcast@skimcast
```

İlk çalıştırmada gerekli paketler özel bir sanal ortama kurulur (`~/.cache/skimcast`, ~1 dk, tek sefer). Sistem Python'una dokunulmaz. Python 3.10+ gerekir (3.12 ve 3.14'te denendi).

## Ne okuyabilir

En hızlı kaynağı dener, otomatik yedeğe düşer:

| Girdi | Transcript nasıl bulunur |
|---|---|
| YouTube | Elle altyazı → otomatik altyazı (önce senin dilin) → yerel deşifre |
| Podcast (RSS, Apple Podcasts linki) | Bölümün `<podcast:transcript>` etiketi → yerel deşifre |
| yt-dlp'nin desteklediği siteler (1000+) | Site altyazısı → yerel deşifre |
| Makale / web sayfası | Ana metin çıkarımı |
| Yerel ses/video dosyası | Yerel deşifre (faster-whisper) |

Deşifre **kendi bilgisayarında** çalışır ve yalnızca hazır transcript yoksa devreye girer. Uzun seste yavaştır — Apple M2'de ölçüm: küçük `tiny` model gerçek sürenin yaklaşık 8 katı hızında, varsayılan `small` daha yavaş ama daha doğru. Özet, transcript'in nasıl elde edildiğini her zaman söyler; otomatik üretilmişse uyarır.

## Claude Desktop'ta kullan (terminal ve VS Code gerekmez)

skimcast bir [MCP](https://modelcontextprotocol.io) sunucusu da içerir; Claude masaüstü uygulamasına link yapıştırıp özet isteyebilirsin. Özeti yine Claude yazar, API anahtarı gerekmez.

1. Python 3.10+ kurulu değilse kur; GitHub'da **Code → Download ZIP** ile indirip kalıcı bir klasöre çıkar.
2. Claude Desktop'ta **Settings → Developer → Edit Config**'i aç ve ekle (gerçek yolu yaz; Windows'ta `python3` yerine `python`):

```json
{
  "mcpServers": {
    "skimcast": {
      "command": "python3",
      "args": ["/yol/skimcast/skills/summarize/mcp_server.py"]
    }
  }
}
```

3. Claude Desktop'ı yeniden başlat. İlk açılışta bağımlılıklar kurulur (~1 dk). Sonra sadece şunu yaz: *"Şu videoyu özetle: https://www.youtube.com/watch?v=…"*.

## Yapamadıkları (dürüstçe)

- **DRM'li / girişli içerik:** Spotify, Netflix, özel veya bölge kısıtlı videolar. Spotify yerine podcast'in Apple Podcasts ya da RSS linkini kullan.
- **yt-dlp'nin çözemediği siteler** (bazen bozulur; örn. TED). skimcast sayfa metnine düşer ve *"bu videonun transkripti DEĞİL"* diye işaretler.
- YouTube bulut/VPN IP'lerini engelleyebilir; kendi bilgisayarında çalıştır.
- "Ücretsiz": ek API anahtarı veya fatura yok; özeti kendi Claude Code oturumun yazar ve plan kullanımına sayılır.
- Okuduğun sitelerin kullanım şartlarına uy; kişisel kullanım içindir.

## Geliştirme

```
python3 -m venv .venv && .venv/bin/pip install -r skills/summarize/requirements.txt pytest ruff
.venv/bin/pytest -q && .venv/bin/ruff check .
claude --plugin-dir .          # yerelde dene
```

MIT lisanslı.
