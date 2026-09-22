// skimcast (uzantı): content-claude.js — claude.ai/new sayfasında bekleyen prompt'u bulup yazar ve gönderir.
// Otomatik doldurma başarısız olursa sessizce bırakır: popup zaten prompt'u panoya kopyaladı,
// kullanıcı elle yapıştırıp gönderebilir. DOM seçicileri claude.ai güncellenirse bozulabilir;
// bu yüzden panoya kopyalama her zaman devrede kalan bir yedek.

const MAX_WAIT_MS = 8000;
const POLL_MS = 250;
const STALE_MS = 2 * 60 * 1000; // 2 dakikadan eski bekleyen prompt varsa (kapatılıp unutulmuş) doldurma

function findEditor() {
  return document.querySelector('div[contenteditable="true"][aria-label*="prompt" i], div[contenteditable="true"].ProseMirror');
}

function findSendButton() {
  return document.querySelector('button[aria-label="Send message"], button[aria-label*="Gönder" i]');
}

async function waitFor(check, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = check();
    if (el) return el;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return null;
}

async function fillAndSend(prompt) {
  const editor = await waitFor(findEditor, MAX_WAIT_MS);
  if (!editor) return false;
  editor.focus();
  document.execCommand("insertText", false, prompt);
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  const sendBtn = await waitFor(() => {
    const b = findSendButton();
    return b && !b.disabled ? b : null;
  }, 3000);
  if (!sendBtn) return false;
  sendBtn.click();
  return true;
}

(async () => {
  const { skimcastPrompt, skimcastPromptTs } = await chrome.storage.local.get(["skimcastPrompt", "skimcastPromptTs"]);
  if (!skimcastPrompt) return;
  await chrome.storage.local.remove(["skimcastPrompt", "skimcastPromptTs"]); // yalnızca bir kez dene
  if (!skimcastPromptTs || Date.now() - skimcastPromptTs > STALE_MS) return;
  await fillAndSend(skimcastPrompt);
})();
