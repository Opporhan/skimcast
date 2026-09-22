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

## Develop

```
python3 -m venv .venv && .venv/bin/pip install -r skills/summarize/requirements.txt pytest ruff
.venv/bin/pytest -q && .venv/bin/ruff check .
claude --plugin-dir .          # try it locally
```

MIT licensed. Türkçe: [README.tr.md](README.tr.md)
