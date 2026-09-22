// skimcast (uzantı): library.js — arşivlenmiş (daha önce getirilmiş) tüm transcript'lerin listesi ve
// aralarında tam metin arama. background.js'in yazdığı skimcastArchiveIndex (hafif liste) ve
// skimcastArchive:<id> (tam kayıt, arama sırasında ihtiyaç oldukça yüklenir) üzerinde çalışır.

function t(key) { return chrome.i18n.getMessage(key) || key; }

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const archiveKey = (id) => `skimcastArchive:${id}`;
const ARCHIVE_INDEX_KEY = "skimcastArchiveIndex";

function relativeDate(ts) {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return t("date_today");
  if (days === 1) return t("date_yesterday");
  if (days < 30) return `${days} ${t("date_days_ago")}`;
  return new Date(ts).toLocaleDateString();
}

function entryRowHtml(e) {
  const metaLine = [e.method, e.duration].filter(Boolean).join(" · ");
  return `
    <div class="row" data-id="${escapeHtml(e.id)}">
      <a class="title" href="viewer.html?id=${encodeURIComponent(e.id)}">${escapeHtml(e.title || "(başlıksız)")}</a>
      <div class="row-meta">${escapeHtml(metaLine)} · ${escapeHtml(relativeDate(e.ts))}</div>
      <button class="delete" data-id="${escapeHtml(e.id)}">${t("library_delete")}</button>
    </div>`;
}

async function getIndex() {
  const { [ARCHIVE_INDEX_KEY]: index = [] } = await chrome.storage.local.get(ARCHIVE_INDEX_KEY);
  return [...index].sort((a, b) => b.ts - a.ts);
}

async function removeEntry(id) {
  const index = await getIndex();
  await chrome.storage.local.remove(archiveKey(id));
  await chrome.storage.local.set({ [ARCHIVE_INDEX_KEY]: index.filter((e) => e.id !== id) });
}

// Tam metin arama: dizindeki her kayıt için tam veriyi (blocks dahil) tek seferde çeker, satır satır
// arar. Kişisel bir arşiv için (onlarca-yüzlerce video) bu kadarı yeterince hızlı; ayrı bir arama
// indeksi kurmak bu ölçekte gereksiz karmaşıklık olurdu.
async function searchArchive(query, index) {
  const q = query.trim().toLocaleLowerCase("tr");
  if (!q) return null;
  const keys = index.map((e) => archiveKey(e.id));
  const entries = await chrome.storage.local.get(keys);
  const results = [];
  for (const meta of index) {
    const entry = entries[archiveKey(meta.id)];
    if (!entry) continue;
    const hit = entry.blocks.find((b) => b.text.toLocaleLowerCase("tr").includes(q));
    if (hit) results.push({ meta, snippet: hit.text, sec: hit.sec });
  }
  return results;
}

function snippetHtml(text, q) {
  const lower = text.toLocaleLowerCase("tr");
  const idx = lower.indexOf(q.toLocaleLowerCase("tr"));
  if (idx === -1) return escapeHtml(text);
  return `${escapeHtml(text.slice(0, idx))}<mark>${escapeHtml(text.slice(idx, idx + q.length))}</mark>${escapeHtml(text.slice(idx + q.length))}`;
}

async function init() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <header>
      <a class="back" href="popup.html">${t("popup_title")}</a>
      <h1>${t("library_title")}</h1>
    </header>
    <input id="search" type="text" placeholder="${escapeHtml(t("library_search_placeholder"))}">
    <div id="list"></div>
  `;
  const listEl = document.getElementById("list");
  const searchInput = document.getElementById("search");
  let index = await getIndex();

  function renderList() {
    listEl.innerHTML = index.length ? index.map(entryRowHtml).join("") : `<p class="hint">${t("library_empty")}</p>`;
  }

  async function renderSearch(query) {
    const results = await searchArchive(query, index);
    if (results === null) { renderList(); return; }
    listEl.innerHTML = results.length
      ? results.map((r) => `
          <div class="row">
            <a class="title" href="viewer.html?id=${encodeURIComponent(r.meta.id)}&q=${encodeURIComponent(query)}">${escapeHtml(r.meta.title || "(başlıksız)")}</a>
            <div class="row-meta">${escapeHtml([r.meta.method, r.meta.duration].filter(Boolean).join(" · "))}</div>
            <div class="snippet">${snippetHtml(r.snippet, query)}</div>
          </div>`).join("")
      : `<p class="hint">${t("no_matches")}</p>`;
  }

  renderList();
  searchInput.addEventListener("input", () => renderSearch(searchInput.value));

  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest(".delete");
    if (!btn) return;
    await removeEntry(btn.dataset.id);
    index = await getIndex();
    searchInput.value ? renderSearch(searchInput.value) : renderList();
  });
}

init();
