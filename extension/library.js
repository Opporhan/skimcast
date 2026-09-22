// skimcast (uzantı): library.js — arşivlenmiş tüm transcript'lerin listesi, aralarında tam metin arama,
// klasörlere ayırma (ör. "Yapay Zeka", "Felsefe"), sabitleme, sıralama ve tüm videolardaki favori
// (yıldızlanmış) anların tek bir yerde toplandığı "Favoriler" görünümü.

function t(key) { return chrome.i18n.getMessage(key) || key; }

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const archiveKey = (id) => `skimcastArchive:${id}`;
const ARCHIVE_INDEX_KEY = "skimcastArchiveIndex";
const NO_FOLDER = ""; // klasörsüz ("Genel")

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
  const nextIndex = index.map((e) => (e.id === id ? { ...e, folder: updated.folder || NO_FOLDER, pinned: !!updated.pinned } : e));
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
  return [...sorted.filter((e) => e.pinned), ...sorted.filter((e) => !e.pinned)]; // sabitlenenler üstte
}

function allFolders(index) {
  return [...new Set(index.map((e) => e.folder).filter(Boolean))].sort();
}

function folderSelectHtml(e, folders) {
  const options = [`<option value="${NO_FOLDER}">${escapeHtml(t("no_folder"))}</option>`,
    ...folders.map((f) => `<option value="${escapeHtml(f)}"${f === e.folder ? " selected" : ""}>${escapeHtml(f)}</option>`),
    `<option value="__new__">${escapeHtml(t("new_folder_option"))}</option>`];
  return `<select class="folder-select" data-id="${escapeHtml(e.id)}">${options.join("")}</select>`;
}

function entryRowHtml(e, folders) {
  const metaLine = [e.method, e.duration].filter(Boolean).join(" · ");
  return `
    <div class="row" data-id="${escapeHtml(e.id)}">
      <div class="row-main">
        <a class="title" href="viewer.html?id=${encodeURIComponent(e.id)}">${escapeHtml(e.title || "(başlıksız)")}</a>
        <div class="row-meta">${escapeHtml(metaLine)} · ${escapeHtml(relativeDate(e.ts))}</div>
        ${folderSelectHtml(e, folders)}
      </div>
      <div class="row-actions">
        <button class="pin${e.pinned ? " pinned" : ""}" data-id="${escapeHtml(e.id)}" title="${escapeHtml(t("pin_hint"))}">📌</button>
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
      <button id="favViewBtn" class="toggle-btn">${t("fav_view_btn")}</button>
    </div>
    <div id="folders" class="folders"></div>
    <div id="list"></div>
  `;
  mountThemeButton(document.getElementById("themeBtn"));

  const listEl = document.getElementById("list");
  const foldersEl = document.getElementById("folders");
  const searchInput = document.getElementById("search");
  const sortSelect = document.getElementById("sortBy");
  const favViewBtn = document.getElementById("favViewBtn");
  let index = await getIndex();
  let favView = false;
  let activeFolder = null; // null = Tümü

  function renderFolderTabs() {
    const folders = allFolders(index);
    const tabs = [{ name: null, label: t("all_folders") }, ...folders.map((f) => ({ name: f, label: f })),
      { name: NO_FOLDER, label: t("no_folder") }];
    foldersEl.innerHTML = tabs.map((f) =>
      `<button class="folder-tab${activeFolder === f.name ? " active" : ""}" data-folder="${escapeHtml(f.name ?? "")}" data-all="${f.name === null ? "1" : "0"}">${escapeHtml(f.label)}</button>`
    ).join("") + `<input id="newFolder" class="folder-tab" placeholder="${escapeHtml(t("new_folder_placeholder"))}">`;
    foldersEl.hidden = favView;
  }

  function renderList() {
    const filtered = activeFolder === null ? index : index.filter((e) => (e.folder || NO_FOLDER) === activeFolder);
    const sorted = sortIndex(filtered, sortSelect.value);
    const folders = allFolders(index);
    listEl.innerHTML = sorted.length ? sorted.map((e) => entryRowHtml(e, folders)).join("") : `<p class="hint">${t("library_empty")}</p>`;
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
    renderFolderTabs();
    if (favView) { renderFavorites(); return; }
    searchInput.value.trim() ? renderSearch(searchInput.value) : renderList();
  }

  render();

  searchInput.addEventListener("input", () => { if (!favView) render(); });
  sortSelect.addEventListener("change", render);
  favViewBtn.addEventListener("click", () => {
    favView = !favView;
    favViewBtn.classList.toggle("active", favView);
    searchInput.disabled = favView;
    sortSelect.disabled = favView;
    render();
  });

  foldersEl.addEventListener("click", (e) => {
    const tab = e.target.closest(".folder-tab");
    if (!tab) return;
    activeFolder = tab.dataset.all === "1" ? null : tab.dataset.folder;
    render();
  });
  foldersEl.addEventListener("keydown", (e) => {
    if (e.target.id !== "newFolder" || e.key !== "Enter") return;
    const name = e.target.value.trim();
    if (!name) return;
    activeFolder = name; // yeni klasör boş başlar, sadece görünüme geç; ilk video atanınca listede kalıcılaşır
    e.target.value = "";
    render();
  });

  listEl.addEventListener("change", async (e) => {
    const select = e.target.closest(".folder-select");
    if (!select) return;
    let folder = select.value;
    if (folder === "__new__") {
      folder = (prompt(t("new_folder_prompt")) || "").trim();
      if (!folder) { render(); return; }
    }
    await updateEntry(select.dataset.id, { folder });
    index = await getIndex();
    render();
  });

  listEl.addEventListener("click", async (e) => {
    const del = e.target.closest(".delete");
    if (del) {
      await removeEntry(del.dataset.id);
      index = await getIndex();
      render();
      return;
    }
    const pin = e.target.closest(".pin");
    if (pin) {
      const entryMeta = index.find((x) => x.id === pin.dataset.id);
      await updateEntry(pin.dataset.id, { pinned: !entryMeta?.pinned });
      index = await getIndex();
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
}

init();
