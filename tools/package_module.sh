#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
ref=${1:-HEAD}
dist=${2:-dist}
module_tree=$(git rev-parse --verify "${ref}:_unpacked")

prop=$(git show "${module_tree}:module.prop")
version=$(sed -n 's/^version=//p' <<< "$prop")
version_code=$(sed -n 's/^versionCode=//p' <<< "$prop")
if ! [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && $version_code =~ ^[1-9][0-9]*$ ]]; then
    echo 'module.prop must contain version=X.Y.Z and a positive integer versionCode.' >&2
    exit 1
fi

# Keep repository files out of the installer by listing the module payload explicitly.
payload=(
    module.prop customize.sh service.sh uninstall.sh
    app_names.conf monitor_config.conf rate_code.conf touch_enabled.flag touch_opt.conf
    webroot/index.html webroot/script.js webroot/style.css
)
for path in "${payload[@]}"; do
    entry=$(git ls-tree "$module_tree" -- "$path")
    if ! [[ $entry == '100644 blob '* || $entry == '100755 blob '* ]]; then
        echo "Missing regular file: _unpacked/$path" >&2
        exit 1
    fi
done

mkdir -p "$dist"
asset="$dist/ColorOSDynamic-v${version}.zip"
git archive --format=zip -9 --output="$asset" "$module_tree" -- "${payload[@]}"
unzip -tq "$asset" >&2
diff -u <(printf '%s\n' "${payload[@]}" | LC_ALL=C sort) \
    <(unzip -Z1 "$asset" | sed '/\/$/d' | LC_ALL=C sort) >&2

if [[ -n ${GITHUB_OUTPUT:-} ]]; then
    printf 'tag=v%s\nasset=%s\n' "$version" "$asset" >> "$GITHUB_OUTPUT"
fi
printf '%s\n' "$asset"
