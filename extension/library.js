// skimcast (uzantı): library.js — arşivlenmiş tüm transcript'lerin listesi, aralarında tam metin arama,
// "Dosyalarım" bölümünde klasörlere ayırma (ör. "Yapay Zeka", "Felsefe"; özel ikon/görsel, yeniden
// adlandırma, silme), sabitleme, sıralama ve tüm videolardaki favori (yıldızlanmış) anların tek bir
// yerde toplandığı "Favoriler" görünümü.

// Tırnak işaretlerini de kaçırıyor (önceki sürüm kaçırmıyordu) — video başlığı, favori metni, klasör
// adı gibi kullanıcı içeriği bir HTML özniteliğinin (data-id="...", title="..." gibi) içine konduğunda,
// metinde bir " geçerse önceki haliyle özniteliği erken kapatıp sayfayı bozabilirdi.
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtTime(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
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
// Aynı modal hem yeni klasör açmak hem var olanı düzenlemek (isim, ikon/görsel, not, sabitleme, silme,
// Markdown olarak dışa aktarma) için kullanılıyor. Ekranın ortasında açılır (window.prompt() değil).
// Kartın kendisi sade kalsın diye ("kafa karışıklığı olmadan") bu ek eylemler karta değil, buraya konuldu.
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
        <textarea id="modalFolderNote" class="folder-note-input" placeholder="${escapeHtml(t("folder_note_placeholder"))}">${escapeHtml(existing?.note || "")}</textarea>
        <label class="checkbox-row"><input type="checkbox" id="modalFolderPin"${existing?.pinned ? " checked" : ""}> ${t("pin_folder_label")}</label>
        ${isEdit ? `<button type="button" id="modalExport" class="link-btn">${t("export_folder_md_btn")}</button>` : ""}
        <div class="modal-actions">
          ${isEdit ? `<button id="modalDelete" class="danger">${t("modal_delete")}</button>` : ""}
          <span class="spacer"></span>
          <button id="modalCancel">${t("modal_cancel")}</button>
          <button id="modalSave" class="primary">${isEdit ? t("modal_save") : t("modal_create")}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector("#modalFolderName");
    const noteInput = overlay.querySelector("#modalFolderNote");
    const pinInput = overlay.querySelector("#modalFolderPin");
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
      close({ action: "save", name, icon, note: noteInput.value.trim(), pinned: pinInput.checked });
    });
    // Tarayıcının kendi confirm() penceresi ekranın üstünden, ortalanmamış çıkıyordu — kaldırıldı,
    // "Sil" artık doğrudan siliyor.
    overlay.querySelector("#modalDelete")?.addEventListener("click", () => close({ action: "delete" }));
    overlay.querySelector("#modalExport")?.addEventListener("click", () => close({ action: "export" }));
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
    // h.url: zaman damgasına atlayan link (jumpUrl'ün viewer.js'de kullandığı meta.linkPrefix + saniye
    // kalıbıyla aynı) — daha önce hiç set edilmiyordu, bu yüzden dışa aktarılan Markdown'daki "aç"
    // bağlantısı hep sessizce boş kalıyordu (h.url her zaman undefined'dı).
    for (const h of entry?.highlights || []) all.push({ ...h, videoId: meta.id, videoTitle: entry.meta.title, url: entry.meta?.linkPrefix });
  }
  return all.sort((a, b) => b.ts - a.ts);
}

function highlightRowHtml(h) {
  const folderTag = h.folder ? `<span class="mini-tag">${escapeHtml(h.folder)}</span>` : "";
  const noteLine = h.note ? `<div class="fav-note">📝 ${escapeHtml(h.note)}</div>` : "";
  return `
    <div class="row fav-row">
      <div class="row-main">
        <a class="title" href="viewer.html?id=${encodeURIComponent(h.videoId)}">${escapeHtml(h.videoTitle || "(başlıksız)")}</a>
        <div class="snippet">"${escapeHtml(h.text)}" ${folderTag}</div>
        ${noteLine}
      </div>
      <div class="row-actions">
        <button class="move-fav" data-video-id="${escapeHtml(h.videoId)}" data-key="${escapeHtml(h.key)}" title="${escapeHtml(t("move_to_folder_title"))}">📁</button>
        <button class="edit-fav" data-video-id="${escapeHtml(h.videoId)}" data-key="${escapeHtml(h.key)}" title="${escapeHtml(t("edit_folder_hint"))}">✎</button>
        <button class="unstar" data-video-id="${escapeHtml(h.videoId)}" data-key="${escapeHtml(h.key)}">${t("remove_fav_btn")}</button>
      </div>
    </div>`;
}

// Favoriyi (yıldızlanmış an) düzenlemek için: yeni bir sayfa değil, ortalanmış küçük bir panel
// (aynı modal deseni). Alıntının kendi metni + ayrıca (isteğe bağlı) kişisel bir not — ikisi ayrı
// şeyler: metin alıntının ta kendisi, not ise kullanıcının o alıntıya dair kendi yorumu.
function openEditFavModal(currentText, currentNote) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal modal-large">
        <h2>${t("edit_folder_hint")}</h2>
        <textarea id="editFavText" class="snippet-edit snippet-edit-large"></textarea>
        <textarea id="editFavNote" class="snippet-edit" placeholder="${escapeHtml(t("fav_note_placeholder"))}"></textarea>
        <div class="modal-actions"><span class="spacer"></span><button id="editCancel">${t("modal_cancel")}</button><button id="editSave" class="primary">${t("modal_save")}</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const textarea = overlay.querySelector("#editFavText");
    const noteArea = overlay.querySelector("#editFavNote");
    textarea.value = currentText; // innerHTML yerine .value: tırnak içeren metinlerde daha güvenli
    noteArea.value = currentNote || "";
    requestAnimationFrame(() => { textarea.focus(); textarea.selectionStart = textarea.value.length; });
    const close = (v) => { overlay.remove(); resolve(v); };
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(null); });
    overlay.querySelector("#editCancel").addEventListener("click", () => close(null));
    overlay.querySelector("#editSave").addEventListener("click", () => {
      const text = textarea.value.trim();
      if (!text) { close(null); return; }
      close({ text, note: noteArea.value.trim() });
    });
  });
}

// Bir favoriyi bir klasöre taşımak için: var olanlardan seç ya da yeni oluşturup direkt oraya taşı.
function openMoveFavModal(folders) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <h2>${t("move_to_folder_title")}</h2>
        <div class="folder-picker-list">
          <button class="folder-pick" data-folder="">📂 ${escapeHtml(t("no_folder"))}</button>
          ${folders.map((f) => `<button class="folder-pick" data-folder="${escapeHtml(f.name)}">${iconHtml(f.icon)} ${escapeHtml(f.name)}</button>`).join("")}
        </div>
        <div class="modal-actions">
          <input id="newFolderInline" placeholder="${escapeHtml(t("new_folder_name_placeholder"))}">
          <button id="createAndMove" class="primary">${t("modal_create")}</button>
        </div>
        <div class="modal-actions"><span class="spacer"></span><button id="moveCancel">${t("modal_cancel")}</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const close = (v) => { overlay.remove(); resolve(v); };
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(null); });
    overlay.querySelector("#moveCancel").addEventListener("click", () => close(null));
    overlay.querySelectorAll(".folder-pick").forEach((btn) => {
      btn.addEventListener("click", () => close({ folder: btn.dataset.folder, isNew: false }));
    });
    const nameInput = overlay.querySelector("#newFolderInline");
    const createAndMove = () => {
      const name = nameInput.value.trim();
      if (name) close({ folder: name, isNew: true });
    };
    overlay.querySelector("#createAndMove").addEventListener("click", createAndMove);
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") createAndMove(); });
  });
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

// ------------------------------------------------------------ "bunu hatırlıyor musun?" (eski favorileri hatırlatma)
// Readwise'ın "resurfacing" fikri: arşive kaydedip unuttuğun eski favorileri zaman zaman tekrar karşına
// çıkarmak. Günlük, deterministik bir seçim yapıyoruz (Date.now()'a göre sabit bir indeks) — böylece aynı
// gün içinde sayfa her açıldığında AYNI an gösteriliyor (rastgele her seferinde değişip can sıkmıyor),
// ertesi gün otomatik değişiyor. En az 2 gün eski favoriler arasından seçiyoruz — az önce eklenen bir şeyi
// "hatırlat" demenin bir anlamı yok.
const RESURFACE_MIN_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const RESURFACE_DISMISS_KEY = "skimcastResurfaceDismissed";

function pickResurfaceHighlight(allHighlights) {
  const eligible = allHighlights.filter((h) => h.starred !== false && Date.now() - h.ts >= RESURFACE_MIN_AGE_MS);
  if (!eligible.length) return null;
  const dayIndex = Math.floor(Date.now() / 86400000);
  return eligible[dayIndex % eligible.length];
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

async function isDismissedToday(hKey) {
  const { [RESURFACE_DISMISS_KEY]: d } = await chrome.storage.local.get(RESURFACE_DISMISS_KEY);
  return !!d && d.date === todayStr() && d.key === hKey;
}

async function dismissResurfaceToday(hKey) {
  await chrome.storage.local.set({ [RESURFACE_DISMISS_KEY]: { date: todayStr(), key: hKey } });
}

async function renderResurfaceCard(allHighlights) {
  const card = document.getElementById("resurfaceCard");
  if (!card) return;
  const pick = pickResurfaceHighlight(allHighlights);
  if (!pick || await isDismissedToday(pick.key)) { card.innerHTML = ""; return; }
  card.innerHTML = `
    <div class="resurface-card">
      <button class="resurface-close" title="${escapeHtml(t("modal_cancel"))}">×</button>
      <div class="resurface-label">${t("resurface_label")}</div>
      <a class="resurface-link" href="viewer.html?id=${encodeURIComponent(pick.videoId)}">
        <div class="resurface-snippet">"${escapeHtml(pick.text)}"</div>
        <div class="resurface-meta">${escapeHtml(pick.videoTitle || "")} · ${relativeDate(pick.ts)}</div>
      </a>
    </div>`;
  card.querySelector(".resurface-close").addEventListener("click", async (e) => {
    e.preventDefault();
    await dismissResurfaceToday(pick.key);
    card.innerHTML = "";
  });
}

// ------------------------------------------------------------ notlar (bağımsız içerik türü)
// Videolardan/favorilerden bağımsız, kendi başına bir içerik türü: sıfırdan bir not oluşturabilir,
// videolar/favoriler gibi bir klasöre taşıyabilir YA DA hiç klasöre koymadan "Tümü" görünümünde
// bırakabilirsin — aynı VİDEOLAR için geçerli olan mantık (bkz. renderList: "Tümü" hepsini gösterir,
// belirli bir klasör sadece o klasördekileri).
const NOTES_KEY = "skimcastNotes";

async function getNotes() {
  const { [NOTES_KEY]: notes = [] } = await chrome.storage.local.get(NOTES_KEY);
  return notes;
}

async function saveNotes(notes) {
  await chrome.storage.local.set({ [NOTES_KEY]: notes });
}

function newNoteId() {
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function noteRowHtml(n) {
  const folderTag = n.folder ? `<span class="mini-tag">${escapeHtml(n.folder)}</span>` : "";
  const preview = n.body.length > 140 ? `${n.body.slice(0, 140)}…` : n.body;
  // Bir video notundan "Notlarıma Taşı" ile gelmişse, kaynağa geri dönebilesin diye bir bağlantı kalıyor.
  const sourceLink = n.sourceUrl ? `<a class="note-source" href="${escapeHtml(n.sourceUrl)}" target="_blank">🎬 ${escapeHtml(n.sourceTitle || n.sourceUrl)}</a>` : "";
  return `
    <div class="row note-row">
      <div class="row-main">
        <div class="title note-title">📝 ${escapeHtml(n.title || t("untitled_note"))}</div>
        <div class="snippet">${escapeHtml(preview)} ${folderTag}</div>
        <div class="row-meta">${relativeDate(n.ts)} ${sourceLink}</div>
      </div>
      <div class="row-actions">
        <button class="move-note" data-note-id="${escapeHtml(n.id)}" title="${escapeHtml(t("move_to_folder_title"))}">📁</button>
        <button class="edit-note" data-note-id="${escapeHtml(n.id)}" title="${escapeHtml(t("edit_folder_hint"))}">✎</button>
      </div>
    </div>`;
}

// Yeni not oluşturmak İÇİN de, var olan bir notu düzenlemek İÇİN de aynı panel — başlık + gövde.
// existing verilirse "Sil" düğmesi de eklenir.
function openNoteModal(existing) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal modal-large">
        <h2>${existing ? t("edit_note_title") : t("new_note_title")}</h2>
        <input id="noteTitleInput" class="note-title-input" placeholder="${escapeHtml(t("note_title_placeholder"))}">
        <textarea id="noteBodyInput" class="snippet-edit snippet-edit-large" placeholder="${escapeHtml(t("note_body_placeholder"))}"></textarea>
        <div class="modal-actions">
          <span class="spacer"></span>
          ${existing ? `<button id="noteDeleteBtn">${t("modal_delete")}</button>` : ""}
          <button id="noteCancelBtn">${t("modal_cancel")}</button>
          <button id="noteSaveBtn" class="primary">${t("modal_save")}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const titleInput = overlay.querySelector("#noteTitleInput");
    const bodyInput = overlay.querySelector("#noteBodyInput");
    titleInput.value = existing?.title || "";
    bodyInput.value = existing?.body || "";
    requestAnimationFrame(() => titleInput.focus());
    const close = (v) => { overlay.remove(); resolve(v); };
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(null); });
    overlay.querySelector("#noteCancelBtn").addEventListener("click", () => close(null));
    if (existing) {
      overlay.querySelector("#noteDeleteBtn").addEventListener("click", () => close({ delete: true }));
    }
    overlay.querySelector("#noteSaveBtn").addEventListener("click", () => {
      const title = titleInput.value.trim();
      const body = bodyInput.value.trim();
      if (!title && !body) { close(null); return; }
      close({ title, body });
    });
  });
}

async function init() {
  await initLang();
  const app = document.getElementById("app");
  app.innerHTML = `
    <header class="header-top">
      <div>
        <a class="back" href="popup.html?standalone=1">${t("popup_title")}</a>
        <h1>${t("library_title")}</h1>
      </div>
      <div class="header-btns">
        <button id="langBtn" class="theme-btn" title="Language"></button>
        <button id="themeBtn" class="theme-btn" title="${escapeHtml(t("theme_btn"))}"></button>
      </div>
    </header>
    <input id="search" class="search-input" type="text" placeholder="${escapeHtml(t("library_search_placeholder"))}">
    <div id="resurfaceCard"></div>

    <div class="view-tabs">
      <button id="filesTabBtn" class="tab-btn active">🗂️ ${t("files_tab")}</button>
      <button id="notesTabBtn" class="tab-btn">📝 ${t("notes_tab")}</button>
    </div>

    <section class="folders-section" id="foldersSection">
      <h2>${t("folders_section_title")}</h2>
      <div id="folders" class="folder-grid"></div>
    </section>

    <div class="controls-row" id="controlsRow">
      <select id="sortBy">
        <option value="newest">${t("sort_newest")}</option>
        <option value="oldest">${t("sort_oldest")}</option>
        <option value="title">${t("sort_title")}</option>
      </select>
      <button id="favViewBtn" class="toggle-btn"><span class="star-ico">☆</span> ${t("fav_view_btn")}</button>
    </div>
    <div id="list"></div>

    <section class="notes-section" id="notesSection" hidden>
      <div class="folder-grid">
        <button class="folder-card folder-card-add" id="newNoteBtn">
          <span class="folder-icon">＋</span>
          <span class="folder-name">${t("new_note_title")}</span>
        </button>
      </div>
      <div id="notesList"></div>
    </section>

    <footer class="backup-footer">
      <button id="backupBtn" class="link-btn">${t("backup_btn")}</button>
      <span class="dot">·</span>
      <button id="restoreBtn" class="link-btn">${t("restore_btn")}</button>
      <input type="file" id="restoreFile" accept="application/json" hidden>
    </footer>
    <div id="toast" class="toast"></div>
  `;
  mountThemeButton(document.getElementById("themeBtn"));
  mountLangButton(document.getElementById("langBtn"));

  const toastEl = document.getElementById("toast");
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
  }

  const listEl = document.getElementById("list");
  const notesListEl = document.getElementById("notesList");
  const notesSectionEl = document.getElementById("notesSection");
  const foldersSectionEl = document.getElementById("foldersSection");
  const controlsRowEl = document.getElementById("controlsRow");
  const filesTabBtn = document.getElementById("filesTabBtn");
  const notesTabBtn = document.getElementById("notesTabBtn");
  const foldersEl = document.getElementById("folders");
  const searchInput = document.getElementById("search");
  const sortSelect = document.getElementById("sortBy");
  const favViewBtn = document.getElementById("favViewBtn");
  let index = await getIndex();
  let folders = await getFolders();
  let favView = false;
  let activeFolder = null; // null = Tümü
  // "Dosyalarım" (klasörler+videolar) ile "Notlarım" arasında geçiş yapan üstteki iki sekme — kullanıcı
  // notların video listesinin çok altında kalmasından ("notlar çok altta kalıyor") rahatsızdı; artık iki
  // ayrı, birbirine karışmayan taraf: bir sekme aktifken diğerinin bölümü tamamen gizleniyor.
  let viewMode = "files"; // "files" | "notes"

  function setViewMode(mode) {
    viewMode = mode;
    filesTabBtn.classList.toggle("active", mode === "files");
    notesTabBtn.classList.toggle("active", mode === "notes");
    render();
  }
  filesTabBtn.addEventListener("click", () => setViewMode("files"));
  notesTabBtn.addEventListener("click", () => setViewMode("notes"));

  // Bir klasörün "içeriği" hem o klasöre atanmış VİDEOLARDAN hem de o klasöre taşınmış FAVORİLERDEN
  // oluşuyor — ikisi ayrı sistemlerdi (video.folder / highlight.folder), bu yüzden bir favoriyi
  // klasöre taşımak "taşındı" diyordu ama o klasöre tıklayınca (sadece videoları gösteren renderList)
  // hiçbir şey görünmüyordu, sayaç da sadece videoları saydığı için 0 kalıyordu. Artık ikisi de aynı
  // sayımda ve aynı listede birleşiyor.
  function countFor(name, allHighlights) {
    if (name === null) return index.length; // "Tümü" = video kütüphanesi
    const videoCount = index.filter((e) => e.folder === name).length;
    const favCount = allHighlights.filter((h) => (h.folder || NO_FOLDER) === name).length;
    return videoCount + favCount;
  }

  function renderFolderCards(allHighlights) {
    // Sabitlenen klasörler ("📌 Bu klasörü sabitle") en sık kullandıklarında her seferinde aramamak için
    // en başa geliyor — "Tümü" her zaman ilk sırada kalıyor.
    const sortedFolders = [...folders].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    const cards = [{ name: null, label: t("all_folders"), icon: "🗂️", system: true },
      ...sortedFolders.map((f) => ({ name: f.name, label: f.name, icon: f.icon, note: f.note, pinned: f.pinned }))];
    foldersEl.innerHTML = cards.map((f) => `
      <div class="folder-card${activeFolder === f.name ? " active" : ""}${f.pinned ? " pinned" : ""}" data-folder="${escapeHtml(f.name ?? "")}" data-all="${f.system ? "1" : "0"}"${f.note ? ` title="${escapeHtml(f.note)}"` : ""}>
        ${!f.system ? `<button class="folder-edit-btn" data-folder="${escapeHtml(f.name)}" title="${escapeHtml(t("edit_folder_hint"))}">✎</button>` : ""}
        <span class="folder-icon">${iconHtml(f.icon)}</span>
        <span class="folder-name">${escapeHtml(f.label)}</span>
        <span class="folder-count">${countFor(f.name, allHighlights)}</span>
      </div>`).join("") +
      `<button class="folder-card folder-card-add" id="newFolderBtn">
        <span class="folder-icon">＋</span>
        <span class="folder-name">${t("new_folder_option").replace("…", "")}</span>
      </button>`;
  }

  // "Dosyalarım" listesi: videolar + (belirli bir klasördeyken) o klasöre taşınmış favoriler. Notlar
  // artık burada DEĞİL — kendi "Notlarım" başlığı altında, renderNotesList() ile ayrı gösteriliyor.
  function renderList(allHighlights) {
    const filtered = activeFolder === null ? index : index.filter((e) => e.folder === activeFolder);
    const sorted = sortIndex(filtered, sortSelect.value);
    let html = sorted.map((e) => entryRowHtml(e, folders)).join("");
    if (activeFolder !== null) {
      const favsHere = allHighlights.filter((h) => (h.folder || NO_FOLDER) === activeFolder);
      html += favsHere.map(highlightRowHtml).join("");
    }
    listEl.innerHTML = html || `<p class="hint">${t("library_empty")}</p>`;
  }

  // "Notlarım" sekmesi: "Dosyalarım"dan tamamen ayrı bir taraf — hangi not varsa hepsi burada, klasör
  // filtresine bağlı değil (bir notun klasörü varsa satırında etiket olarak görünüyor, ama Notlarım
  // sekmesi kendi başına her zaman TÜM notları listeliyor).
  function renderNotesList(allNotes) {
    notesListEl.innerHTML = allNotes.length ? allNotes.map(noteRowHtml).join("") : `<p class="hint">${t("no_notes")}</p>`;
  }

  async function renderSearch(query) {
    const results = await searchArchive(query, index);
    if (results === null) { renderList(await getAllHighlights(index)); return; }
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

  function renderFavoritesView(allHighlights) {
    const filtered = activeFolder === null ? allHighlights : allHighlights.filter((h) => (h.folder || NO_FOLDER) === activeFolder);
    listEl.innerHTML = filtered.length ? filtered.map(highlightRowHtml).join("") : `<p class="hint">${t("no_favorites")}</p>`;
  }

  // Bir klasörün içeriğini (videolar + favoriler) tek bir Markdown dosyası olarak indirir — Obsidian/
  // Notion gibi not araçlarına doğrudan taşınabilsin diye. Hiçbir API/ağ isteği yok, tamamen yerel.
  async function exportFolderMarkdown(folderName) {
    const allHighlights = await getAllHighlights(index);
    const videos = index.filter((e) => e.folder === folderName);
    const favs = allHighlights.filter((h) => (h.folder || NO_FOLDER) === folderName);
    const folder = folders.find((f) => f.name === folderName);

    let md = `# ${folderName}\n\n`;
    if (folder?.note) md += `_${folder.note}_\n\n`;

    if (videos.length) {
      md += `## ${t("export_md_videos_heading")}\n\n`;
      const records = await chrome.storage.local.get(videos.map((v) => archiveKey(v.id)));
      for (const v of videos) {
        const url = records[archiveKey(v.id)]?.url || "";
        const meta = [v.method, v.duration].filter(Boolean).join(" · ");
        md += url ? `- [${v.title || "(başlıksız)"}](${url}) — ${meta}\n` : `- ${v.title || "(başlıksız)"} — ${meta}\n`;
      }
      md += "\n";
    }

    if (favs.length) {
      md += `## ${t("export_md_favorites_heading")}\n\n`;
      for (const h of favs) {
        const timeLabel = h.sec != null ? ` [${fmtTime(h.sec)}]` : "";
        const link = h.url && h.sec != null ? `${h.url}${Math.floor(h.sec)}` : "";
        md += `> ${h.text}\n> — ${h.videoTitle || "(başlıksız)"}${timeLabel}${link ? ` — [${t("open_link_label")}](${link})` : ""}\n`;
        if (h.note) md += `\n📝 ${h.note}\n`;
        md += "\n";
      }
    }

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${folderName.replace(/[\\/:*?"<>|]+/g, " ").trim()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function render() {
    // İki sekme birbirini tamamen dışlıyor: "Notlarım" açıkken "Dosyalarım" tarafının hiçbir parçası
    // (klasörler, sırala/favori kontrolleri, video listesi) görünmüyor, tersi de öyle — notlar artık
    // sayfanın en altına gömülü değil, tek tıkla kendi tarafına geçiliyor.
    if (viewMode === "notes") {
      foldersSectionEl.hidden = true;
      controlsRowEl.hidden = true;
      listEl.hidden = true;
      notesSectionEl.hidden = false;
      renderNotesList(await getNotes());
      return;
    }
    foldersSectionEl.hidden = false;
    controlsRowEl.hidden = false;
    listEl.hidden = false;
    notesSectionEl.hidden = true;

    const allHighlights = await getAllHighlights(index);
    renderFolderCards(allHighlights);
    if (favView) { renderFavoritesView(allHighlights); return; }
    searchInput.value.trim() ? await renderSearch(searchInput.value) : renderList(allHighlights);
  }

  await render();
  await renderResurfaceCard(await getAllHighlights(index));

  // ------------------------------------------------------------ yedekle / geri yükle
  // Tüm klasör/favori/video verisi tarayıcının kendi deposunda duruyor — profil silinirse ya da
  // bilgisayar değişirse hepsi gider. Tek dosyaya yedekleyip başka bir profilde geri yüklemek için.
  document.getElementById("backupBtn").addEventListener("click", async () => {
    const all = await chrome.storage.local.get(null);
    const backup = {};
    for (const k in all) {
      if (k.startsWith("skimcastArchive:") || k === ARCHIVE_INDEX_KEY || k === FOLDERS_KEY) backup[k] = all[k];
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `skimcast-yedek-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(t("backup_done_toast"));
  });

  function openRestoreConfirmModal() {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML = `
        <div class="modal">
          <h2>${t("restore_btn")}</h2>
          <p class="hint">${t("restore_warning")}</p>
          <div class="modal-actions"><span class="spacer"></span><button id="restoreCancel">${t("modal_cancel")}</button><button id="restoreConfirm" class="primary">${t("restore_confirm_btn")}</button></div>
        </div>`;
      document.body.appendChild(overlay);
      const close = (v) => { overlay.remove(); resolve(v); };
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(false); });
      overlay.querySelector("#restoreCancel").addEventListener("click", () => close(false));
      overlay.querySelector("#restoreConfirm").addEventListener("click", () => close(true));
    });
  }

  const restoreFile = document.getElementById("restoreFile");
  document.getElementById("restoreBtn").addEventListener("click", () => restoreFile.click());
  restoreFile.addEventListener("change", async () => {
    const file = restoreFile.files?.[0];
    restoreFile.value = ""; // aynı dosyayı tekrar seçebilmek için
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      showToast(t("restore_invalid_toast"));
      return;
    }
    if (!(await openRestoreConfirmModal())) return;
    await chrome.storage.local.set(data);
    index = await getIndex();
    folders = await getFolders();
    showToast(t("restore_done_toast"));
    render();
  });

  searchInput.addEventListener("input", () => { if (!favView) render(); });
  sortSelect.addEventListener("change", render);
  favViewBtn.addEventListener("click", () => {
    favView = !favView;
    favViewBtn.classList.toggle("active", favView);
    favViewBtn.querySelector(".star-ico").textContent = favView ? "★" : "☆";
    searchInput.disabled = favView;
    sortSelect.disabled = favView;
    render();
  });

  foldersEl.addEventListener("click", async (e) => {
    if (e.target.closest("#newFolderBtn")) {
      const result = await openFolderModal();
      if (result?.action === "save") {
        if (folders.some((f) => f.name === result.name)) { activeFolder = result.name; render(); return; }
        folders.push({ name: result.name, icon: result.icon, note: result.note, pinned: result.pinned });
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
        folders = folders.map((f) => (f.name === current.name
          ? { name: result.name, icon: result.icon, note: result.note, pinned: result.pinned } : f));
        await saveFolders(folders);
        index = await getIndex();
        if (activeFolder === current.name) activeFolder = result.name;
      } else if (result?.action === "delete") {
        await reassignFolder(current.name, NO_FOLDER);
        folders = folders.filter((f) => f.name !== current.name);
        await saveFolders(folders);
        index = await getIndex();
        if (activeFolder === current.name) activeFolder = null;
      } else if (result?.action === "export") {
        await exportFolderMarkdown(current.name);
        return; // veri değişmedi, yeniden çizmeye gerek yok
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
    // "Cümleler ile oynama" — favorilenen anın metnini küçük bir panelde düzenleme.
    const editFav = e.target.closest(".edit-fav");
    if (editFav) {
      // DOM'dan metni ayrıştırmak yerine (tırnak içeren cümlelerde kırılgan) depodan taze okuyoruz.
      const fk = archiveKey(editFav.dataset.videoId);
      const { [fk]: full } = await chrome.storage.local.get(fk);
      const h = full?.highlights?.find((x) => x.key === editFav.dataset.key);
      if (!h) return;
      const result = await openEditFavModal(h.text, h.note);
      if (result) {
        await updateHighlight(editFav.dataset.videoId, editFav.dataset.key, { text: result.text, note: result.note });
        showToast(t("modal_save"));
      }
      render();
      return;
    }
    const moveFav = e.target.closest(".move-fav");
    if (moveFav) {
      const result = await openMoveFavModal(folders);
      if (!result) return;
      if (result.isNew) {
        if (!folders.some((f) => f.name === result.folder)) {
          folders.push({ name: result.folder, icon: "📁" });
          await saveFolders(folders);
        }
      }
      await updateHighlight(moveFav.dataset.videoId, moveFav.dataset.key, { folder: result.folder });
      showToast(result.folder ? `${t("moved_to_folder_toast")} "${result.folder}"` : t("removed_from_folder_toast"));
      render();
    }
  });

  // "Notlarım" kendi listesinde (#notesList), video listesinden (#list) ayrı — bu yüzden düzenle/taşı
  // düğmeleri de kendi dinleyicisinde.
  notesListEl.addEventListener("click", async (e) => {
    const editNote = e.target.closest(".edit-note");
    if (editNote) {
      const notes = await getNotes();
      const n = notes.find((x) => x.id === editNote.dataset.noteId);
      if (!n) return;
      const result = await openNoteModal(n);
      if (!result) return;
      if (result.delete) {
        await saveNotes(notes.filter((x) => x.id !== n.id));
        showToast(t("modal_delete"));
      } else {
        await saveNotes(notes.map((x) => (x.id === n.id ? { ...x, title: result.title, body: result.body } : x)));
        showToast(t("modal_save"));
      }
      render();
      return;
    }
    const moveNote = e.target.closest(".move-note");
    if (moveNote) {
      const result = await openMoveFavModal(folders);
      if (!result) return;
      if (result.isNew && !folders.some((f) => f.name === result.folder)) {
        folders.push({ name: result.folder, icon: "📁" });
        await saveFolders(folders);
      }
      const notes = await getNotes();
      await saveNotes(notes.map((x) => (x.id === moveNote.dataset.noteId ? { ...x, folder: result.folder } : x)));
      showToast(result.folder ? `${t("moved_to_folder_toast")} "${result.folder}"` : t("removed_from_folder_toast"));
      render();
    }
  });

  // "+ Yeni Not" — sıfırdan, hiçbir videoya bağlı olmayan bir not oluşturur; sonra istersen "📁" ile
  // bir klasöre taşıyabilirsin, taşımazsan "Tümü" görünümünde durmaya devam eder (VİDEOLARLA aynı mantık).
  document.getElementById("newNoteBtn").addEventListener("click", async () => {
    const result = await openNoteModal(null);
    if (!result) return;
    const notes = await getNotes();
    notes.unshift({ id: newNoteId(), title: result.title, body: result.body, folder: "", ts: Date.now() });
    await saveNotes(notes);
    showToast(t("modal_save"));
    render();
  });
}

init();
