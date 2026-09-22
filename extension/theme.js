// skimcast (uzantı): theme.js — açık/koyu/sistem temasını sayfalar arasında ortak uygular. popup,
// viewer ve library sayfalarının hepsi bunu yükler; chrome.storage.local'deki tek bir tercih
// (skimcastTheme) hepsinde aynı anda geçerli olur. CSS tarafı her sayfanın kendi .css dosyasında
// :root[data-theme="dark"] / (data-theme yoksa) prefers-color-scheme ile tanımlı.
const THEME_KEY = "skimcastTheme"; // "light" | "dark" | "system" (varsayılan)
const THEME_ORDER = ["system", "light", "dark"];
const THEME_ICON = { system: "🖥️", light: "☀️", dark: "🌙" };

async function getTheme() {
  const { [THEME_KEY]: theme = "system" } = await chrome.storage.local.get(THEME_KEY);
  return theme;
}

function applyThemeAttr(theme) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
}

async function initTheme() {
  applyThemeAttr(await getTheme());
}

async function cycleTheme() {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(await getTheme()) + 1) % THEME_ORDER.length];
  await chrome.storage.local.set({ [THEME_KEY]: next });
  applyThemeAttr(next);
  return next;
}

// Her sayfa kendi başlığına bunu çağırıp bir tema düğmesi ekler.
async function mountThemeButton(btn) {
  btn.textContent = THEME_ICON[await getTheme()];
  btn.addEventListener("click", async () => { btn.textContent = THEME_ICON[await cycleTheme()]; });
}

initTheme();
