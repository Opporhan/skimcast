# skimcast — proje notları

Bu depoda iki AYRI ürün var, ortak kodları yok:

## 1) Claude Code plugin'i (`skills/summarize/`)

link → transcript → zaman damgalı özet. Kod bilinçli olarak **küçük** tutulur.

- `skills/summarize/transcript.py`: tek dosya, transcript aracı. Basamaklı yedek zinciri (YouTube altyazı → podcast etiketi →
  yt-dlp altyazı → web sayfası → whisper). Eksik paketi özel venv'e (`~/.cache/skimcast/venv`) kendisi kurar.
- `skills/summarize/mcp_server.py`: Claude Desktop için ince MCP sarmalayıcı (`get_transcript` aracı, `transcript.load`'u kullanır; `mcp<2` sabitli, v2'de FastMCP yeniden adlandırıldı).
- `skills/summarize/SKILL.md`: özetin biçimi ve kalite kuralları (özet Claude Code tarafından yazılır; ayrı LLM yok).
- Testler: `.venv/bin/pytest -q`, lint: `.venv/bin/ruff check .`; plugin: `claude plugin validate .`.
- Ağ/yt-dlp/whisper testlerde mock'lanır; gerçek denemeler elle yapılır.
- Kapsamı büyütme: önbellek/devam altyapısı, doğrulayıcı, RSS izleme gibi şeyler bilinçli olarak dışarıda bırakıldı.
- Podcast `<podcast:transcript>` etiketi yerel adla aranır (feed'ler ad alanını farklı adreslerle tanımlıyor).

## 2) Tarayıcı uzantısı (`extension/`)

Chrome/Edge uzantısı: link → aranabilir, tıkla-git yapılabilir transcript görüntüleyici + kişisel arşiv.
**Özetleme YOK** — bir gece süren Groq (ücretsiz LLM) kota/güvenilirlik sorunlarından sonra bilinçli olarak
terk edildi (bkz. git geçmişi); bunun yerine sağlam çalışan transcript-çekme parçası üzerine inşa edildi.

- `background.js`: transcript çekme (YouTube için `skills/summarize/native_host.py`'ye native messaging;
  podcast RSS/Apple/web sayfası doğrudan JS fetch ile), arşive kaydetme, sağ tık menüsü, YouTube açıklamasından
  bölüm (chapter) tespiti (`fetchYoutubeChapters`, best-effort), videoyla-senkron mesaj yönlendirme (relay).
- `youtube_sync.js`: YouTube izleme sayfasına enjekte edilen içerik betiği — video oynatma zamanını
  `background.js`'e bildirir (kimlik doğrulama gerektirmez, sadece "hangi video, kaçıncı saniye").
- `viewer.js`: transcript'i gösterir — arama, tıkla-git, bölümler arası atlama, olası reklam tespiti, favori
  (yıldız + klasöre taşıma), videoyla senkron takip ("🔗", kelime kelime yaklaşık vurgu), sesli okuma
  (Web Speech API, kelime kelime GERÇEK vurgu — `boundary` olayı), video notu (paylaşılan Notlarım deposuna
  yazar), cihaz üzerinde çeviri (`Translator`/`LanguageDetector` API, ücretsiz, API anahtarsız), TXT/PDF
  indirme (PDF: `vendor/jspdf.umd.min.js` + Türkçe karakterler için gömülü font).
- `library.js`: kütüphane — "Dosyalarım"/"Notlarım" iki sekme; Dosyalarım'da klasörler (özel ikon/görsel,
  not, sabitleme), arama, favoriler, "bunu hatırlıyor musun?" hatırlatma kartı; Notlarım'da birleşik not
  sistemi (`skimcastNotes` — video notu/favori notu/serbest not hepsi burada, isteğe bağlı kaynak bağlantısı
  ve alıntıyla); yedekleme/geri yükleme (notlar dahil), Markdown dışa aktarma.
- `theme.js` / `lang.js`: paylaşılan tema (açık/koyu) ve arayüz dili (TR/EN, tarayıcı dilinden bağımsız).
- Testler: `extension/test.mjs` (saf mantık fonksiyonları) — `node extension/test.mjs`.
- İki ürün arasında kod paylaşımı yok; `skills/summarize/native_host.py` sadece extension'ın YouTube
  transcript kaynağı olarak kullanılıyor, Claude'a hiç istek atmıyor.
- **TUZAK:** `extension/` klasöründe (ya da içindeki bir dosyayı hedefleyerek) `python3 -m py_compile`
  veya benzeri bytecode-üreten bir komut ÇALIŞTIRMA — `extension/__pycache__/` oluşturur, Chrome/Edge
  "_" ile başlayan dosya/klasör adlarını reddettiği için uzantı hiç yüklenemez ("Cannot load extension
  with file or directory name __pycache__"). Bir kere gerçekten oldu, kullanıcı "uzantı görünmüyor"
  diye şaşırdı. Python syntax kontrolü gerekiyorsa `python3 -c "compile(open('dosya').read(), 'x', 'exec')"`
  kullan (bytecode dosyaya yazmaz), ya da işi bitince `rm -rf extension/__pycache__` çalıştır.
