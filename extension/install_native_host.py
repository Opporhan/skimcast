#!/usr/bin/env python3
"""skimcast uzantısı için tek seferlik kurulum: native messaging host'u Chrome'a kaydeder.

Bundan sonra Chrome, uzantı YouTube transcript'i istediğinde skills/summarize/native_host.py'yi kendisi
anlık olarak başlatır ve kapatır — elle açıp bırakman gereken bir sunucu yok.

Kullanım:  python3 extension/install_native_host.py
"""

import json
import os
import stat
import sys
from pathlib import Path

HOST_NAME = "com.skimcast.native_host"
EXTENSION_ID = "fkhohoagmipbmdabglegihkclhelefna"  # extension/manifest.json'daki "key" alanından türetildi


def hosts_dir() -> Path:
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library/Application Support/Google/Chrome/NativeMessagingHosts"
    if sys.platform.startswith("linux"):
        return home / ".config/google-chrome/NativeMessagingHosts"
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

    manifest = {
        "name": HOST_NAME,
        "description": "skimcast: YouTube/podcast transcript yardımcı programı",
        "path": str(host_script),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{EXTENSION_ID}/"],
    }

    out_dir = hosts_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{HOST_NAME}.json"
    out_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Kaydedildi: {out_path}")
    print(f"Yardımcı program: {host_script}")
    print("Chrome'u yeniden başlat (chrome://restart), sonra uzantıdan YouTube linkiyle dene.")


if __name__ == "__main__":
    main()
