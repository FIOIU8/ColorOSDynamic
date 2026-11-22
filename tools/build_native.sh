#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

target=arm64
case "${1:-}" in
    '') ;;
    --target) shift; target=${1:-} ;;
    *) echo "Usage: $0 [--target arm64|x86_64]" >&2; exit 1 ;;
esac
case "$target" in
    arm64|aarch64) triple=aarch64-linux-android; linker_var=CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER ;;
    x86_64) triple=x86_64-linux-android; linker_var=CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER ;;
    *) echo "Unsupported target: $target (expected arm64 or x86_64)" >&2; exit 1 ;;
esac

ndk=${ANDROID_NDK_HOME:?Set ANDROID_NDK_HOME to an Android NDK installation}
case "$(uname -s)" in
    Linux*) host=linux-x86_64; launcher=clang ;;
    Darwin*) host=darwin-x86_64; launcher=clang ;;
    MINGW*|MSYS*|CYGWIN*) host=windows-x86_64; launcher=clang.exe ;;
    *) echo 'Unsupported NDK host' >&2; exit 1 ;;
esac
export "$linker_var=$ndk/toolchains/llvm/prebuilt/$host/bin/$launcher"
export RUSTFLAGS="-C link-arg=--target=${triple}33"
cargo build --locked --release --target "$triple" --manifest-path native/Cargo.toml

# x86_64 is only for the emulator harness. Release ZIPs accept arm64 only.
if [ "$target" = x86_64 ]; then
    echo 'Test binary: native/target/x86_64-linux-android/release/touch-listener'
fi
