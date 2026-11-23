#!/system/bin/sh
# Both supported managers source this hook after extracting the payload.
[ -n "$MODPATH" ] || return 1
previous=/data/adb/modules/ColorOSDynamic
for name in touch_enabled.flag touch_profile.conf touch_opt.conf rate_code.conf monitor_config.conf app_names.conf; do
    if [ -f "$previous/$name" ] && [ "$previous" != "$MODPATH" ]; then
        cp "$previous/$name" "$MODPATH/$name" || abort "Cannot preserve $name"
    fi
    if [ -f "$MODPATH/$name" ]; then chmod 0600 "$MODPATH/$name" || abort "Cannot protect $name"; fi
done
# Copy configs first, then retire the legacy module. Only touch a dir that is really ours.
if [ "$previous" != "$MODPATH" ] && [ -f "$previous/module.prop" ] &&
    grep -qx 'id=ColorOSDynamic' "$previous/module.prop"; then
    : > "$previous/disable" || abort "Cannot disable legacy module"
    : > "$previous/remove"  || abort "Cannot schedule legacy removal"
    ui_print "- Legacy ColorOSDynamic disabled; removed on reboot."
fi
chmod 0755 "$MODPATH/service.sh" "$MODPATH/uninstall.sh"
if [ -f "$MODPATH/bin/touch-listener" ]; then chmod 0755 "$MODPATH/bin/touch-listener"; fi
ui_print "ColorOS Touch · Configure rules and diagnostics in WebUI."
