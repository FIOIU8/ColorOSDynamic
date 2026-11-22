#!/system/bin/sh
# Count what the module actually writes under two event patterns.
# Run from a fresh /data/local/tmp/coloros-measure.* directory containing module/.
set -eu
BASE=${0%/*}
case "$BASE" in /data/local/tmp/coloros-measure.*) ;; *) echo 'Use a fresh /data/local/tmp/coloros-measure.* directory' >&2; exit 2 ;; esac
cd "$BASE"
export COLOROS_RUNTIME_DIR="$BASE/runtime" COLOROS_SHELL=/system/bin/sh
export TOUCH_FIXTURE_DIR="$BASE" PATH="$BASE/mock:$PATH"

mkdir -p mock
cat > mock/logcat <<'SH'
#!/system/bin/sh
printf '%s 1000 1000 I wm_set_resumed_activity: [0,com.example.game/.Main,resume]\n' "$(( $(date +%s) - 90 )).123"
exec cat "$TOUCH_FIXTURE_DIR/events"
SH
cat > mock/dumpsys <<'SH'
#!/system/bin/sh
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
printf '%s\n' "$*" >> "$TOUCH_FIXTURE_DIR/description_calls"
SH
cat > mock/mv <<'SH'
#!/system/bin/sh
printf '%s\n' "$*" >> "$TOUCH_FIXTURE_DIR/mv_calls"
exec /system/bin/mv "$@"
SH
chmod 0755 mock/*
mkfifo events 2>/dev/null || true
exec 6<> events
: > mv_calls
: > description_calls
: > touch_calls
ctl() { /system/bin/sh "$BASE/module/service.sh" "$@"; }
cleanup() { ctl disable >/dev/null 2>&1 || true; }
trap cleanup EXIT

cat > module/touch_profile.conf <<'EOF'
schema=1
backend=shell
[rules]
global_sample_rate=125
com.example.game=360
com.example.other=240
[rates]
125=touchHidlTest -c wo 0 26 0
240=touchHidlTest -c wo 0 26 8
360=touchHidlTest -c wo 0 26 12c
[monitor]
fallback_enabled=0
poll_interval=3
fallback_method=polling
[names]
com.example.game=Game
com.example.other=Other
EOF

wait_state() {
    local count=0
    while [ "$count" -lt 100 ]; do
        if ctl status 2>/dev/null | grep -Fxq "$1"; then return 0; fi
        count=$((count + 1)); sleep .1
    done
    return 1
}

count() { grep -c "$1" "$2" 2>/dev/null || true; }

snapshot() {
    status_writes=$(count ' status$' mv_calls)
    logger_writes=$(count ' logger$' mv_calls)
    rotations=$(count 'touch.log.1$' mv_calls)
    log_lines=$(wc -l < runtime/touch.log 2>/dev/null || echo 0)
    descriptions=$(wc -l < description_calls 2>/dev/null || echo 0)
    hal=$(wc -l < touch_calls 2>/dev/null || echo 0)
}

print_delta() {
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$1" \
        "$((status_writes - status0))" "$((logger_writes - logger0))" \
        "$((rotations - rotations0))" "$((log_lines - lines0))" \
        "$((descriptions - descriptions0))" "$((hal - hal0))"
}

ctl enable
wait_state state=running || { ctl status >&2; ctl logs >&2; exit 1; }
sleep 1
snapshot; status0=$status_writes; logger0=$logger_writes; rotations0=$rotations
lines0=$log_lines; descriptions0=$descriptions; hal0=$hal
printf 'phase\tstatus_writes\tlogger_writes\trotations\tlog_lines\tdescriptions\thal_calls\n'

# Same foreground: one app, 600 events, ~6s.
n=0
while [ "$n" -lt 600 ]; do
    printf '         %s 1000 1000 I wm_set_resumed_activity: [0,com.example.game/.Main,resume]\n' "$(date +%s.%3N)" >&6
    n=$((n + 1)); sleep .01
done
sleep .4
snapshot
print_delta same-app

# Alternating foreground: 60 switches, 250ms apart, ~15s.
n=0
while [ "$n" -lt 60 ]; do
    if [ $((n % 2)) -eq 0 ]; then package=com.example.game; else package=com.example.other; fi
    printf '         %s 1000 1000 I wm_set_resumed_activity: [0,%s/.Main,resume]\n' "$(date +%s.%3N)" "$package" >&6
    n=$((n + 1)); sleep .25
done
sleep .4
snapshot
print_delta alternating-apps

session=$(sed -n 's/^[^ ]* [^ ]* [^ ]* //p' runtime/owner)
printf 'status_file_bytes=%s\n' "$(wc -c < "runtime/$session/status" 2>/dev/null || echo 0)"
