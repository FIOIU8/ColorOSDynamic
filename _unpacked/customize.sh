#!/system/bin/sh

# KernelSU/Magisk source this hook after extracting the module.
if [ -z "$MODPATH" ]; then
    ui_print "MODPATH is unavailable; skipping touch module setup."
    return 0 2>/dev/null || exit 0
fi

PREVIOUS_MODULE="/data/adb/modules/ColorOSDynamic"

migrate_file() {
    local name="$1"
    local source="$PREVIOUS_MODULE/$name"
    local target="$MODPATH/$name"

    if [ -f "$source" ] && [ "$source" != "$target" ]; then
        if ! cp "$source" "$target"; then
            ui_print "Warning: failed to preserve $name from the previous installation."
        fi
    fi
}

migrate_file "touch_enabled.flag"
migrate_file "touch_opt.conf"
migrate_file "rate_code.conf"
migrate_file "monitor_config.conf"
migrate_file "app_names.conf"

# 这两个文件由模块 ZIP 提供；缺失时工作进程会以 config_missing 退出，安装时明确告警。
for required_conf in touch_opt.conf rate_code.conf; do
    if [ ! -f "$MODPATH/$required_conf" ]; then
        ui_print "Warning: $required_conf is missing; reinstall the module to restore default mappings."
    fi
done

if [ ! -f "$MODPATH/touch_enabled.flag" ]; then
    printf '0\n' > "$MODPATH/touch_enabled.flag"
fi

if [ ! -f "$MODPATH/monitor_config.conf" ]; then
    printf 'fallback_enabled=0\nfallback_method=observer\npoll_interval=3\n' > "$MODPATH/monitor_config.conf"
fi

if [ ! -f "$MODPATH/app_names.conf" ]; then
    printf '# App display names; package=name\n' > "$MODPATH/app_names.conf"
fi

# 安装/升级后清除可能残留的停止与重启标记，否则监督进程会拒绝启动或误重启。
rm -f /data/adb/ColorOSDynamic/stop.flag /data/adb/ColorOSDynamic/restart.flag 2>/dev/null || true

chmod 0755 "$MODPATH/service.sh" "$MODPATH/uninstall.sh"
chmod 0600 "$MODPATH/touch_enabled.flag" "$MODPATH/touch_opt.conf" \
    "$MODPATH/rate_code.conf" "$MODPATH/monitor_config.conf" "$MODPATH/app_names.conf"
ui_print "Touch optimization is disabled by default. Enable it in WebUI."
