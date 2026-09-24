# skimcast

**Paste a link, get a timestamped summary.** A [Claude Code](https://claude.com/claude-code) plugin that pulls the transcript from a YouTube video, podcast, web video or article and summarizes it — no API keys, no n8n, no extra cost.

```
/skimcast:summarize https://www.youtube.com/watch?v=rb7TVW77ZCs
```

→ a general summary followed by a minute-by-minute breakdown with **clickable `[mm:ss]` links**. A 4-minute video takes ~20 s; a 1.5-hour podcast ~40 s. See real outputs: [YouTube example](docs/example-youtube.md) · [90-minute podcast example](docs/example-podcast.md).

## Install

```
/plugin marketplace add Opporhan/skimcast
/plugin install skimcast@skimcast
```

The first run installs its own dependencies into a private virtualenv (`~/.cache/skimcast`, ~1 min, once). Your system Python is never touched. Needs Python 3.10+ (tested on 3.12 and 3.14).

## What it can read

It tries the fastest source first and falls back automatically:

| Input | How the transcript is found |
|---|---|
| YouTube | Manual captions → auto captions (your language first) → local speech-to-text |
| Podcast (RSS feed, Apple Podcasts link) | The episode's [`<podcast:transcript>`](https://podcasting2.org/docs/podcast-namespace/tags/transcript) tag → local speech-to-text |
| Any site [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports (1000+) | Site subtitles → local speech-to-text |
| Article / web page | Main text extraction |
| Local audio/video file | Local speech-to-text ([faster-whisper](https://github.com/SYSTRAN/faster-whisper)) |

Speech-to-text runs **on your machine** and is only used when no ready-made transcript exists. It is slow on long audio — measured on an Apple M2: the small `tiny` model ≈ 8× faster than real time, the default `small` model noticeably slower but more accurate — and is installed on demand. The summary always says how the transcript was obtained, and warns when it's auto-generated.

## Use it in Claude Desktop (no terminal, no VS Code)

skimcast also ships an [MCP](https://modelcontextprotocol.io) server, so you can paste a link into the Claude desktop app and ask for a summary. Claude writes the summary itself — still no API key.

1. Install Python 3.10+ if you don't have it, then on GitHub click **Code → Download ZIP** and unzip it somewhere permanent.
2. In Claude Desktop open **Settings → Developer → Edit Config** and add (use the real path; on Windows use `python` instead of `python3`):

```json
{
  "mcpServers": {
    "skimcast": {
      "command": "python3",
      "args": ["/path/to/skimcast/skills/summarize/mcp_server.py"]
    }
  }
}
```

3. Restart Claude Desktop. The first launch installs its dependencies (~1 min). Then just say: *"Summarize https://www.youtube.com/watch?v=…"*.

## Use the script on its own

```
python3 skills/summarize/transcript.py "<link or file>" [--lang tr,en] [--episode 0] [--whisper-model small]
```

Prints the transcript as `[mm:ss] text` blocks (long ones are split into part files). Results are cached per link.

## What it can't do (honestly)

- **DRM / login-only content** — Spotify, Netflix, private or region-locked videos. Use the podcast's Apple Podcasts or RSS link instead of Spotify.
- **Sites yt-dlp can't parse** (it breaks sometimes — e.g. TED at the time of writing). skimcast falls back to the page text and labels it *"this is NOT the video's transcript"*.
- YouTube may block requests from cloud/VPN IPs; run it on your own machine.
- "Free" means no extra API key or bill; the summarizing is done by your own Claude Code session and counts toward your plan's usage.
- Please respect the terms of the sites you read from; this is meant for personal use.

## How it compares

Several Claude Code skills already do "link → summary" ([audio-tldr-skill](https://github.com/AugustusW/audio-tldr-skill), [claude-video](https://github.com/bradautomates/claude-video), [youtube-transcriber](https://github.com/lifesized/youtube-transcriber) and others). skimcast's angle is to be **one small, dependable path for every kind of link** — including podcasts with ready transcripts and Apple Podcasts links — with a private auto-setup, clear failure messages, and summaries that always carry timestamps and say how trustworthy the source text is.

## Browser extension

`extension/` is a separate, self-contained product in this repo: a Chrome/Edge extension that turns any YouTube video, podcast episode, or article into a searchable, click-to-jump transcript — no summary, no LLM, no API key. Everything (library, notes, translation, text-to-speech) runs on your device; the one exception is fetching a YouTube video's transcript itself, which goes through a small hosted server (see `server/`) because YouTube blocks that request from a browser — no local install needed on your side.

```
Right-click a video (or paste a link in the popup) → transcript opens in a new tab
```

- **Read & navigate** — search inside the transcript, click any timestamp to jump the video to that second, jump between chapters (auto-detected from the video description), toggle timestamps on/off, switch light/dark theme.
- **Follow along with the video** — while you watch the video in its own YouTube tab, the transcript auto-scrolls and highlights the line (and, word by word, the exact word) being spoken.
- **Read aloud** — on-device text-to-speech, per-paragraph or from any line, with word-by-word highlighting as it speaks.
- **Personal library** — every transcript you fetch is saved locally; organize videos, favorite lines, and free-standing notes into folders (with your own icon or uploaded image), star favorite lines, search across everything you've ever fetched. A "remember this?" card occasionally resurfaces an old favorite.
- **Notes** — one unified notes system: jot a note about a whole video, about one specific line, or completely free-standing — all in the same "My Notes" tab, each with its own icon.
- **Translate on-device** — Chrome's built-in Translator API translates the transcript into any of 9 languages, fully offline, no quota.
- **Export** — copy, download as `.txt` or a real `.pdf` (Turkish/accented characters render correctly via an embedded font), or export a folder as Markdown for Obsidian/Notion.
- **Back up** — one file holds your whole library (folders, favorites, videos, notes); restore it on another machine.
- **UI language** — switch the extension's own interface between Turkish and English, independent of your browser's language.

### Install (unpacked, not on a store)

1. Open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**, click **Load unpacked**, select the `extension/` folder.
2. Click the toolbar icon on any YouTube/podcast/article page, or right-click the page and choose **skimcast: Get Transcript**.

No Python, no local install — just load the folder. This is a separate codebase from the Claude Code plugin above — the extension never calls Claude or any LLM; the plugin never touches the browser.

## Develop

```
python3 -m venv .venv && .venv/bin/pip install -r skills/summarize/requirements.txt pytest ruff
.venv/bin/pytest -q && .venv/bin/ruff check .
claude --plugin-dir .          # try it locally
```

MIT licensed. Türkçe: [README.tr.md](README.tr.md)
