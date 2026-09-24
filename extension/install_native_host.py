#!/usr/bin/env python3
"""skimcast uzantısı için tek seferlik kurulum: native messaging host'u kayıtlı bulunan Chromium
tabanlı tarayıcılara (Chrome, Edge, Chromium, Brave) kaydeder.

Bundan sonra tarayıcı, uzantı YouTube transcript'i istediğinde skills/summarize/native_host.py'yi
kendisi anlık olarak başlatır ve kapatır — elle açıp bırakman gereken bir sunucu yok.

Kullanım:  python3 extension/install_native_host.py
           (Windows'ta "python3" değil "python" yaz — o komut orada genelde yok, "python3 komutu
           bulunamadı" hatası alırsan bu yüzdendir. Önce Python 3'ü python.org'dan kur, kurulum
           ekranında "Add python.exe to PATH" kutucuğunu işaretle.)

NOT: macOS/Linux VE Windows tarafı artık gerçek makinelerde doğrulandı (Windows: Chrome'da test
edildi ve çalıştı; Edge'de de aynı kayıt mekanizması kullanıldığı için çalışması bekleniyor).
"""

import sys

sys.dont_write_bytecode = True  # bu klasörde __pycache__ oluşmasın: Chrome/Edge "_" ile başlayan
# klasör/dosya adlarını (extension/ paketlenmemiş öğe olarak yüklenirken) reddediyor

import json
import stat
from pathlib import Path

HOST_NAME = "com.skimcast.native_host"
EXTENSION_ID = "fkhohoagmipbmdabglegihkclhelefna"  # extension/manifest.json'daki "key" alanından türetildi

# Her tarayıcının native messaging host kayıtlarını aradığı klasör farklı; hepsine yazıyoruz
# (kayıtlı olmayan tarayıcı için klasör oluşturmak zararsız, sadece kullanılmaz).
MAC_DIRS = {
    "Chrome": "Library/Application Support/Google/Chrome/NativeMessagingHosts",
    "Chrome Beta": "Library/Application Support/Google/Chrome Beta/NativeMessagingHosts",
    "Chromium": "Library/Application Support/Chromium/NativeMessagingHosts",
    "Edge": "Library/Application Support/Microsoft Edge/NativeMessagingHosts",
    "Brave": "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
}
LINUX_DIRS = {
    "Chrome": ".config/google-chrome/NativeMessagingHosts",
    "Chromium": ".config/chromium/NativeMessagingHosts",
    "Edge": ".config/microsoft-edge/NativeMessagingHosts",
    "Brave": ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts",
}
# Windows: dosya yolu değil, HKEY_CURRENT_USER altında bir registry anahtarı — değeri manifest JSON
# dosyasının tam yolu. https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
WIN_REGISTRY_KEYS = {
    "Chrome": r"Software\Google\Chrome\NativeMessagingHosts",
    "Chromium": r"Software\Chromium\NativeMessagingHosts",
    "Edge": r"Software\Microsoft\Edge\NativeMessagingHosts",
    "Brave": r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
}


def build_manifest_and_launcher(repo_root: Path, host_script: Path) -> tuple:
    """Platforma göre bir başlatıcı betik (mac/linux: .sh, Windows: .bat) ve onu gösteren native
    messaging manifest'ini (dict) üretir. Ortak mantık üç platform için de aynı: tarayıcı bu betiği
    kısıtlı bir PATH ile başlattığı için doğrudan "python3"e değil, şu an çalışan yorumlayıcının TAM
    yoluna sabitlenmiş bir kabuk betiğine işaret ediyoruz (aksi halde en sık görülen "Native host has
    exited" hatası oluyor); stderr de teşhis için bir günlük dosyasına yazılıyor."""
    if sys.platform == "win32":
        log_dir = Path.home() / "AppData" / "Local" / "skimcast"
        log_dir.mkdir(parents=True, exist_ok=True)
        launcher = repo_root / "skills" / "summarize" / "native_host_launcher.bat"
        launcher.write_text(
            "@echo off\r\n"
            f'"{sys.executable}" "{host_script}" %* 2>>"{log_dir}\\native_host.log"\r\n',
            encoding="utf-8",
        )
    else:
        log_dir = Path.home() / ".cache" / "skimcast"
        log_dir.mkdir(parents=True, exist_ok=True)
        launcher = repo_root / "skills" / "summarize" / "native_host_launcher.sh"
        launcher.write_text(
            "#!/bin/sh\n"
            f'exec "{sys.executable}" "{host_script}" "$@" 2>>"{log_dir}/native_host.log"\n',
            encoding="utf-8",
        )
        launcher.chmod(launcher.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    manifest = {
        "name": HOST_NAME,
        "description": "skimcast: YouTube/podcast transcript yardımcı programı",
        "path": str(launcher),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{EXTENSION_ID}/"],
    }
    return manifest, launcher, log_dir


def install_unix(manifest: dict) -> list:
    dirs = MAC_DIRS if sys.platform == "darwin" else LINUX_DIRS
    body = json.dumps(manifest, indent=2, ensure_ascii=False)
    written = []
    for name, rel in dirs.items():
        out_dir = Path.home() / rel
        # tarayıcının kendi "Application Support"/".config" klasörü yoksa muhtemelen kurulu değil;
        # boşuna klasör açma.
        if not out_dir.parent.exists():
            continue
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{HOST_NAME}.json").write_text(body, encoding="utf-8")
        written.append(name)
    return written


def install_windows(manifest: dict, repo_root: Path) -> list:
    import winreg

    manifest_path = repo_root / "skills" / "summarize" / f"{HOST_NAME}.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    written = []
    for name, reg_path in WIN_REGISTRY_KEYS.items():
        try:
            key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, f"{reg_path}\\{HOST_NAME}")
            winreg.SetValueEx(key, "", 0, winreg.REG_SZ, str(manifest_path))
            winreg.CloseKey(key)
            written.append(name)
        except OSError:
            continue
    return written


def main() -> None:
    if sys.platform not in ("darwin", "win32") and not sys.platform.startswith("linux"):
        raise SystemExit(f"Desteklenmeyen platform: {sys.platform}")

    repo_root = Path(__file__).resolve().parent.parent
    host_script = repo_root / "skills" / "summarize" / "native_host.py"
    if not host_script.exists():
        raise SystemExit(f"Bulunamadı: {host_script}")
    if sys.platform != "win32":
        host_script.chmod(host_script.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    manifest, launcher, log_dir = build_manifest_and_launcher(repo_root, host_script)
    written = install_windows(manifest, repo_root) if sys.platform == "win32" else install_unix(manifest)

    if not written:
        raise SystemExit("Desteklenen bir tarayıcı (Chrome/Edge/Chromium/Brave) bulunamadı.")
    print(f"Yardımcı program: {host_script}")
    print(f"Başlatıcı: {launcher}")
    print(f"Kaydedildi: {', '.join(written)}")
    print("Kullandığın tarayıcıyı tamamen kapat ve yeniden aç, sonra uzantıdan YouTube linkiyle dene.")
    print(f"Sorun olursa günlük: {log_dir}\\native_host.log" if sys.platform == "win32" else f"Sorun olursa günlük: {log_dir}/native_host.log")


if __name__ == "__main__":
    main()
