// skimcast (uzantı): library.js — arşivlenmiş tüm transcript'lerin listesi, aralarında tam metin arama,
// kişiselleştirme (etiket, not, sabitleme, sıralama) ve tüm videolardaki favori (yıldızlanmış) anların
// tek bir yerde toplandığı "Favoriler" görünümü.

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

async function getIndex() {
  const { [ARCHIVE_INDEX_KEY]: index = [] } = await chrome.storage.local.get(ARCHIVE_INDEX_KEY);
  return index;
}

async function updateEntry(id, patch) {
  const fullKey = archiveKey(id);
  const { [fullKey]: entry } = await chrome.storage.local.get(fullKey);
  if (!entry) return null;
  const updated = { ...entry, ...patch };
  const index = await getIndex();
  const nextIndex = index.map((e) => (e.id === id ? { ...e, tags: updated.tags || [], pinned: !!updated.pinned } : e));
  await chrome.storage.local.set({ [fullKey]: updated, [ARCHIVE_INDEX_KEY]: nextIndex });
  return updated;
}

async function removeEntry(id) {
  const index = await getIndex();
  await chrome.storage.local.remove(archiveKey(id));
  await chrome.storage.local.set({ [ARCHIVE_INDEX_KEY]: index.filter((e) => e.id !== id) });
}

function sortIndex(index, sortBy) {
  const sorted = [...index].sort((a, b) => {
    if (sortBy === "title") return (a.title || "").localeCompare(b.title || "");
    if (sortBy === "oldest") return a.ts - b.ts;
    return b.ts - a.ts; // newest (varsayılan)
  });
  // sabitlenenler her zaman en üstte, kendi aralarında seçili sıralamayı korur
  return [...sorted.filter((e) => e.pinned), ...sorted.filter((e) => !e.pinned)];
}

function allTags(index) {
  return [...new Set(index.flatMap((e) => e.tags || []))].sort();
}

function entryRowHtml(e) {
  const metaLine = [e.method, e.duration].filter(Boolean).join(" · ");
  const tagsHtml = (e.tags || []).map((tag) =>
    `<span class="chip" data-tag="${escapeHtml(tag)}" data-id="${escapeHtml(e.id)}">${escapeHtml(tag)} <span class="chip-x" data-remove-tag="${escapeHtml(tag)}" data-id="${escapeHtml(e.id)}">×</span></span>`
  ).join("");
  return `
    <div class="row" data-id="${escapeHtml(e.id)}">
      <div class="row-main">
        <a class="title" href="viewer.html?id=${encodeURIComponent(e.id)}">${e.pinned ? "📌 " : ""}${escapeHtml(e.title || "(başlıksız)")}</a>
        <div class="row-meta">${escapeHtml(metaLine)} · ${escapeHtml(relativeDate(e.ts))}</div>
        <div class="tags">${tagsHtml}<input class="tag-input" data-id="${escapeHtml(e.id)}" placeholder="${escapeHtml(t("add_tag_placeholder"))}"></div>
      </div>
      <div class="row-actions">
        <button class="pin" data-id="${escapeHtml(e.id)}" title="${escapeHtml(t("pin_hint"))}">${e.pinned ? "📌" : "📍"}</button>
        <button class="delete" data-id="${escapeHtml(e.id)}">${t("library_delete")}</button>
      </div>
    </div>`;
}

function snippetHtml(text, q) {
  const lower = text.toLocaleLowerCase("tr");
  const idx = lower.indexOf(q.toLocaleLowerCase("tr"));
  if (idx === -1) return escapeHtml(text);
  return `${escapeHtml(text.slice(0, idx))}<mark>${escapeHtml(text.slice(idx, idx + q.length))}</mark>${escapeHtml(text.slice(idx + q.length))}`;
}

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

// Tüm videolardaki yıldızlanmış (favori) anları tek listede toplar.
async function getAllHighlights(index) {
  const keys = index.map((e) => archiveKey(e.id));
  const entries = await chrome.storage.local.get(keys);
  const all = [];
  for (const meta of index) {
    const entry = entries[archiveKey(meta.id)];
    for (const h of entry?.highlights || []) all.push({ ...h, videoId: meta.id, videoTitle: entry.meta.title });
  }
  return all.sort((a, b) => b.ts - a.ts);
}

function highlightRowHtml(h) {
  return `
    <div class="row fav-row">
      <div class="row-main">
        <a class="title" href="viewer.html?id=${encodeURIComponent(h.videoId)}">${escapeHtml(h.videoTitle || "(başlıksız)")}</a>
        <div class="snippet">"${escapeHtml(h.text)}"</div>
      </div>
      <div class="row-actions">
        <button class="unstar" data-video-id="${escapeHtml(h.videoId)}" data-key="${escapeHtml(h.key)}">${t("remove_fav_btn")}</button>
      </div>
    </div>`;
}

async function init() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <header class="header-top">
      <div>
        <a class="back" href="popup.html">${t("popup_title")}</a>
        <h1>${t("library_title")}</h1>
      </div>
      <button id="themeBtn" class="theme-btn" title="${escapeHtml(t("theme_btn"))}"></button>
    </header>
    <div class="controls">
      <input id="search" type="text" placeholder="${escapeHtml(t("library_search_placeholder"))}">
      <select id="sortBy">
        <option value="newest">${t("sort_newest")}</option>
        <option value="oldest">${t("sort_oldest")}</option>
        <option value="title">${t("sort_title")}</option>
      </select>
      <select id="tagFilter"><option value="">${t("all_tags")}</option></select>
      <button id="favViewBtn" class="toggle-btn">${t("fav_view_btn")}</button>
    </div>
    <div id="list"></div>
  `;
  mountThemeButton(document.getElementById("themeBtn"));

  const listEl = document.getElementById("list");
  const searchInput = document.getElementById("search");
  const sortSelect = document.getElementById("sortBy");
  const tagSelect = document.getElementById("tagFilter");
  const favViewBtn = document.getElementById("favViewBtn");
  let index = await getIndex();
  let favView = false;

  function fillTagFilter() {
    const current = tagSelect.value;
    tagSelect.innerHTML = `<option value="">${t("all_tags")}</option>` +
      allTags(index).map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join("");
    tagSelect.value = current;
  }

  function renderList() {
    const filtered = tagSelect.value ? index.filter((e) => (e.tags || []).includes(tagSelect.value)) : index;
    const sorted = sortIndex(filtered, sortSelect.value);
    listEl.innerHTML = sorted.length ? sorted.map(entryRowHtml).join("") : `<p class="hint">${t("library_empty")}</p>`;
  }

  async function renderSearch(query) {
    const results = await searchArchive(query, index);
    if (results === null) { renderList(); return; }
    listEl.innerHTML = results.length
      ? results.map((r) => `
          <div class="row">
            <div class="row-main">
              <a class="title" href="viewer.html?id=${encodeURIComponent(r.meta.id)}&q=${encodeURIComponent(query)}">${escapeHtml(r.meta.title || "(başlıksız)")}</a>
              <div class="row-meta">${escapeHtml([r.meta.method, r.meta.duration].filter(Boolean).join(" · "))}</div>
              <div class="snippet">${snippetHtml(r.snippet, query)}</div>
            </div>
          </div>`).join("")
      : `<p class="hint">${t("no_matches")}</p>`;
  }

  async function renderFavorites() {
    const all = await getAllHighlights(index);
    listEl.innerHTML = all.length ? all.map(highlightRowHtml).join("") : `<p class="hint">${t("no_favorites")}</p>`;
  }

  function render() {
    if (favView) { renderFavorites(); return; }
    searchInput.value.trim() ? renderSearch(searchInput.value) : renderList();
  }

  fillTagFilter();
  render();

  searchInput.addEventListener("input", () => { if (!favView) render(); });
  sortSelect.addEventListener("change", render);
  tagSelect.addEventListener("change", render);
  favViewBtn.addEventListener("click", () => {
    favView = !favView;
    favViewBtn.classList.toggle("active", favView);
    searchInput.disabled = favView;
    sortSelect.disabled = favView;
    tagSelect.disabled = favView;
    render();
  });

  listEl.addEventListener("click", async (e) => {
    const del = e.target.closest(".delete");
    if (del) {
      await removeEntry(del.dataset.id);
      index = await getIndex();
      fillTagFilter();
      render();
      return;
    }
    const pin = e.target.closest(".pin");
    if (pin) {
      const entry = index.find((x) => x.id === pin.dataset.id);
      await updateEntry(pin.dataset.id, { pinned: !entry?.pinned });
      index = await getIndex();
      render();
      return;
    }
    const removeTag = e.target.closest("[data-remove-tag]");
    if (removeTag) {
      const entry = index.find((x) => x.id === removeTag.dataset.id);
      const tags = (entry?.tags || []).filter((tg) => tg !== removeTag.dataset.removeTag);
      await updateEntry(removeTag.dataset.id, { tags });
      index = await getIndex();
      fillTagFilter();
      render();
      return;
    }
    const unstar = e.target.closest(".unstar");
    if (unstar) {
      const fullKey = archiveKey(unstar.dataset.videoId);
      const { [fullKey]: full } = await chrome.storage.local.get(fullKey);
      if (full) {
        full.highlights = (full.highlights || []).filter((h) => h.key !== unstar.dataset.key);
        await chrome.storage.local.set({ [fullKey]: full });
      }
      render();
    }
  });

  listEl.addEventListener("keydown", async (e) => {
    const input = e.target.closest(".tag-input");
    if (!input || e.key !== "Enter") return;
    const tag = input.value.trim();
    if (!tag) return;
    const entry = index.find((x) => x.id === input.dataset.id);
    const tags = [...new Set([...(entry?.tags || []), tag])];
    await updateEntry(input.dataset.id, { tags });
    index = await getIndex();
    fillTagFilter();
    render();
  });
}

init();
