#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
if [ -n "${COLOROS_PYTHON:-}" ]; then
    python=$COLOROS_PYTHON
elif command -v python3 >/dev/null 2>&1 && python3 -c 'import sys' >/dev/null 2>&1; then
    python=python3
elif command -v python >/dev/null 2>&1 && python -c 'import sys' >/dev/null 2>&1; then
    python=python
else
    echo "Python 3 is required (set COLOROS_PYTHON to override)" >&2
    exit 1
fi
exec "$python" tools/package_module.py "$@"
