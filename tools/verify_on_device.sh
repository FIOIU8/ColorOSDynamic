#!/system/bin/sh
# Run from an isolated, uniquely named adb-pushed directory with no root privileges.
set -eu
BASE=${0%/*}
case "$BASE" in /data/local/tmp/coloros-verify.*) ;; *) echo 'Use a fresh /data/local/tmp/coloros-verify.* directory' >&2; exit 2 ;; esac
cd "$BASE"
export COLOROS_RUNTIME_DIR="$BASE/runtime" COLOROS_SHELL=/system/bin/sh
export TOUCH_FIXTURE_DIR="$BASE" PATH="$BASE/mock:$PATH"
# The harness decides which binary to test; release builds still accept arm64 only.
[ ! -f module/bin/touch-listener ] || export COLOROS_NATIVE_ABI_OK=1
mkdir -p mock
cat > mock/logcat <<'SH'
#!/system/bin/sh
printf '%s 1000 1000 I wm_set_resumed_activity: [0,com.old.app/.Main,resume]\n' "$(( $(date +%s) - 90 )).123"
exec cat "$TOUCH_FIXTURE_DIR/events"
SH
cat > mock/dumpsys <<'SH'
#!/system/bin/sh
printf '%s\n' "$*" >> "$TOUCH_FIXTURE_DIR/queries"
case "$1" in
  power) printf '  mWakefulness=%s\n' "$(cat "$TOUCH_FIXTURE_DIR/power")" ;;
  activity) printf 'Display #0 (activities from top to bottom):\n  topResumedActivity=ActivityRecord{abc u0 %s/.Main t2}\n' "$(cat "$TOUCH_FIXTURE_DIR/foreground")" ;;
  *) exit 1 ;;
esac
SH
cat > mock/touchHidlTest <<'SH'
#!/system/bin/sh
printf '%s\n' "$*" >> "$TOUCH_FIXTURE_DIR/touch_calls"
[ ! -e "$TOUCH_FIXTURE_DIR/fail-touch" ]
SH
cat > mock/ksud <<'SH'
#!/system/bin/sh
printf '%s\n' "$*" >> "$TOUCH_FIXTURE_DIR/description_calls"
SH
chmod 0755 mock/*
mkfifo events
exec 6<> events
printf 'Awake\n' > power
printf 'app.lawnchair\n' > foreground
: > touch_calls
: > queries
ctl() { /system/bin/sh "$BASE/module/service.sh" "$@"; }
cleanup() { ctl disable >/dev/null 2>&1 || true; }
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; ctl status >&2; ctl logs >&2; exit 1; }
expect() {
    local count=0 snapshot
    while [ "$count" -lt 75 ]; do
        snapshot=$(ctl status)
        if printf '%s\n' "$snapshot" | grep -Fxq "$1"; then return 0; fi
        count=$((count + 1)); sleep 0.15
    done
    fail "$1"
}
line() { printf '         %s 1000 1000 I %s\n' "$(date +%s.%3N)" "$1" >&6; }
tap() { printf 'PASS %s\n' "$*"; }
native_pids() {
    for dir in /proc/[0-9]*; do
        [ -r "$dir/cmdline" ] || continue
        case "$(tr '\0' ' ' < "$dir/cmdline" 2>/dev/null)" in
            *touch-listener*) printf '%s\n' "${dir#/proc/}" ;;
        esac
    done
}
for script in module/*.sh; do /system/bin/sh -n "$script"; done
while IFS= read -r row; do
    tab=$(printf '\t')
    expected=${row%%"$tab"*}
    received=$(ctl --classify "${row#*"$tab"}") || received=
    [ "$received" = "$expected" ] || fail "parser: $row -> $received"
done < event_fixtures.tsv
tap 'Android mksh syntax and shared classifier fixtures'
printf 'fallback_package=com.tencent.tmgp.sgame\n' >> module/monitor_config.conf
ctl config > before
[ "$(grep -F 'fallback_app=' before)" = 'fallback_app=com.tencent.tmgp.sgame' ] || fail migration
[ "$(grep -F 'fallback_method=' before)" = fallback_method=polling ] || fail migration_method
if ctl save 'bm90IHZhbGlk'; then fail invalid_config_accepted; fi
ctl config | cmp - before || fail invalid_config_changed_file
if [ -f module/bin/touch-listener ]; then
    sed 's/backend=shell/backend=rust/' before > experiment
    ctl save "$(base64 experiment | tr -d '\n')"
fi
if [ "${TOUCH_TEST_RUST_FAIL:-0}" = 1 ] || [ "${TOUCH_TEST_RUST_BROKEN:-0}" = 1 ]; then
    [ -f module/bin/touch-listener ] || fail native_binary_missing
    cat > module/bin/touch-listener <<'SH'
#!/system/bin/sh
printf '@native-error:spawn\n'
exit 1
SH
    chmod 0755 module/bin/touch-listener
fi
ctl enable
ctl enable
if [ "${TOUCH_TEST_RUST_FAIL:-0}" = 1 ]; then
    expect backend_error=rust_failed
    expect backend=shell
    ctl disable
    expect enabled=0
    tap 'Repeated native startup failures fall back to Shell'
    exit 0
fi
if [ "${TOUCH_TEST_RUST_BROKEN:-0}" = 1 ]; then
    expect backend_error=rust_start_failed
    grep -F 'native_error=spawn' runtime/touch.log >/dev/null || fail native_error_log
    expect backend_error=rust_failed
    expect backend=shell
    ctl disable
    expect enabled=0
    tap 'Native startup failure reason is shown before falling back'
    exit 0
fi
expect state=running
expect rate=125
if [ -f module/bin/touch-listener ]; then expect backend=rust; fi
pid=$(ctl status | sed -n 's/^pid=//p')
[ "$(wc -l < touch_calls)" -eq 1 ] || fail repeated_initial_HAL
tap 'Legacy migration, invalid-save rollback, double enable and initial HAL deduplication'
if [ "${TOUCH_TEST_ORPHAN:-0}" = 1 ]; then
    [ -f module/bin/touch-listener ] || fail native_binary_missing
    IFS=' ' read -r owner owner_token boot session < runtime/owner
    old_native=$(native_pids | head -n 1)
    [ -n "$old_native" ] || fail native_missing
    IFS=' ' read -r wrapper token < "runtime/$session/listener"
    kill -KILL "$wrapper"
    ctl resync >/dev/null 2>&1 || true
    n=0
    while kill -0 "$old_native" 2>/dev/null && [ "$n" -lt 30 ]; do sleep .1; n=$((n + 1)); done
    ! kill -0 "$old_native" 2>/dev/null || fail native_orphan_after_wrapper_kill
    n=0
    while [ "$(native_pids | wc -l)" -ne 1 ] && [ "$n" -lt 100 ]; do sleep .1; n=$((n + 1)); done
    [ "$(native_pids | wc -l)" -eq 1 ] || fail native_not_restarted
    [ "$(native_pids)" != "$old_native" ] || fail native_did_not_restart
    expect backend=rust
    expect "pid=$pid"
    ctl disable
    expect enabled=0
    tap 'Native listener exits with its wrapper and restarts as one process'
    exit 0
fi
line 'wm_set_resumed_activity: [0,com.tencent.tmgp.sgame/.Main,resume]'
expect rate=360
line 'wm_set_resumed_activity: [0,com.tencent.tmgp.sgame/.Lobby,resume]'
sleep .35
[ "$(wc -l < touch_calls)" -eq 2 ] || fail duplicate_HAL
printf 'com.tencent.tmgp.sgame\n' > foreground
line 'wm_set_resumed_activity: [0,app.lawnchair/.Main,resume]'
line 'wm_focused_root_task: [0,1,2,3,focusChanged]'
sleep .35
[ "$(wc -l < touch_calls)" -eq 2 ] || fail ambiguous_focus_applied_wrong_HAL
expect foreground_package=com.tencent.tmgp.sgame
sed 's/com.tencent.tmgp.sgame=360/com.tencent.tmgp.sgame=240/' "${BASE}/module/touch_profile.conf" > changed
printf 'com.tencent.tmgp.sgame\n' > foreground
ctl save "$(base64 changed | tr -d '\n')"
expect rate=240
expect "pid=$pid"
tap 'Foreground switch, same-command deduplication and reload with stable worker PID'
printf 'Dozing\n' > power
line 'screen_toggled: 0'
expect state=paused
expect rate=125
printf 'Awake\n' > power
line 'screen_toggled: 1'
expect rate=240
printf 'Dozing\n' > power
line 'screen_toggled: 0'
expect state=paused
expect rate=125
before_queries=$(wc -l < queries)
IFS=' ' read -r owner owner_token boot session < runtime/owner
published=$(stat -c '%Y' "runtime/$session/status")
line 'wm_set_resumed_activity: [0,com.tencent.tmgp.sgame/.Main,resume]'
sleep "${TOUCH_TEST_IDLE_SECONDS:-0.4}"
[ "$(wc -l < queries)" -eq "$before_queries" ] || fail paused_foreground_query
[ "$(stat -c '%Y' "runtime/$session/status")" = "$published" ] || fail paused_status_rewritten
ctl resync
sleep .25
expect state=paused
printf 'Awake\n' > power
line 'screen_toggled: 1'
expect rate=240
tap 'Confirmed sleep restores global, suppresses foreground queries and wake restores rule'
IFS=' ' read -r owner owner_token boot session < runtime/owner
IFS=' ' read -r logger token < "runtime/$session/logger"
kill -KILL "$logger"
expect state=running
expect rate=240
sleep 1.5
IFS=' ' read -r new_logger token < "runtime/$session/logger"
[ "$logger" != "$new_logger" ] || fail logcat_not_restarted
expect "pid=$pid"
ctl disable
expect enabled=0
n=0
while [ -f runtime/owner ] && [ "$n" -lt 60 ]; do sleep .15; n=$((n + 1)); done
[ ! -f runtime/owner ] || fail shutdown_owner
! kill -0 "$pid" 2>/dev/null || fail shutdown_worker
! kill -0 "$new_logger" 2>/dev/null || fail shutdown_logger
[ "$(tail -n 1 touch_calls)" = '-c wo 0 26 0' ] || fail shutdown_restore
tap 'Event reconnect, single worker, disable restoration and child cleanup'
