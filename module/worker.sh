# Android probes, event normalization and worker policy.
foreground_snapshot() {
    local activities windows package
    activities=$(limited dumpsys activity activities 2>/dev/null) || activities=
    windows=
    package=$(printf '%s\n' "$activities" | LC_ALL=C awk '
        function component(line, value) {
            if (!match(line, /[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+\/[A-Za-z0-9_.$]+/)) return ""
            value=substr(line,RSTART,RLENGTH); sub(/\/.*/,"",value); return value
        }
        /Display #[0-9]+/ { display=$0; sub(/^.*Display #/,"",display); sub(/[^0-9].*$/,"",display) }
        /mTopFocusedDisplayId=[0-9]+/ { focused=$0; sub(/^.*mTopFocusedDisplayId=/,"",focused); sub(/[^0-9].*$/,"",focused) }
        /topResumedActivity[:=]/ { pkg=component($0); if (pkg!="") { top[display]=pkg; if (++count==1) only=pkg } }
        END { if (focused!="" && top[focused]!="") print top[focused]; else if (count==1) print only }
    ')
    if ! valid_package "$package"; then
        windows=$(limited dumpsys window displays 2>/dev/null) || return 1
        package=$(printf '%s\n' "$windows" | LC_ALL=C awk '
            /mCurrentFocus=|mFocusedApp=/ {
                if (!match($0, /[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+\/[A-Za-z0-9_.$]+/)) next
                pkg=substr($0,RSTART,RLENGTH); sub(/\/.*/,"",pkg)
                if (/mCurrentFocus=/ && !(pkg in focus)) { focus[pkg]=1; current=pkg; n++ }
                if (/mFocusedApp=/ && !(pkg in app)) { app[pkg]=1; fallback=pkg; m++ }
            }
            END { if (n==1) print current; else if (n==0 && m==1) print fallback }
        ')
    fi
    valid_package "$package" && printf '%s\n' "$package"
}

screen_snapshot() {
    local power
    power=$(limited dumpsys power 2>/dev/null) || return 1
    printf '%s\n' "$power" | LC_ALL=C awk '
        /^[[:space:]]*mWakefulness=(Awake|Dreaming|Asleep|Dozing)[[:space:]]*$/ {
            print ($0 ~ /=(Awake|Dreaming)/ ? "awake" : "asleep"); found=1; exit
        }
        END { if (!found) exit 1 }
    '
}

classify_event() {
    local tag fields component package number suffix
    case "$1" in *' I '*) suffix=${1#* I } ;; *) return 1 ;; esac
    tag=${suffix%%:*}
    tag=${tag%% *}
    fields=${suffix#*: }
    case "$tag" in
        screen_toggled)
            case "$fields" in 0|'[0]') event=screen:asleep ;; 1|'[1]') event=screen:awake ;; *) return 1 ;; esac
            ;;
        power_screen_state)
            case "$fields" in '[0,'*']') event=screen:asleep ;; '[1,'*']') event=screen:awake ;; *) return 1 ;; esac
            ;;
        wm_set_keyguard_shown) event=keyguard ;;
        wm_resume_activity|am_resume_activity|wm_restart_activity|am_restart_activity|wm_relaunch_resume_activity|am_relaunch_resume_activity)
            # Focus/task/lifecycle hints do not identify the top focused window.
            event=focus
            ;;
        wm_focused_root_task|wm_focused_stack|wm_task_moved) event=conflict ;;
        wm_set_resumed_activity|am_set_resumed_activity)
            event=focus
            case "$fields" in \[*\]) ;; *) return 0 ;; esac
            fields=${fields#\[}
            number=${fields%%,*}
            case "$number" in ''|*[!0-9]*) return 0 ;; esac
            fields=${fields#*,}
            component=${fields%%,*}
            component=${component# }
            package=${component%%/*}
            [ "$component" != "$fields" ] && [ "$component" != "$package" ] && valid_package "$package" && event="app:$package"
            ;;
        *) return 1 ;;
    esac
    return 0
}

launch_logcat() {
    # Exec retains the identity written here, allowing cleanup even if a reader crashes.
    local session=$1
    printf '%s %s\n' "$$" "$(proc_start "$$")" > "$session/logger.tmp"
    mv -f "$session/logger.tmp" "$session/logger" || exit 1
    # One initial entry is replayed by logcat; the readers discard it by epoch cutoff.
    exec logcat -b events -v epoch -s -T 1 \
        wm_set_resumed_activity:I am_set_resumed_activity:I \
        wm_resume_activity:I am_resume_activity:I wm_restart_activity:I am_restart_activity:I \
        wm_relaunch_resume_activity:I am_relaunch_resume_activity:I wm_focused_root_task:I \
        wm_focused_stack:I wm_task_moved:I wm_set_keyguard_shown:I screen_toggled:I power_screen_state:I 2>/dev/null
}

retire_listener() {
    local pid start grace
    if IFS=' ' read -r pid start < "$SESSION/logger" 2>/dev/null && identity_matches "$pid" "$start"; then
        kill -KILL "$pid" 2>/dev/null || true
    fi
    if IFS=' ' read -r pid start < "$SESSION/listener" 2>/dev/null && identity_matches "$pid" "$start"; then
        # EOF lets both readers reap logcat before we remove their paths.
        for grace in 1 2 3 4 5; do
            sleep 0.1
            identity_matches "$pid" "$start" || break
        done
        if identity_matches "$pid" "$start"; then kill -TERM "$pid" 2>/dev/null || true; fi
    fi
    rm -f "$SESSION/logger" "$SESSION/logger.tmp" "$SESSION/listener" "$SESSION/raw"
}

record_listener() {
    printf '%s %s\n' "$$" "$(proc_start "$$")" > "$SESSION/listener"
}

listener_main() {
    record_listener
    if [ "${LISTENER_IMPL:-shell}" = rust ]; then
        "$MODDIR/bin/touch-listener" "$SH" "$MODDIR/service.sh" "$SESSION" &
        local native_pid=$!
        trap 'kill -TERM "$native_pid" 2>/dev/null || true; exit 0' TERM HUP INT
        wait "$native_pid"
    else
        shell_listener
    fi
    printf '@lost\n'
}

shell_listener() {
    local cutoff cutoff_seconds cutoff_ms line stamp second fraction pending= started=0 remaining timeout uptime
    cutoff=$(date +%s%3N 2>/dev/null)
    case "$cutoff" in ''|*[!0-9]*) cutoff="$(clock)999" ;; esac
    cutoff_seconds=${cutoff%???}; cutoff_ms=${cutoff#"$cutoff_seconds"}
    rm -f "$SESSION/raw"
    mkfifo "$SESSION/raw" || return 1
    "$SH" "$MODDIR/service.sh" --logcat "$SESSION" > "$SESSION/raw" &
    local logger=$!
    trap 'kill -KILL "$logger" 2>/dev/null || true; exit 0' TERM HUP INT
    exec 4< "$SESSION/raw"
    printf '@ready\n'
    while :; do
        if [ -n "$pending" ]; then
            monotonic_cs
            remaining=$((started + 20 - uptime))
            timeout=$((remaining + 100))
            if [ "$remaining" -le 0 ] || ! IFS= read -r -t "0.${timeout#1}" -u4 line; then
                printf '@%s\n' "$pending"
                pending=
                kill -0 "$logger" 2>/dev/null || break
                continue
            fi
        else
            IFS= read -r -u4 line || break
        fi
        # logcat -v epoch pads the epoch timestamp with leading blanks.
        line=${line#"${line%%[![:blank:]]*}"}
        stamp=${line%% *}
        second=${stamp%%.*}; fraction=${stamp#*.}
        [ "$stamp" != "$second" ] || continue
        case "$second:$fraction" in :*|*:|*[!0-9:]*) continue ;; esac
        fraction="${fraction}000"
        fraction=${fraction%${fraction#???}}
        if [ "$second" -lt "$cutoff_seconds" ] || { [ "$second" -eq "$cutoff_seconds" ] && [ "$fraction" -le "$cutoff_ms" ]; }; then
            continue
        fi
        classify_event "$line" || continue
        if [ -z "$pending" ]; then monotonic_cs; started=$uptime; fi
        case "$event" in
            screen:*|keyguard)
                pending=
                printf '@%s\n' "$event"
                ;;
            app:*)
                case "$pending" in
                    ''|app:*) [ -z "$pending" ] || [ "$pending" = "$event" ] || event=conflict ;;
                    conflict) event=conflict ;;
                esac
                pending=$event
                ;;
            focus) [ -n "$pending" ] || pending=focus ;;
            conflict) pending=conflict ;;
        esac
    done
    wait "$logger" 2>/dev/null || true
    return 1
}

monotonic_cs() {
    local raw seconds fraction
    IFS=' ' read -r raw ignored < /proc/uptime || raw=0.00
    seconds=${raw%%.*}; fraction=${raw#*.}
    uptime=$((seconds * 100 + 1$fraction - 100))
}

start_listener() {
    local selected=$1
    retire_listener
    LISTENER_IMPL=$selected "$SH" "$MODDIR/service.sh" --listener "$SESSION" 3>&- > "$SESSION/inbox" &
    listener_pid=$!
    listening=1
    stream_ready=0
    reader_announced=0
    native_error=
    listener_started=$SECONDS
    next_probe=$((SECONDS + 5))
    seen_awake=0
    seen_asleep=0
}

worker_publish() {
    local signature old_state
    if [ -n "$error$backend_error$stream_error" ]; then state=degraded
    elif [ "$screen" = asleep ]; then state=paused
    elif [ "$stream_ready" = 1 ]; then state=running
    else state=starting
    fi
    [ "${stopping:-0}" = 0 ] || state=stopping
    lookup "$names" "$foreground"
    # Keep volatile values (timestamps, counters) out of this signature. It gates
    # every status-file write, so a volatile field would turn it into a disk write
    # per event. Only change-derived fields belong here.
    signature="pid=$$
start=$worker_start
state=$state
screen=$screen
foreground_package=$foreground
foreground_name=$found
target=$target
rate=$applied
global=$global_rate
backend=$backend
mode=$mode
error=${error:-$stream_error}
backend_error=$backend_error"
    if [ "$signature" != "$last_signature" ]; then
        printf '%s\nupdated=%s\n' "$signature" "$(clock)" > "$SESSION/status.tmp" && \
            mv -f "$SESSION/status.tmp" "$SESSION/status" && last_signature=$signature
    fi
    case "$state" in paused) old_state=running ;; *) old_state=$state ;; esac
    if [ "$last_description" != "$old_state" ]; then
        last_description=$old_state
        module_description "$old_state"
    fi
}

apply_target() {
    local command
    lookup "$mappings" "$target"
    command=$found
    [ -n "$command" ] || { error=rate_mapping_invalid; return 1; }
    if [ "$command" = "$last_command" ]; then
        applied=$target
        return 0
    fi
    set -- $command
    # Only validated touchHidlTest argument vectors reach this command.
    if limited "$@" >/dev/null 2>&1; then
        last_command=$command
        applied=$target
        log_message "rate=$applied foreground=${foreground:--}"
        return 0
    fi
    error=apply_failed
    log_message "error=apply_failed target=$target"
    return 1
}

set_foreground() {
    local previous_mode=$mode cadence=60
    foreground=$1
    if valid_package "$foreground"; then
        lookup "$rules" "$foreground"
        target=${found:-$global_rate}
        [ "$error" != foreground_unknown ] && [ "$error" != apply_failed ] || error=
        apply_target || true
    else
        target=
        case "$error" in ''|foreground_unknown) error=foreground_unknown ;; esac
    fi
    mode=events
    if [ "$fallback_enabled" = 1 ] && [ -n "$foreground" ]; then
        case "$fallback_apps" in
            *" $foreground "*) mode=watchlist; cadence=$interval ;;
        esac
    fi
    if [ "$stream_ready" = 0 ]; then
        mode=recovery
        cadence=15
    fi
    if [ "$next_focus" = 0 ] || [ "$mode" != "$previous_mode" ]; then next_focus=$((SECONDS + cadence)); fi
}

sync_foreground() {
    local package
    next_focus=0
    package=$(foreground_snapshot) || package=
    monotonic_cs; last_confirm_cs=$uptime
    confirm_pending=0
    set_foreground "$package"
}

# One trailing check per burst corrects transitional focus events without
# turning every log line into a dumpsys call.
schedule_confirm() {
    [ "$confirm_pending" = 0 ] || return 0
    confirm_pending=1
    monotonic_cs; confirm_start_cs=$uptime
    if [ "$screen" != asleep ] &&
        { [ "$next_focus" = 0 ] || [ "$next_focus" -gt "$((SECONDS + 1))" ]; }; then
        next_focus=$((SECONDS + 1))
    fi
}

request_foreground() {
    local now
    monotonic_cs
    now=$uptime
    if [ "$last_confirm_cs" = 0 ] ||
        [ "$((now - last_confirm_cs))" -ge "$confirm_gap_cs" ]; then
        sync_foreground
    else
        schedule_confirm
    fi
}

set_screen() {
    local previous=$screen
    screen=$1
    case "$screen" in
        asleep)
            mode=paused
            next_focus=0
            confirm_pending=0
            foreground=
            target=$global_rate
            if [ -n "$last_command" ]; then apply_target || true; fi
            ;;
        awake|unknown)
            if [ "$previous" != "$screen" ] || [ "${2:-}" = force ]; then sync_foreground; fi
            ;;
    esac
}

sync_screen() {
    local power
    if power=$(screen_snapshot); then
        set_screen "$power" "${1:-}"
    elif [ "$screen" != asleep ]; then
        set_screen unknown "${1:-}"
    else
        # Keep pausing on a temporarily unreadable power service, and retry at the low cadence.
        if [ "$error" != apply_failed ]; then error=power_unknown; fi
    fi
    next_power=$((SECONDS + 60))
}

finish_worker() {
    trap '' HUP INT TERM
    if [ "${stopping:-0}" = 0 ]; then
        stopping=1
        if [ -n "$last_command" ]; then
            target=$global_rate
            if ! apply_target; then log_message error=restore_failed; printf 'error=restore_failed\n' > "$RUN/stop.status"; fi
        fi
    fi
    worker_publish
    retire_listener
    [ -z "${listener_pid:-}" ] || kill -TERM "$listener_pid" 2>/dev/null || true
}

worker_main() {
    local state screen=unknown foreground= target= applied= last_command= error= backend_error= stream_error=
    local worker_start last_signature= last_description= listener_pid= listening=0 stream_ready=0
    local backend preferred record wait_for deadline next_probe next_power next_focus next_retry
    local reader_announced listener_started logger_pid logger_start
    local seen_awake seen_asleep retry_delay=1 stopping=0 rust_failures=0 screen_hint confirmed native_error=
    local confirm_pending=0 last_confirm_cs=0 confirm_start_cs=0 confirm_gap_cs previous_foreground=
    local confirm_after_app
    confirm_gap_cs=${TOUCH_CONFIRM_GAP_MS:-500}
    case "$confirm_gap_cs" in ''|*[!0-9]*) confirm_gap_cs=500 ;; esac
    confirm_gap_cs=$((confirm_gap_cs / 10))
    confirm_after_app=${TOUCH_CONFIRM_AFTER_APP:-1}
    case "$confirm_after_app" in 0|1) ;; *) confirm_after_app=1 ;; esac
    worker_start=$(proc_start "$$") || return 1
    load_profile || { log_message error=config_invalid; return 1; }
    preferred=$(module_edition)
    backend=$preferred
    if [ "$backend" = rust ] && [ "$(rust_capability)" != 1 ]; then
        backend_error=rust_unavailable
    fi
    exec 3<> "$SESSION/inbox"
    trap 'finish_worker; exit 0' HUP INT TERM
    mode=recovery
    next_retry=0
    start_listener "$backend"
    next_power=0
    next_focus=0
    worker_publish
    while :; do
        if [ "$listening" = 1 ] && [ "$next_probe" -le "$SECONDS" ]; then
            if ! proc_start "$listener_pid" >/dev/null; then
                wait "$listener_pid" 2>/dev/null || true
                listener_pid=
                retire_listener
                listening=0
                stream_ready=0
                stream_error=event_stream_lost
                log_message "error=$stream_error backend=$backend${native_error:+ native_error=$native_error}"
                if [ "$backend" = rust ]; then
                    rust_failures=$((rust_failures + 1))
                    if [ "$rust_failures" -ge 2 ]; then
                        backend_error=rust_failed
                    elif [ "$reader_announced" = 0 ]; then
                        backend_error=rust_start_failed
                    fi
                fi
                [ "$((SECONDS - listener_started))" -lt 30 ] || retry_delay=1
                next_retry=$((SECONDS + retry_delay))
                [ "$retry_delay" -ge 32 ] || retry_delay=$((retry_delay * 2))
                sync_screen force
                worker_publish
            elif [ "$stream_ready" = 1 ]; then
                # A connected FIFO can hide listener death, so probe even while paused.
                next_probe=$((SECONDS + 5))
            fi
        fi
        if [ "$listening" = 1 ] && [ "$stream_ready" = 0 ] && [ "$next_probe" -le "$SECONDS" ]; then
            if [ "$reader_announced" = 1 ] &&
                IFS=' ' read -r logger_pid logger_start < "$SESSION/logger" 2>/dev/null &&
                identity_matches "$logger_pid" "$logger_start"; then
                stream_ready=1
                stream_error=
                rust_failures=0
                next_probe=$((SECONDS + 5))
                case "$backend_error" in rust_start_failed|rust_failed|rust_unavailable) backend_error= ;; esac
                sync_screen force
                worker_publish
            elif [ "$((SECONDS - listener_started))" -ge 5 ]; then
                retire_listener
                next_probe=$((SECONDS + 1))
            else
                next_probe=$((listener_started + 5))
            fi
        fi
        if [ "$listening" = 0 ] && [ "$SECONDS" -ge "$next_retry" ]; then start_listener "$backend"; fi
        if [ "$next_power" -gt 0 ] && [ "$SECONDS" -ge "$next_power" ]; then
            [ "$error" != power_unknown ] || error=
            sync_screen
            worker_publish
        fi
        if [ "$next_focus" -gt 0 ] && [ "$SECONDS" -ge "$next_focus" ]; then
            if [ "$confirm_pending" = 1 ]; then
                monotonic_cs
                if [ "$((uptime - confirm_start_cs))" -lt "$confirm_gap_cs" ]; then
                    next_focus=$((SECONDS + 1))
                    continue
                fi
            fi
            sync_foreground
            worker_publish
        fi
        # No periodic power or focus query while safely paused on a verified stream.
        wait_for=0
        for deadline in "$next_power" "$next_focus"; do
            if [ "$deadline" -gt 0 ] && { [ "$wait_for" = 0 ] || [ "$deadline" -lt "$wait_for" ]; }; then wait_for=$deadline; fi
        done
        if [ "$listening" = 0 ] && { [ "$wait_for" = 0 ] || [ "$next_retry" -lt "$wait_for" ]; }; then wait_for=$next_retry; fi
        if [ "$listening" = 1 ] && [ "$next_probe" -gt 0 ] && { [ "$wait_for" = 0 ] || [ "$next_probe" -lt "$wait_for" ]; }; then wait_for=$next_probe; fi
        if [ "$wait_for" = 0 ]; then
            IFS= read -r -u3 record || continue
        else
            wait_for=$((wait_for - SECONDS))
            [ "$wait_for" -gt 0 ] || wait_for=1
            IFS= read -r -t "$wait_for" -u3 record || continue
        fi
        case "$record" in
            @stop) enabled || break ;;
            @reload)
                if ! load_profile; then error=config_invalid; worker_publish; continue; fi
                if [ "$preferred" != "$configured_backend" ]; then
                    finish_worker
                    return 75
                fi
                error=
                if [ "$screen" = asleep ]; then set_screen asleep; else sync_screen force; fi
                ;;
            @resync) next_probe=$SECONDS; sync_screen force ;;
            @ready)
                reader_announced=1
                next_probe=$((SECONDS + 1))
                continue
                ;;
            @lost)
                next_probe=$SECONDS
                # The wrapper reports this only after reaping its event source;
                # probe immediately so the restart backoff starts without extra delay.
                if [ -n "$listener_pid" ]; then wait "$listener_pid" 2>/dev/null || true; fi
                continue
                ;;
            @native-error:*)
                # The native reader reports why it could not start before exiting.
                native_error=${record#@native-error:}
                log_message "native_error=$native_error backend=$backend"
                continue
                ;;
            @screen:*)
                screen_hint=${record#@screen:}
                case "$screen_hint:$screen:$seen_awake:$seen_asleep" in
                    awake:awake:1:*|asleep:asleep:*:1) continue ;;
                esac
                if confirmed=$(screen_snapshot); then
                    if [ "$screen_hint" = "$confirmed" ]; then
                        case "$confirmed" in awake) seen_awake=1 ;; asleep) seen_asleep=1 ;; esac
                    fi
                    [ "$error" != power_unknown ] || error=
                    set_screen "$confirmed"
                    if [ "$screen_hint" != "$confirmed" ]; then next_power=$((SECONDS + 2))
                    elif [ "$seen_awake:$seen_asleep" = 1:1 ] && [ "$confirmed" = asleep ]; then next_power=0
                    else next_power=$((SECONDS + 60)); fi
                else
                    next_power=$((SECONDS + 15))
                    error=power_unknown
                fi
                ;;
            @keyguard)
                if [ "$screen" != asleep ]; then request_foreground; fi
                ;;
            @app:*)
                [ "$screen" != asleep ] || continue
                if [ "$screen" = awake ]; then
                    previous_foreground=$foreground
                    set_foreground "${record#@app:}"
                    if [ "$confirm_after_app" = 1 ] && [ "$previous_foreground" != "$foreground" ]; then
                        confirm_pending=0
                        schedule_confirm
                    fi
                else
                    request_foreground
                fi
                ;;
            @focus|@conflict) [ "$screen" = asleep ] || request_foreground ;;
            *) continue ;;
        esac
        worker_publish
    done
    finish_worker
}
