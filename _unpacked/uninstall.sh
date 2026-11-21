#!/system/bin/sh
# 卸载时先写停止标记，再按「监督进程 → 工作进程」顺序终止，
# 否则 watchdog 会在清理期间把工作进程重新拉起。

RUNTIME_DIR="/data/adb/ColorOSDynamic"
STOP_FILE="$RUNTIME_DIR/stop.flag"
PID_FILE="$RUNTIME_DIR/service.pid"
WATCHDOG_PID_FILE="$RUNTIME_DIR/watchdog.pid"
MODULE_SERVICE="/data/adb/modules/ColorOSDynamic/service.sh"
# 从 $0 推导本模块目录；异常安装布局下 cmdline 里的路径可能不同。
# 两条路径任一命中即认为是本模块，且都带目录信息，绝不只按 service.sh 文件名匹配。
MODULE_DIR=${0%/*}
[ "$MODULE_DIR" = "$0" ] && MODULE_DIR="$PWD"
case "$MODULE_DIR" in
    /*) ;;
    *) MODULE_DIR="$PWD/$MODULE_DIR" ;;
esac
MODULE_SERVICE_DERIVED="$MODULE_DIR/service.sh"

mkdir -p "$RUNTIME_DIR" 2>/dev/null
: > "$STOP_FILE" 2>/dev/null || true

is_module_process() {
    local pid="$1"
    local cmdline=""
    kill -0 "$pid" 2>/dev/null || return 1
    cmdline=$(tr '\000' ' ' < "/proc/$pid/cmdline" 2>/dev/null) || return 1
    case "$cmdline" in
        *"$MODULE_SERVICE"*|*"$MODULE_SERVICE_DERIVED"*) return 0 ;;
        *) return 1 ;;
    esac
}

terminate_pid() {
    local pid="$1"
    local wait_count=0
    case "$pid" in ''|*[!0-9]*) return 0 ;; esac
    is_module_process "$pid" || return 0
    kill "$pid" 2>/dev/null || true
    while [ "$wait_count" -lt 5 ] && is_module_process "$pid"; do
        sleep 1
        wait_count=$((wait_count + 1))
    done
    if is_module_process "$pid"; then
        kill -9 "$pid" 2>/dev/null || true
    fi
}

if [ -f "$WATCHDOG_PID_FILE" ]; then
    terminate_pid "$(cat "$WATCHDOG_PID_FILE" 2>/dev/null)"
fi
if [ -f "$PID_FILE" ]; then
    terminate_pid "$(cat "$PID_FILE" 2>/dev/null)"
fi

rm -f "$RUNTIME_DIR/activity-events" \
    "$RUNTIME_DIR/activity-observer-input" \
    "$RUNTIME_DIR/activity-observer-output" \
    "$RUNTIME_DIR/service.pid" \
    "$RUNTIME_DIR/service.pid.tmp" \
    "$RUNTIME_DIR/service.status" \
    "$RUNTIME_DIR/service.status.tmp" \
    "$RUNTIME_DIR/watchdog.pid" \
    "$RUNTIME_DIR/watchdog.pid.tmp" \
    "$RUNTIME_DIR/watchdog.status" \
    "$RUNTIME_DIR/watchdog.status.tmp" \
    "$RUNTIME_DIR/restart.flag" \
    "$STOP_FILE"
rmdir "$RUNTIME_DIR" 2>/dev/null || true
