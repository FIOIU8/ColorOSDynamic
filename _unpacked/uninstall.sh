#!/system/bin/sh
MODDIR=${0%/*}
[ "$MODDIR" != "$0" ] || MODDIR=.
# Leave diagnostics available for exit/restore checks. They are bounded and root-only.
if [ -f "$MODDIR/service.sh" ]; then /system/bin/sh "$MODDIR/service.sh" disable; fi
