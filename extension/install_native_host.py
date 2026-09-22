#!/usr/bin/env python3
"""skimcast uzantısı için tek seferlik kurulum: native messaging host'u kayıtlı bulunan Chromium
tabanlı tarayıcılara (Chrome, Edge, Chromium, Brave) kaydeder.

Bundan sonra tarayıcı, uzantı YouTube transcript'i istediğinde skills/summarize/native_host.py'yi
kendisi anlık olarak başlatır ve kapatır — elle açıp bırakman gereken bir sunucu yok.

Kullanım:  python3 extension/install_native_host.py
"""

import sys

sys.dont_write_bytecode = True  # bu klasörde __pycache__ oluşmasın: Chrome/Edge "_" ile başlayan
# klasör/dosya adlarını (extension/ paketlenmemiş öğe olarak yüklenirken) reddediyor

import json  # noqa: E402
import stat  # noqa: E402
from pathlib import Path  # noqa: E402

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


def hosts_dirs() -> dict:
    home = Path.home()
    if sys.platform == "darwin":
        return {name: home / rel for name, rel in MAC_DIRS.items()}
    if sys.platform.startswith("linux"):
        return {name: home / rel for name, rel in LINUX_DIRS.items()}
    if sys.platform == "win32":
        raise SystemExit(
            "Windows'ta kayıt bir registry anahtarı gerektirir; bu betik yalnızca macOS/Linux'u destekler.\n"
            "Elle kurulum: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging#native-messaging-host-location"
        )
    raise SystemExit(f"Desteklenmeyen platform: {sys.platform}")


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    host_script = repo_root / "skills" / "summarize" / "native_host.py"
    if not host_script.exists():
        raise SystemExit(f"Bulunamadı: {host_script}")

    host_script.chmod(host_script.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    # Tarayıcı bu betiği bir GUI uygulaması olarak başlatır; PATH'i Terminal'inkinden çok daha kısıtlı
    # olabilir ve "python3" hiç bulunamayabilir ("Native host has exited" hatasının en sık sebebi).
    # Bu yüzden doğrudan native_host.py'ye değil, şu an çalışan python3'ün TAM yoluna sabitlenmiş bir
    # kabuk betiğine işaret ediyoruz. stderr de ileride teşhis için bir günlük dosyasına yazılıyor.
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
    body = json.dumps(manifest, indent=2, ensure_ascii=False)

    written = []
    for name, out_dir in hosts_dirs().items():
        # tarayıcının kendi "Application Support" klasörü yoksa muhtemelen kurulu değil; boşuna klasör açma
        if not out_dir.parent.exists():
            continue
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{HOST_NAME}.json").write_text(body, encoding="utf-8")
        written.append(name)

    if not written:
        raise SystemExit("Desteklenen bir tarayıcı (Chrome/Edge/Chromium/Brave) bulunamadı.")
    print(f"Yardımcı program: {host_script}")
    print(f"Başlatıcı: {launcher}")
    print(f"Kaydedildi: {', '.join(written)}")
    print("Kullandığın tarayıcıyı tamamen kapat ve yeniden aç, sonra uzantıdan YouTube linkiyle dene.")
    print(f"Sorun olursa günlük: {log_dir}/native_host.log")


if __name__ == "__main__":
    main()
