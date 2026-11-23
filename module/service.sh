#!/system/bin/sh
# Shared control and worker entry point. The optional Rust binary replaces the event reader.
set -f
umask 077
MODDIR=${0%/*}
[ "$MODDIR" != "$0" ] || MODDIR=.
MODDIR=$(CDPATH= cd -- "$MODDIR" && pwd) || exit 1
RUN=${COLOROS_RUNTIME_DIR:-/data/adb/ColorOSTouch}
SH=${COLOROS_SHELL:-/system/bin/sh}
CONFIG="$MODDIR/touch_profile.conf"
FLAG="$MODDIR/touch_enabled.flag"
LOG="$RUN/touch.log"

fail() { printf '%s\n' "$*" >&2; exit 1; }
valid_package() {
    case "$1" in
        *[!A-Za-z0-9_.]*|.*|*.|*..*) return 1 ;;
        *.*) return 0 ;;
        *) return 1 ;;
    esac
}
limited() { timeout -k 1 4 "$@"; }
lock_tool() {
    if command -v flock >/dev/null 2>&1; then
        flock "$@"
    elif [ -x /data/adb/ksu/bin/busybox ]; then
        /data/adb/ksu/bin/busybox flock "$@"
    elif [ -x /data/adb/magisk/busybox ]; then
        /data/adb/magisk/busybox flock "$@"
    else
        return 127
    fi
}
clock() { date +%s; }

# stat fields after comm start at field 3. Refuse zombies and PID reuse.
proc_start() {
    case "$1" in ''|*[!0-9]*|0) return 1 ;; esac
    local stat
    IFS= read -r stat 2>/dev/null < "/proc/$1/stat" || return 1
    set -- ${stat##*) }
    case "$1" in Z|X|x) return 1 ;; esac
    [ -n "${20}" ] && printf '%s\n' "${20}"
}
boot_id() { IFS= read -r boot < /proc/sys/kernel/random/boot_id && printf '%s\n' "$boot"; }
identity_matches() { [ -n "$2" ] && [ "$(proc_start "$1")" = "$2" ]; }
read_owner() {
    IFS=' ' read -r owner_pid owner_start owner_boot session_name 2>/dev/null < "$RUN/owner" || return 1
    case "$session_name" in session.[A-Za-z0-9]*) ;; *) return 1 ;; esac
    case "$session_name" in *[!A-Za-z0-9.]*) return 1 ;; esac
    [ "$owner_boot" = "$(boot_id)" ] && identity_matches "$owner_pid" "$owner_start" || return 1
    SESSION="$RUN/$session_name"
}
enabled() {
    local value
    IFS= read -r value 2>/dev/null < "$FLAG" && [ "$value" = 1 ]
}
set_enabled() {
    local temp
    temp=$(mktemp "$MODDIR/.enabled.XXXXXX") || return 1
    printf '%s\n' "$1" > "$temp" && mv -f "$temp" "$FLAG" && return 0
    rm -f "$temp"
    return 1
}
module_description() {
    local ksud
    ksud=$(command -v ksud) || ksud=/data/adb/ksud
    [ -x "$ksud" ] || return 0
    KSU_MODULE=ColorOSTouch limited "$ksud" module config set --temp override.description \
        "ColorOS Touch · $1" >/dev/null 2>&1 || true
}
log_message() {
    # Bound the root-only event log. No per-heartbeat logging.
    if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -ge 131072 ]; then
        mv -f "$LOG" "$LOG.1"
    fi
    printf '%s %s\n' "$(clock)" "$*" >> "$LOG"
}

. "$MODDIR/profile.sh"
. "$MODDIR/worker.sh"

init_runtime() {
    mkdir -p "$RUN" && chmod 0700 "$RUN" || fail runtime_unavailable
}
lock_control() {
    init_runtime
    exec 9> "$RUN/control.lock"
    lock_tool -n 0 <&9 || fail control_busy
}

send_control() {
    [ -p "$SESSION/inbox" ] || return 1
    timeout -k 1 2 "$SH" -c 'printf "@%s\n" "$2" > "$1"' sh "$SESSION/inbox" "$1"
}
request_control() {
    local attempt=0
    while [ "$attempt" -lt 4 ] && read_owner; do
        if send_control "$1"; then return 0; fi
        attempt=$((attempt + 1))
        sleep 0.1
    done
    return 1
}

start_service() {
    read_owner && return 0
    nohup "$SH" "$MODDIR/service.sh" --supervise 9>&- </dev/null >/dev/null 2>&1 &
}

show_status() {
    local is_enabled=0 key value pid start state worker_state preferred
    enabled && is_enabled=1
    printf 'enabled=%s\nexperimental=%s\n' "$is_enabled" "$(rust_capability)"
    if [ "$is_enabled" = 0 ]; then
        printf 'state=disabled\n'
        if read_owner; then printf 'stopping=1\n'; elif [ -f "$RUN/stop.status" ]; then cat "$RUN/stop.status"; fi
        return 0
    fi
    preferred=$(module_edition)
    printf 'preferred_backend=%s\n' "$preferred"
    if ! read_owner; then
        printf 'state=stopped\n'
        [ ! -f "$RUN/boot.error" ] || cat "$RUN/boot.error"
        return 0
    fi
    pid= start= worker_state=
    if [ -f "$SESSION/status" ]; then
        state=$(cat "$SESSION/status")
        while IFS='=' read -r key value; do
            case "$key" in pid) pid=$value ;; start) start=$value ;; state) worker_state=$value ;; esac
        done <<EOF
$state
EOF
    fi
    if identity_matches "$pid" "$start"; then
        printf '%s\n' "$state"
    else
        printf 'state=starting\n'
        [ ! -f "$SESSION/supervisor.error" ] || cat "$SESSION/supervisor.error"
    fi
}

rust_capability() {
    # COLOROS_NATIVE_ABI_OK is a test-only hook for the x86_64 emulator harness.
    if [ -x "$MODDIR/bin/touch-listener" ] &&
        { [ "${COLOROS_NATIVE_ABI_OK:-0}" = 1 ] || [ "$(getprop ro.product.cpu.abi)" = arm64-v8a ]; }; then
        printf '1\n'
    else
        printf '0\n'
    fi
}

supervise() {
    init_runtime
    exec 8> "$RUN/service.lock"
    lock_tool -n 0 <&8
    case "$?" in
        0) ;;
        127) printf 'error=flock_unavailable\n' > "$RUN/boot.error"; return 1 ;;
        *) return 0 ;;
    esac
    rm -f "$RUN/boot.error" "$RUN/stop.status"
    enabled || { module_description disabled; return 0; }
    SESSION=$(mktemp -d "$RUN/session.XXXXXX") || return 1
    trap 'supervisor_cleanup' EXIT
    trap 'exit 0' HUP INT TERM
    supervisor_worker=
    mkfifo "$SESSION/inbox" || return 1
    printf '%s %s %s %s\n' "$$" "$(proc_start "$$")" "$(boot_id)" "${SESSION##*/}" > "$SESSION/owner"
    mv -f "$SESSION/owner" "$RUN/owner" || return 1
    if ! ensure_profile; then
        printf 'error=config_invalid\n' > "$RUN/boot.error"
        module_description error
        return 1
    fi
    local delay=1 elapsed started result
    while enabled; do
        started=$(clock)
        "$SH" "$MODDIR/service.sh" --worker "$SESSION" 8>&- &
        supervisor_worker=$!
        wait "$supervisor_worker"
        result=$?
        supervisor_worker=
        retire_listener
        enabled || break
        if [ "$result" = 75 ]; then
            delay=1
        else
            printf 'error=worker_exited\n' > "$SESSION/supervisor.error"
            module_description restarting
            elapsed=$(($(clock) - started))
            [ "$elapsed" -lt 30 ] || delay=1
            sleep "$delay" 8>&- &
            supervisor_sleep=$!
            wait "$supervisor_sleep"
            supervisor_sleep=
            [ "$delay" -ge 32 ] || delay=$((delay * 2))
        fi
    done
}

supervisor_cleanup() {
    trap '' HUP INT TERM
    [ -z "${supervisor_sleep:-}" ] || kill "$supervisor_sleep" 2>/dev/null || true
    if [ -n "$supervisor_worker" ]; then
        kill -TERM "$supervisor_worker" 2>/dev/null || true
        for tick in 1 2 3 4 5 6 7 8; do
            proc_start "$supervisor_worker" >/dev/null || break
            sleep 1
        done
        if proc_start "$supervisor_worker" >/dev/null; then kill -KILL "$supervisor_worker" 2>/dev/null || true; fi
    fi
    retire_listener
    rm -f "$RUN/owner" "$SESSION/inbox" "$SESSION/status" "$SESSION/status.tmp" \
        "$SESSION/supervisor.error" "$SESSION/owner" "$SESSION/raw"
    rmdir "$SESSION" 2>/dev/null || true
    enabled || module_description disabled
}

case "${1:-}" in
    --supervise) supervise ;;
    --worker) SESSION=$2; worker_main ;;
    --listener) SESSION=$2; listener_main ;;
    --logcat) launch_logcat "$2" ;;
    --classify) classify_event "$2" && printf '@%s\n' "$event" ;;
    --foreground) foreground_snapshot ;;
    --power) screen_snapshot ;;
    --validate) validate_profile "$2" ;;
    config)
        lock_control
        ensure_profile || fail config_invalid
        cat "$CONFIG"
        ;;
    status) show_status ;;
    logs) if [ -f "$LOG" ]; then tail -n 100 "$LOG"; fi ;;
    apps) limited cmd package list packages -3 ;;
    enable)
        lock_control
        ensure_profile || fail config_invalid
        set_enabled 1 || fail enable_failed
        start_service
        ;;
    disable)
        lock_control
        set_enabled 0 || fail disable_failed
        if read_owner && ! send_control stop; then
            identity_matches "$owner_pid" "$owner_start" && kill -TERM "$owner_pid" 2>/dev/null || true
        fi
        ;;
    save)
        lock_control
        save_profile "${2:-}" || fail config_invalid
        if enabled; then request_control reload || start_service; fi
        ;;
    resync)
        lock_control
        enabled || fail disabled
        request_control resync || { start_service; }
        ;;
    ''|boot)
        # KernelSU and Magisk boot hooks can fire before Android's services are ready.
        if enabled; then init_runtime; start_service; else module_description disabled; fi
        ;;
    *) fail invalid_operation ;;
esac
