"""Build the KernelSU/Magisk ZIP from a commit or the current workspace."""

import argparse
import os
from pathlib import Path
import re
import stat
import subprocess
import zipfile


ROOT = Path(__file__).resolve().parents[1]
PAYLOAD = (
    "module.prop", "edition.conf", "customize.sh", "service.sh", "uninstall.sh", "profile.sh", "worker.sh",
    "app_names.conf", "monitor_config.conf", "rate_code.conf", "touch_enabled.flag", "touch_opt.conf",
    "webroot/index.html", "webroot/script.js", "webroot/style.css",
)
EXECUTABLE = {"customize.sh", "service.sh", "uninstall.sh", "bin/touch-listener"}


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def payload_from(ref):
    for name in PAYLOAD:
        if ref == "--worktree":
            source = ROOT / "module" / name
            if not source.is_file() or source.is_symlink():
                raise ValueError(f"Missing regular file: {source}")
            yield name, source.read_bytes()
        else:
            source = f"module/{name}"
            entry = git("ls-tree", ref, "--", source)
            if not entry.startswith((b"100644 blob ", b"100755 blob ")):
                raise ValueError(f"Missing regular file at {ref}: {source}")
            yield name, git("show", f"{ref}:{source}")


def unix_mode(name):
    return stat.S_IFREG | (0o755 if name in EXECUTABLE else 0o644)


def verify_arm64(filename):
    binary = filename.read_bytes()
    if not (binary[:6] == b"\x7fELF\x02\x01" and binary[18:20] == b"\xb7\x00" and b"/system/bin/linker64\0" in binary):
        raise ValueError("Rust worker must be an arm64 Android ELF")
    return binary


def write_verified_archive(path, items):
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in items.items():
            # An explicit Unix mode preserves executable bits even on Windows.
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            info.external_attr = unix_mode(name) << 16
            archive.writestr(info, content, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None or archive.namelist() != list(items):
            raise ValueError("Corrupt ZIP or unexpected payload")
        for info in archive.infolist():
            if info.external_attr >> 16 != unix_mode(info.filename):
                raise ValueError(f"Unexpected file type or permissions: {info.filename}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ref", nargs="?", default="HEAD")
    parser.add_argument("dist", nargs="?", default="dist", type=Path)
    parser.add_argument("--worktree", action="store_true")
    parser.add_argument("--output", type=Path, help="Override the output directory")
    parser.add_argument("--rust", type=Path, metavar="ANDROID_ARM64_ELF",
                        help="also build the Rust edition from this arm64 binary")
    args = parser.parse_args()
    items = dict(payload_from("--worktree" if args.worktree else args.ref))
    items = {name: content.replace(b"\r\n", b"\n") for name, content in items.items()}
    prop = items["module.prop"].decode("utf-8")
    version = re.search(r"^version=([0-9]+\.[0-9]+\.[0-9]+)$", prop, re.MULTILINE)
    if not version or not re.search(r"^versionCode=[1-9][0-9]*$", prop, re.MULTILINE):
        parser.error("module.prop needs a version and positive versionCode")
    version = version[1]
    shell_items = {**items, "edition.conf": b"edition=shell\n"}
    assets = [(f"ColorOSDynamic-v{version}-shell.zip", shell_items)]
    if args.rust:
        native = verify_arm64(args.rust)
        rust_items = {**shell_items, "bin/touch-listener": native, "edition.conf": b"edition=rust\n"}
        assets.append((f"ColorOSDynamic-v{version}-rust-arm64.zip", rust_items))
    output_dir = args.output or args.dist
    output_dir.mkdir(parents=True, exist_ok=True)
    created = []
    for filename, payload in assets:
        destination = output_dir / filename
        write_verified_archive(destination, payload)
        created.append(destination.as_posix())
        print(destination)
    if output := os.environ.get("GITHUB_OUTPUT"):
        with open(output, "a", encoding="utf-8", newline="\n") as stream:
            print(f"tag=v{version}\nshell_asset={created[0]}", file=stream)
            if len(created) == 2:
                print(f"rust_asset={created[1]}", file=stream)


if __name__ == "__main__":
    main()
