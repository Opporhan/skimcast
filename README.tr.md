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

## Tarayıcı uzantısı

`extension/` bu depoda ayrı, kendi başına bir ürün: herhangi bir YouTube videosunu, podcast bölümünü ya da makaleyi aranabilir, tıkla-git yapılabilir bir transcript'e çeviren bir Chrome/Edge uzantısı — özet yok, LLM yok, API anahtarı yok. Her şey (kütüphane, notlar, çeviri, sesli okuma) cihazında çalışır; tek istisna YouTube videosunun transcript'ini çekme adımı — bunu barındırılan küçük bir sunucu üzerinden yapıyoruz (bkz. `server/`), çünkü YouTube bu isteği tarayıcıdan doğrudan engelliyor; senin tarafında hiçbir kurulum gerekmiyor.

```
Bir videoya sağ tıkla (ya da popup'a linki yapıştır) → transcript yeni bir sekmede açılır
```

- **Oku ve gez** — transcript içinde ara, herhangi bir zaman damgasına tıklayınca video o saniyeden açılır, bölümler arası atla (video açıklamasından otomatik tespit edilir), zaman damgalarını açıp kapat, açık/koyu tema.
- **Videoyla senkron takip** — videoyu kendi YouTube sekmesinde izlerken transcript kendiliğinden kayar, o an konuşulan satırı (ve kelime kelime, tam kelimeyi) vurgular.
- **Sesli okuma** — cihaz üzerinde, paragraf paragraf ya da istediğin satırdan başlayarak, kelime kelime sarı vurguyla.
- **Kişisel kütüphane** — getirdiğin her transcript yerelde saklanır; videoları, favori satırları ve bağımsız notları klasörlere ayır (kendi ikonun ya da yüklediğin bir görselle), önemli satırları yıldızla, getirdiğin her şeyde arama yap. "Bunu hatırlıyor musun?" kartı ara sıra eski bir favoriyi hatırlatır.
- **Notlar** — tek, birleşik bir not sistemi: bir videonun tamamına, tek bir satırına ya da tamamen bağımsız bir konuya not al — hepsi aynı "Notlarım" sekmesinde, kendi ikonuyla.
- **Cihaz üzerinde çeviri** — Chrome'un yerleşik Translator API'siyle transcript 9 dile çevrilir, tamamen çevrimdışı, kota yok.
- **Dışa aktar** — kopyala, `.txt` ya da gerçek bir `.pdf` olarak indir (Türkçe karakterler gömülü bir fontla doğru görünüyor), ya da bir klasörü Obsidian/Notion için Markdown olarak dışa aktar.
- **Yedekle** — tüm kütüphanen (klasörler, favoriler, videolar, notlar) tek bir dosyada; başka bir bilgisayarda geri yükle.
- **Arayüz dili** — uzantının kendi arayüz dilini tarayıcı dilinden bağımsız olarak Türkçe/İngilizce değiştir.

### Kurulum (paketlenmemiş, mağazada değil)

1. `chrome://extensions` (ya da `edge://extensions`) aç, **Geliştirici modu**'nu aç, **Paketlenmemiş öğe yükle**'ye tıkla, `extension/` klasörünü seç.
2. Herhangi bir YouTube/podcast/makale sayfasında araç çubuğu simgesine tıkla, ya da sayfaya sağ tıklayıp **skimcast: Transcript'i Getir**'i seç.

Python yok, yerel kurulum yok — sadece klasörü yükle. Bu, yukarıdaki Claude Code plugin'inden ayrı bir kod tabanı — uzantı hiçbir zaman Claude'a ya da bir LLM'e istek atmaz; plugin de tarayıcıya hiç dokunmaz.

## Geliştirme

```
python3 -m venv .venv && .venv/bin/pip install -r skills/summarize/requirements.txt pytest ruff
.venv/bin/pytest -q && .venv/bin/ruff check .
claude --plugin-dir .          # yerelde dene
```

MIT lisanslı.
