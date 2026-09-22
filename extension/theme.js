// skimcast (uzantı): theme.js — açık/koyu temayı sayfalar arasında ortak uygular. popup, viewer ve
// library sayfalarının hepsi bunu yükler; chrome.storage.local'deki tek bir tercih (skimcastTheme)
// hepsinde aynı anda geçerli olur. İlk açılışta sistem tercihine göre başlar, sonrasında düğmeyle
// elle değiştirilen sabit bir seçimdir (otomatik sistem takibi yok — bilinçli olarak sade tutuldu).
const THEME_KEY = "skimcastTheme"; // "light" | "dark"

function systemDefault() {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

async function getTheme() {
  const { [THEME_KEY]: theme } = await chrome.storage.local.get(THEME_KEY);
  return theme || systemDefault();
}

function applyThemeAttr(theme) {
  document.documentElement.dataset.theme = theme;
}

async function initTheme() {
  applyThemeAttr(await getTheme());
}

async function toggleTheme() {
  const next = (await getTheme()) === "dark" ? "light" : "dark";
  await chrome.storage.local.set({ [THEME_KEY]: next });
  applyThemeAttr(next);
  return next;
}

// Her sayfa kendi başlığına bunu çağırıp bir tema düğmesi ekler. btn null gelirse (element henüz DOM'da
// yoksa/bulunamadıysa) sessizce çıkıyoruz — çökmek yerine.
async function mountThemeButton(btn) {
  if (!btn) return;
  const setIcon = (theme) => { btn.textContent = theme === "dark" ? "☀️" : "🌙"; };
  setIcon(await getTheme());
  btn.addEventListener("click", async () => setIcon(await toggleTheme()));
}

initTheme();
