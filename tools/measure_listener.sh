#!/system/bin/sh
# Emulator-side relative measurement for the Shell and Rust listeners.
# Run from a fresh /data/local/tmp/coloros-measure.* directory containing module/.
set -eu
BASE=${0%/*}
case "$BASE" in /data/local/tmp/coloros-measure.*) ;; *) echo 'Use a fresh /data/local/tmp/coloros-measure.* directory' >&2; exit 2 ;; esac
cd "$BASE"
RUNS=${1:-3}
export COLOROS_RUNTIME_DIR="$BASE/runtime" COLOROS_SHELL=/system/bin/sh
export TOUCH_FIXTURE_DIR="$BASE" PATH="$BASE/mock:$PATH"
if [ -f module/bin/touch-listener ]; then export COLOROS_NATIVE_ABI_OK=1; fi

mkdir -p mock
cat > mock/logcat <<'SH'
#!/system/bin/sh
printf '%s 1000 1000 I wm_set_resumed_activity: [0,com.example.game/.Main,resume]\n' "$(( $(date +%s) - 90 )).123"
exec cat "$TOUCH_FIXTURE_DIR/events"
SH
cat > mock/dumpsys <<'SH'
#!/system/bin/sh
printf '%s\n' "$*" >> "$TOUCH_FIXTURE_DIR/queries"
case "$1" in
  power) printf '  mWakefulness=Awake\n' ;;
  activity) printf 'Display #0 (activities from top to bottom):\n  topResumedActivity=ActivityRecord{abc u0 com.example.game/.Main t2}\n' ;;
  *) exit 1 ;;
esac
SH
cat > mock/touchHidlTest <<'SH'
#!/system/bin/sh
printf '%s\n' "$*" >> "$TOUCH_FIXTURE_DIR/touch_calls"
SH
cat > mock/ksud <<'SH'
#!/system/bin/sh
exit 0
SH
chmod 0755 mock/*
mkfifo events 2>/dev/null || true
exec 6<> events
: > queries
: > touch_calls
ctl() { /system/bin/sh "$BASE/module/service.sh" "$@"; }
cleanup() { ctl disable >/dev/null 2>&1 || true; }
trap cleanup EXIT

write_profile() {
    cat > module/touch_profile.conf <<EOF
schema=1
backend=$1
[rules]
global_sample_rate=125
com.example.game=360
com.example.other=240
[rates]
125=touchHidlTest -c wo 0 26 0
240=touchHidlTest -c wo 0 26 78
360=touchHidlTest -c wo 0 26 12c
[monitor]
fallback_enabled=0
poll_interval=3
fallback_method=polling
[names]
com.example.game=Game
com.example.other=Other
EOF
}

wait_state() {
    local count=0
    while [ "$count" -lt 100 ]; do
        if ctl status 2>/dev/null | grep -Fxq "$1"; then return 0; fi
        count=$((count + 1)); sleep .1
    done
    return 1
}

stop_service() {
    ctl disable >/dev/null 2>&1 || true
    local count=0
    while [ -f runtime/owner ] && [ "$count" -lt 80 ]; do sleep .1; count=$((count + 1)); done
    rm -rf runtime
}

module_pids() {
    for dir in /proc/[0-9]*; do
        [ -r "$dir/cmdline" ] || continue
        command=$(tr '\0' ' ' < "$dir/cmdline" 2>/dev/null)
        case "$command" in
            *measure_listener.sh*) continue ;;
            *"$BASE"*) printf '%s\n' "${dir#/proc/}" ;;
        esac
    done
}

sample() {
    local pid stat status
    cpu=0; wakeups=0
    for pid in $1; do
        [ -r "/proc/$pid/stat" ] || continue
        stat=$(cat "/proc/$pid/stat" 2>/dev/null) || continue
        set -- ${stat##*) }
        cpu=$((cpu + ${12:-0} + ${13:-0}))
        status=$(cat "/proc/$pid/status" 2>/dev/null) || continue
        wakeups=$((wakeups + $(printf '%s\n' "$status" | awk '/^(non)?voluntary_ctxt_switches:/ {sum += $2} END {print sum + 0}')))
    done
}

feed_trace() {
    local count=0
    while [ "$count" -lt "$1" ]; do
        printf '         %s 1000 1000 I wm_set_resumed_activity: [0,com.example.game/.Main,resume]\n' "$(date +%s.%3N)" >&6
        count=$((count + 1)); sleep .01
    done
}

feed_switch() {
    printf '         %s 1000 1000 I wm_set_resumed_activity: [0,com.example.other/.Main,resume]\n' "$(date +%s.%3N)" >&6
}

feed_focus() {
    printf '         %s 1000 1000 I wm_focused_root_task: [0,1,2,3,focusChanged]\n' "$(date +%s.%3N)" >&6
}

query_count() {
    awk -v kind="$1" '$1 == kind { n++ } END { print n + 0 }' queries
}

wait_hal() {
    local before=$1 count=0
    while [ "$(wc -l < touch_calls)" -eq "$before" ] && [ "$count" -lt 100 ]; do
        sleep .02; count=$((count + 1))
    done
}

gap_ms=${TOUCH_CONFIRM_GAP_MS:-500}
printf 'backend\tgap_ms\trun\tcpu_ticks\twakeups\tdumpsys\thal_calls\tactivity_queries\twindow_queries\tpower_queries\tswitch_ms\tfocus_queries\n'
for backend in shell rust; do
    if [ "$backend" = rust ] && [ ! -f module/bin/touch-listener ]; then
        echo "skip rust: module/bin/touch-listener missing" >&2
        continue
    fi
    run=1
    while [ "$run" -le "$RUNS" ]; do
        stop_service
        write_profile "$backend"
        printf 'edition=%s\n' "$backend" > module/edition.conf
        : > queries
        : > touch_calls
        ctl enable
        if ! wait_state state=running; then
            echo "backend=$backend run=$run failed to start" >&2
            ctl status >&2 || true
            ctl logs >&2 || true
            exit 1
        fi
        if [ "$backend" = rust ] && ! ctl status | grep -Fxq backend=rust; then
            echo "backend=rust run=$run fell back to shell" >&2
            exit 1
        fi
        sleep 1
        pids=$(module_pids)
        sample "$pids"
        cpu_start=$cpu; wakeups_start=$wakeups
        feed_trace 1000
        sleep .5
        sample "$pids"
        cpu_used=$((cpu - cpu_start)); wakeups_used=$((wakeups - wakeups_start))
        sleep 1.2
        hal_before=$(wc -l < touch_calls)
        switch_start=$(date +%s%3N)
        feed_switch
        wait_hal "$hal_before"
        switch_ms=$(( $(date +%s%3N) - switch_start ))
        [ "$(wc -l < touch_calls)" -gt "$hal_before" ] || switch_ms=-1
        sleep 1.2
        focus_before=$(query_count activity)
        n=0
        while [ "$n" -lt 4 ]; do feed_focus; sleep .25; n=$((n + 1)); done
        sleep 1.2
        focus_queries=$(( $(query_count activity) - focus_before ))
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
            "$backend" "$gap_ms" "$run" "$cpu_used" "$wakeups_used" \
            "$(wc -l < queries)" "$(wc -l < touch_calls)" \
            "$(query_count activity)" "$(query_count window)" "$(query_count power)" \
            "$switch_ms" "$focus_queries"
        stop_service
        run=$((run + 1))
    done
done
