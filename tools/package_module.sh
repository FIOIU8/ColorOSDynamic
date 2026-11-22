#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec "${COLOROS_PYTHON:-python3}" tools/package_module.py "$@"
