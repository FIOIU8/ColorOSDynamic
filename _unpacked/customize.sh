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
chmod 0755 "$MODPATH/service.sh" "$MODPATH/uninstall.sh"
if [ -f "$MODPATH/bin/touch-listener" ]; then chmod 0755 "$MODPATH/bin/touch-listener"; fi
ui_print "ColorOS Touch · Configure rules and diagnostics in WebUI."
