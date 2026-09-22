import importlib.util
import json
import types
from pathlib import Path

import pytest

_path = Path(__file__).parents[1] / "skills" / "summarize" / "transcript.py"
_spec = importlib.util.spec_from_file_location("transcript", _path)
tr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tr)

SRT = """1
00:00:01,000 --> 00:00:04,000
Merhaba arkadaşlar.

2
00:00:04,500 --> 00:00:09,000
Bugün <i>aşılardan</i> bahsedeceğiz.
"""

VTT_ROLLING = """WEBVTT

00:00:00.000 --> 00:00:02.000
first line

00:00:02.000 --> 00:00:04.000
first line

00:00:04.000 --> 00:00:06.000
<c>second</c> line
"""


def test_fmt_time():
    assert tr.fmt_time(65) == "01:05"
    assert tr.fmt_time(3725) == "1:02:05"


def test_parse_srt_strips_tags_and_numbers():
    assert tr.parse_subtitles(SRT) == [(1.0, "Merhaba arkadaşlar."), (4.5, "Bugün aşılardan bahsedeceğiz.")]


def test_parse_vtt_drops_rolling_duplicates():
    assert tr.parse_subtitles(VTT_ROLLING) == [(0.0, "first line"), (4.0, "second line")]


def test_blocks_group_about_30_seconds():
    segs = [(i * 5.0, f"cümle {i}.") for i in range(14)]  # 70 sn
    blocks = tr.to_blocks(segs)
    assert blocks[0].startswith("[00:00] cümle 0.") and len(blocks) >= 2
    assert blocks[1].startswith("[00:30]") or blocks[1].startswith("[00:35]")
    assert "cümle 13." in blocks[-1] and all(b.startswith("[") for b in blocks)


@pytest.mark.parametrize("url", [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5",
    "https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
])
def test_youtube_id(url):
    assert tr.youtube_id(url) == "dQw4w9WgXcQ"
    assert tr.youtube_id("https://example.com/watch?v=x") is None


def _track(code, generated):
    return types.SimpleNamespace(language_code=code, is_generated=generated)


def test_pick_track_prefers_manual_then_language():
    tracks = [_track("en", True), _track("de", False), _track("tr", True), _track("en", False)]
    assert (tr._pick_track(tracks, ["tr", "en"]).language_code, tr._pick_track(tracks, ["tr", "en"]).is_generated) == ("en", False)
    only_auto = [_track("en", True), _track("tr", True)]
    assert tr._pick_track(only_auto, ["tr", "en"]).language_code == "tr"
    assert tr._pick_track([], ["tr"]) is None


FEED = """<?xml version="1.0"?>
<rss xmlns:podcast="{ns}" version="2.0"><channel><title>Show</title>
<item><title>Bölüm 2</title><enclosure url="https://cdn/ep2.mp3?x=1" type="audio/mpeg"/>
  <podcast:transcript url="https://cdn/ep2.srt" type="application/srt"/></item>
<item><title>Bölüm 1</title><enclosure url="https://cdn/ep1.mp3" type="audio/mpeg"/></item>
</channel></rss>"""


@pytest.mark.parametrize("ns", [
    "https://podcastindex.org/namespace/1.0",
    "https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md",  # gerçek feed'lerde de var
])
def test_feed_transcript_tag_matches_any_namespace(monkeypatch, ns):
    bodies = {"https://x/feed.xml": FEED.format(ns=ns), "https://cdn/ep2.srt": SRT}
    monkeypatch.setattr(tr, "fetch", lambda url, retries=3: bodies[url])
    t = tr.from_feed("https://x/feed.xml", "small")
    assert t.title == "Bölüm 2" and t.method.startswith("podcast-transcript-etiketi")
    assert t.segments[0] == (1.0, "Merhaba arkadaşlar.")


def test_feed_without_tag_falls_back_to_whisper_on_the_right_episode(monkeypatch):
    monkeypatch.setattr(tr, "fetch", lambda url, retries=3: FEED.format(ns="https://podcastindex.org/namespace/1.0"))
    seen = {}
    monkeypatch.setattr(tr, "whisper", lambda src, model, title, dur: seen.update(src=src, title=title) or "w")
    assert tr.from_feed("https://x/feed.xml", "tiny", index=1) == "w"
    assert seen == {"src": "https://cdn/ep1.mp3", "title": "Bölüm 1"}


def test_feed_episode_index_out_of_range(monkeypatch):
    monkeypatch.setattr(tr, "fetch", lambda url, retries=3: FEED.format(ns="x"))
    with pytest.raises(tr.SkimError, match="yalnızca 2 bölüm"):
        tr.from_feed("https://x/feed.xml", "small", index=5)


def test_apple_link_resolves_episode_and_uses_feed_transcript(monkeypatch):
    lookup = {"results": [
        {"wrapperType": "track", "feedUrl": "https://x/feed.xml"},
        {"wrapperType": "podcastEpisode", "trackId": 111, "trackName": "Bölüm 1", "episodeUrl": "https://cdn/ep1.mp3"},
        {"wrapperType": "podcastEpisode", "trackId": 222, "trackName": "Bölüm 2", "episodeUrl": "https://cdn/ep2.mp3"},
    ]}
    bodies = {
        "https://itunes.apple.com/lookup?id=999&entity=podcastEpisode&limit=200&country=tr": json.dumps(lookup),
        "https://x/feed.xml": FEED.format(ns="https://podcastindex.org/namespace/1.0"),
        "https://cdn/ep2.srt": SRT,
    }
    monkeypatch.setattr(tr, "fetch", lambda url, retries=3: bodies[url])
    t = tr.from_apple("https://podcasts.apple.com/tr/podcast/show/id999?i=222", "small")
    assert t.title == "Bölüm 2" and t.segments


def test_routing_errors_are_clear():
    with pytest.raises(tr.SkimError, match="Spotify"):
        tr.get_transcript("https://open.spotify.com/episode/abc", ["tr"], "small", 0)
    with pytest.raises(tr.SkimError, match="Geçerli bir link"):
        tr.get_transcript("merhaba dünya", ["tr"], "small", 0)


def test_youtube_failure_falls_back_to_ytdlp(monkeypatch):
    def boom(*a):
        raise RuntimeError("engellendi")

    monkeypatch.setattr(tr, "from_youtube", boom)
    monkeypatch.setattr(tr, "from_ytdlp", lambda url, langs, model: "ytdlp-sonucu")
    assert tr.get_transcript("https://youtu.be/dQw4w9WgXcQ", ["tr"], "small", 0) == "ytdlp-sonucu"


def test_media_failure_falls_back_to_page_text_but_is_flagged(monkeypatch):
    def fail(*a):
        raise RuntimeError("Unsupported URL: x")

    monkeypatch.setattr(tr, "from_ytdlp", fail)
    seen = {}
    monkeypatch.setattr(tr, "from_webpage", lambda url, method="web-sayfası": seen.update(method=method) or "sayfa")
    assert tr.get_transcript("https://blog.example/yazi", ["tr"], "small", 0) == "sayfa"
    assert "TRANSKRİPTİ DEĞİL" in seen["method"]


def test_media_and_page_both_fail_reports_original_reason(monkeypatch):
    def fail(*a):
        raise RuntimeError("bölgesel kısıtlama")

    def no_text(url, method="x"):
        raise tr.SkimError("boş")

    monkeypatch.setattr(tr, "from_ytdlp", fail)
    monkeypatch.setattr(tr, "from_webpage", no_text)
    with pytest.raises(tr.SkimError, match="bölgesel kısıtlama"):
        tr.get_transcript("https://vid.example/v", ["tr"], "small", 0)


def test_tiny_page_text_is_rejected(monkeypatch):
    fake = types.SimpleNamespace(
        fetch_url=lambda url: "<html/>", extract=lambda html, **k: "kısa", extract_metadata=lambda html: None
    )
    monkeypatch.setitem(__import__("sys").modules, "trafilatura", fake)
    with pytest.raises(tr.SkimError, match="okunabilir metin"):
        tr.from_webpage("https://x")


def _transcript(n_blocks):
    segs = [(i * 40.0, f"Bu bir cümle numarası {i}. " * 3) for i in range(n_blocks)]
    return tr.Transcript("Başlık", "test", segs, 100.0, "https://youtu.be/ID?t=")


def test_emit_short_prints_whole_transcript(tmp_path, capsys):
    tr.print_result(*tr.write_output(_transcript(2), "https://x", tmp_path))
    out = capsys.readouterr().out
    assert "=== SKIMCAST TRANSCRIPT ===" in out and "link_prefix: https://youtu.be/ID?t=" in out
    assert "[00:00]" in out and "parts:" not in out
    assert json.loads((tmp_path / "meta.json").read_text())["parts"] == []


def test_emit_long_writes_parts_and_lists_them(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(tr, "PART_CHARS", 300)
    tr.print_result(*tr.write_output(_transcript(20), "https://x", tmp_path))
    out = capsys.readouterr().out
    parts = sorted(tmp_path.glob("part-*.txt"))
    assert len(parts) > 1 and f"parts: {len(parts)}" in out
    assert all(str(p) in out for p in parts) and "[00:00]" not in out  # metin değil, yol listesi
    assert "".join(p.read_text() + "\n" for p in parts).strip() == (tmp_path / "transcript.txt").read_text().strip()


def test_main_uses_cache_on_second_call(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(tr.tempfile, "gettempdir", lambda: str(tmp_path))
    calls = []
    monkeypatch.setattr(tr, "get_transcript", lambda *a: calls.append(1) or _transcript(2))
    assert tr.main(["https://x/video"]) == 0 and tr.main(["https://x/video"]) == 0
    assert len(calls) == 1  # ikincisi önbellekten
    assert tr.main(["https://x/video", "--fresh"]) == 0 and len(calls) == 2
    assert capsys.readouterr().out.count("=== SKIMCAST TRANSCRIPT ===") == 3


def test_main_reports_friendly_error(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(tr.tempfile, "gettempdir", lambda: str(tmp_path))

    def fail(*a):
        raise tr.SkimError("bu içerik desteklenmiyor")

    monkeypatch.setattr(tr, "get_transcript", fail)
    assert tr.main(["https://x/y"]) == 2
    assert "HATA: bu içerik desteklenmiyor" in capsys.readouterr().err


def test_apple_missing_episode_is_an_error_not_the_latest(monkeypatch):
    lookup = {"results": [
        {"wrapperType": "track", "feedUrl": "https://x/feed.xml"},
        {"wrapperType": "podcastEpisode", "trackId": 111, "trackName": "Bölüm 1", "episodeUrl": "https://cdn/ep1.mp3"},
    ]}
    monkeypatch.setattr(tr, "fetch", lambda url, retries=3: json.dumps(lookup))
    with pytest.raises(tr.SkimError, match="son 200 bölüm"):
        tr.from_apple("https://podcasts.apple.com/tr/podcast/show/id999?i=555", "small")


def test_feed_hint_without_match_is_an_error(monkeypatch):
    monkeypatch.setattr(tr, "fetch", lambda url, retries=3: FEED.format(ns="x"))
    with pytest.raises(tr.SkimError, match="RSS'te bulunamadı"):
        tr.from_feed("https://x/feed.xml", "small", audio_hint="https://cdn/yok.mp3", title_hint="Yok")


def test_rolling_two_line_vtt_is_deduplicated():
    vtt = """WEBVTT

00:00:00.000 --> 00:00:02.000
line one
line two

00:00:02.000 --> 00:00:04.000
line two
line three
"""
    assert tr.parse_subtitles(vtt) == [(0.0, "line one line two"), (2.0, "line three")]


def test_split_long_and_emit_splits_one_huge_block(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(tr, "PART_CHARS", 500)
    para = " ".join(f"kelime{i}" for i in range(400))
    t = tr.Transcript("Makale", "web-sayfası", [(0.0, para + "\n" + para)], 0.0, "", False)
    tr.print_result(*tr.write_output(t, "https://x", tmp_path))
    parts = sorted(tmp_path.glob("part-*.txt"))
    assert len(parts) > 2 and all(len(p.read_text()) <= 500 for p in parts)
    assert " ".join(" ".join(p.read_text() for p in parts).split()) == " ".join((para + " " + para).split())


def test_fetch_does_not_retry_permanent_http_errors(monkeypatch):
    calls = []

    def urlopen(req, timeout, context=None):
        calls.append(1)
        raise tr.urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, None)

    monkeypatch.setattr(tr.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(tr.time, "sleep", lambda s: None)
    with pytest.raises(tr.SkimError):
        tr.fetch("https://x/yok")
    assert len(calls) == 1


def test_bootstrap_inside_venv_installs_extra_then_restarts_once(monkeypatch):
    runs, execs = [], []
    monkeypatch.delenv("SKIMCAST_BOOTSTRAPPED", raising=False)
    monkeypatch.setattr(tr, "VENV", Path(tr.sys.prefix))  # zaten venv içindeyiz
    monkeypatch.setattr("subprocess.run", lambda cmd, **k: runs.append(cmd))
    monkeypatch.setattr(tr.os, "execv", lambda py, argv: execs.append(argv))
    tr.bootstrap(("faster-whisper",))
    assert "faster-whisper" in runs[-1] and len(execs) == 1
    with pytest.raises(tr.SkimError, match="kurulamadı"):  # yeniden başlatmadan sonra hâlâ eksikse döngü yok
        tr.bootstrap(("faster-whisper",))
    monkeypatch.delenv("SKIMCAST_BOOTSTRAPPED")


def _cache_env(monkeypatch, tmp_path):
    monkeypatch.setattr(tr.tempfile, "gettempdir", lambda: str(tmp_path))
    calls = []
    monkeypatch.setattr(tr, "get_transcript", lambda *a: calls.append(a) or _transcript(2))
    return calls


def test_cache_key_covers_lang_and_normalizes_youtube_urls(monkeypatch, tmp_path):
    calls = _cache_env(monkeypatch, tmp_path)
    tr.main(["https://www.youtube.com/watch?v=dQw4w9WgXcQ"])
    tr.main(["https://youtu.be/dQw4w9WgXcQ?t=50"])  # aynı video, farklı biçim → önbellek
    assert len(calls) == 1
    tr.main(["https://youtu.be/dQw4w9WgXcQ", "--lang", "de"])  # farklı dil → yeni deşifre
    assert len(calls) == 2


def test_cache_regenerates_when_part_files_were_cleaned(monkeypatch, tmp_path):
    calls = _cache_env(monkeypatch, tmp_path)
    monkeypatch.setattr(tr, "PART_CHARS", 300)
    monkeypatch.setattr(tr, "get_transcript", lambda *a: calls.append(a) or _transcript(20))
    tr.main(["https://x/uzun"])
    for f in tmp_path.rglob("part-*.txt"):
        f.unlink()
    tr.main(["https://x/uzun"])
    assert len(calls) == 2 and list(tmp_path.rglob("part-*.txt"))


def test_main_turns_unexpected_errors_into_friendly_message(monkeypatch, tmp_path, capsys):
    _cache_env(monkeypatch, tmp_path)

    def boom(*a):
        raise tr.ET.ParseError("bozuk xml")

    monkeypatch.setattr(tr, "get_transcript", boom)
    assert tr.main(["https://x/feed.xml"]) == 2
    assert "HATA: beklenmeyen sorun (ParseError)" in capsys.readouterr().err


def test_ytdlp_hint_skipped_for_404(monkeypatch):
    def fail(*a):
        raise RuntimeError("ERROR: HTTP Error 404: Not Found")

    monkeypatch.setattr(tr, "from_ytdlp", fail)
    monkeypatch.setattr(tr, "from_webpage", lambda url, method="x": (_ for _ in ()).throw(tr.SkimError("boş")))
    with pytest.raises(tr.SkimError) as e:
        tr.get_transcript("https://x.example/v", ["tr"], "small", 0)
    assert "yt-dlp eski" not in str(e.value)


def _server():
    pytest.importorskip("mcp")
    spec = importlib.util.spec_from_file_location("mcp_server", _path.with_name("mcp_server.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_mcp_tool_pages_long_transcripts(monkeypatch, tmp_path):
    srv = _server()
    parts = []
    for i in (1, 2):
        f = tmp_path / f"part-{i:02d}.txt"
        f.write_text(f"[0{i}:00] metin {i}", encoding="utf-8")
        parts.append(str(f))
    meta = {"title": "T", "source": "https://x", "method": "test", "duration": "10:00", "link_prefix": "", "chars": 9, "parts": parts}
    monkeypatch.setattr(srv.tr, "load", lambda *a: (meta, "hepsi"))
    first = srv.get_transcript("https://x")
    assert "part: 1/2 (devamı için part=2" in first and "metin 1" in first and "metin 2" not in first
    assert "(son parça)" in srv.get_transcript("https://x", part=2) and "metin 2" in srv.get_transcript("https://x", part=2)
    assert srv.get_transcript("https://x", part=3).startswith("HATA: part 1 ile 2")


def test_mcp_tool_returns_errors_as_text(monkeypatch):
    srv = _server()

    def fail(*a):
        raise srv.tr.SkimError("desteklenmiyor")

    monkeypatch.setattr(srv.tr, "load", fail)
    assert srv.get_transcript("https://x") == "HATA: desteklenmiyor"
