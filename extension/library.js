// skimcast (uzantı): library.js — arşivlenmiş tüm transcript'lerin listesi, aralarında tam metin arama,
// "Dosyalarım" bölümünde klasörlere ayırma (ör. "Yapay Zeka", "Felsefe"; özel ikon/görsel, yeniden
// adlandırma, silme), sabitleme, sıralama ve tüm videolardaki favori (yıldızlanmış) anların tek bir
// yerde toplandığı "Favoriler" görünümü.

function t(key) { return chrome.i18n.getMessage(key) || key; }

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const archiveKey = (id) => `skimcastArchive:${id}`;
const ARCHIVE_INDEX_KEY = "skimcastArchiveIndex";
const FOLDERS_KEY = "skimcastFolders";
const NO_FOLDER = ""; // klasörsüz
const DEFAULT_ICON = "📁";
const ICON_CHOICES = [
  "📁", "📂", "🗂️", "🤖", "🧠", "💡", "📚", "📖", "✏️", "🎬", "🎙️", "🎧", "📷",
  "💼", "💰", "📈", "🎓", "🔬", "🧪", "⚗️", "🩺", "⚖️", "🏛️", "🌍", "🗺️", "✈️",
  "🎮", "⚽", "🏋️", "🍳", "🎨", "🎵", "🎭", "❤️", "⭐", "🔥", "🚀", "🌱", "🐾",
];

async function getIndex() {
  const { [ARCHIVE_INDEX_KEY]: index = [] } = await chrome.storage.local.get(ARCHIVE_INDEX_KEY);
  return index;
}

async function getFolders() {
  const { [FOLDERS_KEY]: folders = [] } = await chrome.storage.local.get(FOLDERS_KEY);
  return folders;
}

async function saveFolders(folders) {
  await chrome.storage.local.set({ [FOLDERS_KEY]: folders });
}

// Bir klasördeki (adı `from`) tüm kayıtları başka bir klasöre (`to`) taşır — hem hafif dizinde hem tam
// kayıtlarda. Klasör silinirken to="" (Genel) verilir, yeniden adlandırılırken yeni isim verilir.
async function reassignFolder(from, to) {
  const index = await getIndex();
  const affected = index.filter((e) => e.folder === from);
  if (!affected.length) return;
  const nextIndex = index.map((e) => (e.folder === from ? { ...e, folder: to } : e));
  const patch = { [ARCHIVE_INDEX_KEY]: nextIndex };
  for (const e of affected) {
    const fk = archiveKey(e.id);
    const { [fk]: full } = await chrome.storage.local.get(fk);
    if (full) patch[fk] = { ...full, folder: to };
  }
  await chrome.storage.local.set(patch);
}

async function updateEntry(id, patch) {
  const fullKey = archiveKey(id);
  const { [fullKey]: entry } = await chrome.storage.local.get(fullKey);
  if (!entry) return null;
  const updated = { ...entry, ...patch };
  const index = await getIndex();
  const nextIndex = index.map((e) => (e.id === id ? { ...e, folder: updated.folder ?? e.folder, pinned: !!updated.pinned } : e));
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

function iconHtml(icon) {
  return icon && icon.startsWith("data:") ? `<img src="${icon}" alt="">` : escapeHtml(icon || DEFAULT_ICON);
}

// ------------------------------------------------------------ klasör modalı (oluştur / düzenle / sil)
// Aynı modal hem yeni klasör açmak hem var olanı düzenlemek (isim, ikon/görsel değiştirme, silme) için
// kullanılıyor. Ekranın ortasında açılır (window.prompt() değil).
function openFolderModal(existing) {
  return new Promise((resolve) => {
    const isEdit = !!existing;
    let icon = existing?.icon || DEFAULT_ICON;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <h2>${isEdit ? t("edit_folder_title") : t("new_folder_title")}</h2>
        <div class="icon-preview" id="iconPreview">${iconHtml(icon)}</div>
        <input id="modalFolderName" type="text" placeholder="${escapeHtml(t("new_folder_name_placeholder"))}" value="${escapeHtml(existing?.name || "")}">
        <div class="icon-grid">
          ${ICON_CHOICES.map((ic) => `<button type="button" class="icon-choice" data-icon="${escapeHtml(ic)}">${ic}</button>`).join("")}
          <button type="button" class="icon-choice icon-upload" id="iconUploadBtn" title="${escapeHtml(t("upload_image_hint"))}">🖼️</button>
          <input type="file" id="iconUploadInput" accept="image/*" hidden>
        </div>
        <div class="modal-actions">
          ${isEdit ? `<button id="modalDelete" class="danger">${t("modal_delete")}</button>` : ""}
          <span class="spacer"></span>
          <button id="modalCancel">${t("modal_cancel")}</button>
          <button id="modalSave" class="primary">${isEdit ? t("modal_save") : t("modal_create")}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector("#modalFolderName");
    const preview = overlay.querySelector("#iconPreview");
    requestAnimationFrame(() => input.focus());

    const close = (result) => { overlay.remove(); resolve(result); };
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(null); });
    overlay.querySelector("#modalCancel").addEventListener("click", () => close(null));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") overlay.querySelector("#modalSave").click();
      if (e.key === "Escape") close(null);
    });

    overlay.querySelectorAll(".icon-choice[data-icon]").forEach((btn) => {
      btn.addEventListener("click", () => { icon = btn.dataset.icon; preview.innerHTML = iconHtml(icon); });
    });
    const fileInput = overlay.querySelector("#iconUploadInput");
    overlay.querySelector("#iconUploadBtn").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { icon = reader.result; preview.innerHTML = iconHtml(icon); };
      reader.readAsDataURL(file);
    });

    overlay.querySelector("#modalSave").addEventListener("click", () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      close({ action: "save", name, icon });
    });
    overlay.querySelector("#modalDelete")?.addEventListener("click", () => {
      if (confirm(t("delete_folder_confirm"))) close({ action: "delete" });
    });
  });
}

function folderSelectHtml(e, folders) {
  const options = [`<option value="${NO_FOLDER}">${escapeHtml(t("no_folder"))}</option>`,
    ...folders.map((f) => `<option value="${escapeHtml(f.name)}"${f.name === e.folder ? " selected" : ""}>${escapeHtml(f.name)}</option>`)];
  return `<select class="folder-select" data-id="${escapeHtml(e.id)}">${options.join("")}</select>`;
}

function entryRowHtml(e, folders) {
  const metaLine = [e.method, e.duration].filter(Boolean).join(" · ");
  return `
    <div class="row${e.pinned ? " pinned-row" : ""}" data-id="${escapeHtml(e.id)}">
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

function relativeDate(ts) {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return t("date_today");
  if (days === 1) return t("date_yesterday");
  if (days < 30) return `${days} ${t("date_days_ago")}`;
  return new Date(ts).toLocaleDateString();
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

function highlightRowHtml(h, folders) {
  const options = [`<option value=""${!h.folder ? " selected" : ""}>${escapeHtml(t("no_folder"))}</option>`,
    ...folders.map((f) => `<option value="${escapeHtml(f.name)}"${f.name === h.folder ? " selected" : ""}>${escapeHtml(f.name)}</option>`)];
  return `
    <div class="row fav-row">
      <div class="row-main">
        <a class="title" href="viewer.html?id=${encodeURIComponent(h.videoId)}">${escapeHtml(h.videoTitle || "(başlıksız)")}</a>
        <div class="snippet">"${escapeHtml(h.text)}"</div>
        <select class="fav-folder-select" data-video-id="${escapeHtml(h.videoId)}" data-key="${escapeHtml(h.key)}">${options.join("")}</select>
      </div>
      <div class="row-actions">
        <button class="edit-fav" data-video-id="${escapeHtml(h.videoId)}" data-key="${escapeHtml(h.key)}" title="${escapeHtml(t("edit_folder_hint"))}">✎</button>
        <button class="unstar" data-video-id="${escapeHtml(h.videoId)}" data-key="${escapeHtml(h.key)}">${t("remove_fav_btn")}</button>
      </div>
    </div>`;
}

// Bir favoriyi (yıldızlanmış an) günceller — o anın ait olduğu videonun tam kaydı içinde saklı,
// video kaydını okuyup ilgili highlight'ı değiştirip geri yazıyoruz.
async function updateHighlight(videoId, hKey, patch) {
  const fk = archiveKey(videoId);
  const { [fk]: full } = await chrome.storage.local.get(fk);
  if (!full) return;
  full.highlights = (full.highlights || []).map((h) => (h.key === hKey ? { ...h, ...patch } : h));
  await chrome.storage.local.set({ [fk]: full });
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
    <input id="search" class="search-input" type="text" placeholder="${escapeHtml(t("library_search_placeholder"))}">

    <section class="folders-section">
      <h2>${t("folders_section_title")}</h2>
      <div id="folders" class="folder-grid"></div>
    </section>

    <div class="controls-row">
      <select id="sortBy">
        <option value="newest">${t("sort_newest")}</option>
        <option value="oldest">${t("sort_oldest")}</option>
        <option value="title">${t("sort_title")}</option>
      </select>
      <button id="favViewBtn" class="toggle-btn">${t("fav_view_btn")}</button>
    </div>
    <div id="list"></div>
  `;
  mountThemeButton(document.getElementById("themeBtn"));

  const listEl = document.getElementById("list");
  const foldersEl = document.getElementById("folders");
  const searchInput = document.getElementById("search");
  const sortSelect = document.getElementById("sortBy");
  const favViewBtn = document.getElementById("favViewBtn");
  let index = await getIndex();
  let folders = await getFolders();
  let favView = false;
  let activeFolder = null; // null = Tümü

  function countFor(name) {
    return name === null ? index.length : index.filter((e) => e.folder === name).length;
  }

  function renderFolderCards() {
    const cards = [{ name: null, label: t("all_folders"), icon: "🗂️", system: true },
      ...folders.map((f) => ({ name: f.name, label: f.name, icon: f.icon }))];
    foldersEl.innerHTML = cards.map((f) => `
      <div class="folder-card${activeFolder === f.name ? " active" : ""}" data-folder="${escapeHtml(f.name ?? "")}" data-all="${f.system ? "1" : "0"}">
        ${!f.system ? `<button class="folder-edit-btn" data-folder="${escapeHtml(f.name)}" title="${escapeHtml(t("edit_folder_hint"))}">✎</button>` : ""}
        <span class="folder-icon">${iconHtml(f.icon)}</span>
        <span class="folder-name">${escapeHtml(f.label)}</span>
        <span class="folder-count">${countFor(f.name)}</span>
      </div>`).join("") +
      `<button class="folder-card folder-card-add" id="newFolderBtn">
        <span class="folder-icon">＋</span>
        <span class="folder-name">${t("new_folder_option").replace("…", "")}</span>
      </button>`;
    // Klasörler bölümü hem video listesini hem favorileri aynı şekilde filtrelemek için kullanılıyor,
    // bu yüzden favoriler görünümünde de gizlenmiyor.
  }

  function renderList() {
    const filtered = activeFolder === null ? index : index.filter((e) => e.folder === activeFolder);
    const sorted = sortIndex(filtered, sortSelect.value);
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
    const filtered = activeFolder === null ? all : all.filter((h) => (h.folder || NO_FOLDER) === activeFolder);
    listEl.innerHTML = filtered.length ? filtered.map((h) => highlightRowHtml(h, folders)).join("") : `<p class="hint">${t("no_favorites")}</p>`;
  }

  function render() {
    renderFolderCards();
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

  foldersEl.addEventListener("click", async (e) => {
    if (e.target.closest("#newFolderBtn")) {
      const result = await openFolderModal();
      if (result?.action === "save") {
        if (folders.some((f) => f.name === result.name)) { activeFolder = result.name; render(); return; }
        folders.push({ name: result.name, icon: result.icon });
        await saveFolders(folders);
        activeFolder = result.name;
      }
      render();
      return;
    }
    const editBtn = e.target.closest(".folder-edit-btn");
    if (editBtn) {
      const current = folders.find((f) => f.name === editBtn.dataset.folder);
      const result = await openFolderModal(current);
      if (result?.action === "save") {
        if (result.name !== current.name) await reassignFolder(current.name, result.name);
        folders = folders.map((f) => (f.name === current.name ? { name: result.name, icon: result.icon } : f));
        await saveFolders(folders);
        index = await getIndex();
        if (activeFolder === current.name) activeFolder = result.name;
      } else if (result?.action === "delete") {
        await reassignFolder(current.name, NO_FOLDER);
        folders = folders.filter((f) => f.name !== current.name);
        await saveFolders(folders);
        index = await getIndex();
        if (activeFolder === current.name) activeFolder = null;
      }
      render();
      return;
    }
    const card = e.target.closest(".folder-card");
    if (!card) return;
    activeFolder = card.dataset.all === "1" ? null : card.dataset.folder;
    render();
  });

  listEl.addEventListener("change", async (e) => {
    const favSelect = e.target.closest(".fav-folder-select");
    if (favSelect) {
      await updateHighlight(favSelect.dataset.videoId, favSelect.dataset.key, { folder: favSelect.value });
      return; // odak kaybolmasın diye tüm listeyi yeniden çizmiyoruz; sayı/filtre bir sonraki render'da yansır
    }
    const select = e.target.closest(".folder-select");
    if (!select) return;
    await updateEntry(select.dataset.id, { folder: select.value });
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
      return;
    }
    // "Cümleler ile oynama" — favorilenen anın metnini yerinde düzenleme.
    const editFav = e.target.closest(".edit-fav");
    if (editFav) {
      const row = editFav.closest(".row");
      const snippetEl = row.querySelector(".snippet");
      const current = snippetEl.textContent.replace(/^"|"$/g, "");
      const wrap = document.createElement("div");
      wrap.innerHTML = `<textarea class="snippet-edit">${escapeHtml(current)}</textarea>
        <div class="edit-actions">
          <button class="save-fav" data-video-id="${editFav.dataset.videoId}" data-key="${editFav.dataset.key}">${t("modal_save")}</button>
          <button class="cancel-fav">${t("modal_cancel")}</button>
        </div>`;
      snippetEl.replaceWith(...wrap.childNodes);
      row.querySelector(".snippet-edit").focus();
      return;
    }
    const saveFav = e.target.closest(".save-fav");
    if (saveFav) {
      const row = saveFav.closest(".row");
      const text = row.querySelector(".snippet-edit").value.trim();
      if (text) await updateHighlight(saveFav.dataset.videoId, saveFav.dataset.key, { text });
      render();
      return;
    }
    if (e.target.closest(".cancel-fav")) { render(); }
  });
}

init();
