# skimcast — proje notları

Claude Code plugin'i: link → transcript → zaman damgalı özet. Kod bilinçli olarak **küçük** tutulur.

- `skills/summarize/transcript.py`: tek dosya, transcript aracı. Basamaklı yedek zinciri (YouTube altyazı → podcast etiketi →
  yt-dlp altyazı → web sayfası → whisper). Eksik paketi özel venv'e (`~/.cache/skimcast/venv`) kendisi kurar.
- `skills/summarize/mcp_server.py`: Claude Desktop için ince MCP sarmalayıcı (`get_transcript` aracı, `transcript.load`'u kullanır; `mcp<2` sabitli, v2'de FastMCP yeniden adlandırıldı).
- `skills/summarize/SKILL.md`: özetin biçimi ve kalite kuralları (özet Claude Code tarafından yazılır; ayrı LLM yok).
- Testler: `.venv/bin/pytest -q`, lint: `.venv/bin/ruff check .`; plugin: `claude plugin validate .`.
- Ağ/yt-dlp/whisper testlerde mock'lanır; gerçek denemeler elle yapılır.
- Kapsamı büyütme: önbellek/devam altyapısı, doğrulayıcı, RSS izleme gibi şeyler bilinçli olarak dışarıda bırakıldı.
- Podcast `<podcast:transcript>` etiketi yerel adla aranır (feed'ler ad alanını farklı adreslerle tanımlıyor).
