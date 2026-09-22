// Saf mantık fonksiyonlarının (fetch/DOM gerektirmeyen) testleri. Çalıştır: node extension/test.mjs
// background.js'in tamamını import edemeyiz (chrome.* global'lerine ihtiyaç duyuyor); bu yüzden
// saf fonksiyonları kaynaktan çıkarıp izole çalıştırıyoruz. Python tarafındaki (tests/test_transcript.py)
// aynı senaryoların JS karşılığı.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(dir, "background.js"), "utf8");
const names = [
  "fmtTime", "toBlocks", "youtubeId", "parseSubtitles", "parsePodcastJson",
  "hashString", "stableId", "parseTimeLabel", "stripNonSpeech", "parseTimedBlocks",
];
let extracted = "const BLOCK_SECONDS = 30;\nconst YT_ID_RE = " + src.match(/const YT_ID_RE = (.+);/)[1] + ";\n" +
  "const NON_SPEECH_RE = " + src.match(/const NON_SPEECH_RE = (.+);/)[1] + ";\n";
for (const n of names) {
  const m = src.match(new RegExp(`function ${n}\\([\\s\\S]*?\\n}\\n`));
  if (!m) throw new Error(`bulunamadı: ${n}`);
  extracted += m[0] + "\n";
}
const tmpMod = path.join(dir, ".test-logic.mjs");
fs.writeFileSync(tmpMod, extracted + "\nexport {" + names.join(",") + "};\n");
const {
  fmtTime, toBlocks, youtubeId, parseSubtitles, parsePodcastJson,
  hashString, stableId, parseTimeLabel, stripNonSpeech, parseTimedBlocks,
} = await import(`file://${tmpMod}`);
fs.unlinkSync(tmpMod);

assert.equal(fmtTime(65), "01:05");
assert.equal(fmtTime(3725), "1:02:05");

for (const u of [
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5",
  "https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ",
  "https://youtu.be/dQw4w9WgXcQ?si=abc",
  "https://www.youtube.com/shorts/dQw4w9WgXcQ",
  "https://www.youtube.com/live/dQw4w9WgXcQ",
]) assert.equal(youtubeId(u), "dQw4w9WgXcQ", u);
assert.equal(youtubeId("https://example.com/watch?v=x"), null);

const srt = "1\n00:00:01,000 --> 00:00:04,000\nMerhaba arkadaşlar.\n\n2\n00:00:04,500 --> 00:00:09,000\nBugün <i>aşılardan</i> bahsedeceğiz.\n";
assert.deepEqual(parseSubtitles(srt), [[1, "Merhaba arkadaşlar."], [4.5, "Bugün aşılardan bahsedeceğiz."]]);

const vtt1 = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nfirst line\n\n00:00:02.000 --> 00:00:04.000\nfirst line\n\n00:00:04.000 --> 00:00:06.000\n<c>second</c> line\n";
assert.deepEqual(parseSubtitles(vtt1), [[0, "first line"], [4, "second line"]]);
const vtt2 = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nline one\nline two\n\n00:00:02.000 --> 00:00:04.000\nline two\nline three\n";
assert.deepEqual(parseSubtitles(vtt2), [[0, "line one line two"], [2, "line three"]]);

const segs = Array.from({ length: 14 }, (_, i) => [i * 5, `cümle ${i}.`]);
const blocks = toBlocks(segs);
assert.ok(blocks[0].startsWith("[00:00] cümle 0."));
assert.ok(blocks.length >= 2);
assert.ok(blocks.at(-1).includes("cümle 13."));

assert.deepEqual(
  parsePodcastJson(JSON.stringify({ segments: [{ startTime: 1, body: "a" }, { startTime: 2.5, body: "b" }] })),
  [[1, "a"], [2.5, "b"]]
);

assert.equal(stableId("https://youtu.be/dQw4w9WgXcQ?si=abc"), "yt:dQw4w9WgXcQ");
assert.equal(stableId("https://example.com/a"), stableId("https://example.com/a")); // aynı link -> aynı kimlik
assert.notEqual(stableId("https://example.com/a"), stableId("https://example.com/b"));
assert.equal(hashString("abc"), hashString("abc"));
assert.notEqual(hashString("abc"), hashString("abd"));

assert.equal(parseTimeLabel("01:05"), 65);
assert.equal(parseTimeLabel("1:02:05"), 3725);

assert.deepEqual(
  parseTimedBlocks("[00:05] merhaba dünya\n[1:02:05] ikinci blok\nzaman damgasız satır"),
  [{ sec: 5, text: "merhaba dünya" }, { sec: 3725, text: "ikinci blok" }, { sec: null, text: "zaman damgasız satır" }]
);

assert.equal(stripNonSpeech("(müzik) merhaba (alkış) dünya"), "merhaba dünya");
assert.equal(stripNonSpeech("[Music]"), "");
assert.deepEqual(
  parseTimedBlocks("[00:05] merhaba dünya\n[00:10] (müzik)\n[00:15] devam ediyor"),
  [{ sec: 5, text: "merhaba dünya" }, { sec: 15, text: "devam ediyor" }] // sadece "(müzik)" olan blok tamamen düşer
);

console.log(`Tüm mantık testleri geçti (${names.length} fonksiyon doğrulandı).`);
