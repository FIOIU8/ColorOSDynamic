#!/system/bin/sh
# ColorOS 触控采样率优化 2.5
# 架构：watchdog 父进程负责监督与重启，worker 子进程负责前台检测与触控命令。
# 子进程的退出不会在状态文件里留下 state=error，避免 WebUI 读到陈旧错误。

MODDIR=${0%/*}
# 以裸文件名执行（sh service.sh）时 ${0%/*} 会原样返回文件名，补成当前目录。
[ "$MODDIR" = "$0" ] && MODDIR="$PWD"
case "$MODDIR" in
    /*) ;;
    *) MODDIR="$PWD/$MODDIR" ;;
esac

ENABLED_FLAG="$MODDIR/touch_enabled.flag"
CONFIG_FILE="$MODDIR/touch_opt.conf"
RATE_CODE_FILE="$MODDIR/rate_code.conf"
MONITOR_CONFIG_FILE="$MODDIR/monitor_config.conf"
APP_NAMES_FILE="$MODDIR/app_names.conf"
LOG_FILE="$MODDIR/touch_opt.log"
SERVICE_SCRIPT="$MODDIR/service.sh"

RUNTIME_DIR="/data/adb/ColorOSDynamic"
PID_FILE="$RUNTIME_DIR/service.pid"
WATCHDOG_PID_FILE="$RUNTIME_DIR/watchdog.pid"
WATCHDOG_STATUS_FILE="$RUNTIME_DIR/watchdog.status"
STATUS_FILE="$RUNTIME_DIR/service.status"
STOP_FILE="$RUNTIME_DIR/stop.flag"
RESTART_FILE="$RUNTIME_DIR/restart.flag"
EVENT_FIFO="$RUNTIME_DIR/activity-events"
TRACK_INPUT_FIFO="$RUNTIME_DIR/activity-observer-input"
TRACK_OUTPUT_FIFO="$RUNTIME_DIR/activity-observer-output"

FALLBACK_INTERVAL=60
HEARTBEAT_INTERVAL=15
MONITOR_POLL_INTERVAL=3
EVENT_RETRY_INTERVAL=15
WATCHDOG_INTERVAL=5
WATCHDOG_WINDOW=10
WATCHDOG_MAX_RESTARTS=3
WATCHDOG_COOLDOWN=60

SHELL_BIN=/system/bin/sh
[ -x "$SHELL_BIN" ] || SHELL_BIN=sh

FALLBACK_ENABLED=0
FALLBACK_METHOD="observer"
EVENT_PID=""
WAIT_PID=""
WATCHDOG_SLEEP_PID=""
WORKER_PID=""
CURRENT_RATE=""
CURRENT_FOREGROUND=""
CURRENT_RULE_PACKAGE=""
EVENT_MODE="starting"
FALLBACK_ACTIVE=0
FALLBACK_PACKAGE=""
OBSERVER_COMMAND=""
OBSERVER_FAILURE=""
SERVICE_STATE="starting"
LAST_ERROR=""
FATAL_ERROR=""
STATE_SINCE=0
NEXT_HEARTBEAT=0
RESTART_TIMES=""

# ---------------------------------------------------------------- 基础工具

timestamp() {
    local now=""
    now=$(date +%s 2>/dev/null)
    case "$now" in ''|*[!0-9]*) now=0 ;; esac
    printf '%s\n' "$now"
}

is_enabled() {
    local value=""
    [ -f "$ENABLED_FLAG" ] || return 1
    [ -f "$STOP_FILE" ] && return 1
    IFS= read -r value < "$ENABLED_FLAG" || true
    case "$value" in
        1) return 0 ;;
        0) return 1 ;;
        *)
            # 文件被原子替换或短暂截断时读到的空值，不能当作用户关闭了开关。
            sleep 1
            value=""
            IFS= read -r value < "$ENABLED_FLAG" || true
            [ "$value" = "1" ]
            ;;
    esac
}

rotate_log_if_needed() {
    local size=""
    [ -f "$LOG_FILE" ] || return 0
    size=$(wc -c < "$LOG_FILE" 2>/dev/null)
    case "$size" in ''|*[!0-9]*) return 0 ;; esac
    [ "$size" -lt 524288 ] && return 0
    rm -f "$LOG_FILE.1"
    mv "$LOG_FILE" "$LOG_FILE.1" 2>/dev/null || {
        tail -n 800 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
    }
}

log_info() {
    rotate_log_if_needed
    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] $1" >> "$LOG_FILE"
    log -p i -t "ColorOSTouch" "$1" 2>/dev/null || true
}

log_error() {
    rotate_log_if_needed
    echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] $1" >> "$LOG_FILE"
    log -p e -t "ColorOSTouch" "$1" 2>/dev/null || true
}

process_is_running() {
    local pid="$1"
    local rest=""
    [ -r "/proc/$pid/stat" ] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    # 进程名可能含空格，awk 取 $3 会错位；state 在最后一个 ')' 之后。
    rest=$(sed -n 's/^.*) //p' "/proc/$pid/stat" 2>/dev/null)
    case "$rest" in
        Z*|X*|x*) return 1 ;;
        *) return 0 ;;
    esac
}

# exec 是特殊内建：在 fd 未打开时做重定向可能直接终止非交互 shell。
# 所有 fd 关闭都必须先确认 fd 真的存在。
fd_is_open() {
    [ -e "/proc/self/fd/$1" ] 2>/dev/null
}

close_fd() {
    local fd="$1"
    fd_is_open "$fd" || return 0
    case "$fd" in
        3) exec 3>&- 2>/dev/null || true ;;
        4) exec 4>&- 2>/dev/null || true ;;
        5) exec 5>&- 2>/dev/null || true ;;
    esac
}

close_all_fds() {
    close_fd 5
    close_fd 4
    close_fd 3
}

# 外部命令一律限时；设备没有 timeout 时退回直接执行。
run_limited() {
    local secs="$1"
    shift
    if command -v timeout >/dev/null 2>&1; then
        timeout "$secs" "$@"
    else
        "$@"
    fi
}

valid_rate() {
    case "$1" in
        ''|*[!0-9]*) return 1 ;;
        *) return 0 ;;
    esac
}

valid_package() {
    printf '%s\n' "$1" | grep -Eq '^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$'
}

# ---------------------------------------------------------------- 应用名称

get_app_name() {
    [ -f "$APP_NAMES_FILE" ] || return 0
    awk -F= -v pkg="$1" '
        $1 == pkg {
            line = $0
            sub(/^[^=]*=/, "", line)
            gsub(/[\r\n\t]/, "", line)
            print line
            exit
        }' "$APP_NAMES_FILE" 2>/dev/null
}

display_app() {
    local pkg="$1"
    local name=""
    if [ -z "$pkg" ]; then
        printf '%s\n' "未知应用"
        return 0
    fi
    name=$(get_app_name "$pkg")
    if [ -n "$name" ]; then
        printf '%s（%s）\n' "$name" "$pkg"
    else
        printf '未知应用（%s）\n' "$pkg"
    fi
}

# ---------------------------------------------------------------- 状态输出

publish_module_description() {
    local state="$1"
    local app_text="${2:-}"
    local label=""
    local main_pid="-"
    local listener_pid="-"
    local updated=""
    local description=""
    local ksud_bin=""

    case "$state" in
        disabled) label="未启用" ;;
        waiting) label="等待启动" ;;
        starting) label="启动中" ;;
        running) label="运行中" ;;
        degraded) label="降级运行" ;;
        *) label="异常" ;;
    esac

    [ "$state" = "disabled" ] || main_pid="$$"
    case "${EVENT_PID:-}" in
        ''|*[!0-9]*) ;;
        *) listener_pid="$EVENT_PID" ;;
    esac
    updated=$(date '+%H:%M:%S' 2>/dev/null)
    [ -n "$updated" ] || updated="-"
    description="状态：$label | 主 PID：$main_pid | 检测 PID：$listener_pid"
    [ -n "$app_text" ] && description="$description | 前台：$app_text"
    description="$description | 更新：$updated"

    ksud_bin=$(command -v ksud 2>/dev/null)
    if [ -z "$ksud_bin" ] && [ -x /data/adb/ksud ]; then
        ksud_bin=/data/adb/ksud
    fi
    [ -n "$ksud_bin" ] || return 0
    if command -v timeout >/dev/null 2>&1; then
        KSU_MODULE=ColorOSDynamic timeout 2 "$ksud_bin" module config set \
            --temp override.description "$description" >/dev/null 2>&1 || true
    else
        KSU_MODULE=ColorOSDynamic "$ksud_bin" module config set \
            --temp override.description "$description" >/dev/null 2>&1 || true
    fi
}

write_status() {
    local state="$1"
    local error="$2"
    local now=""
    local name=""

    now=$(timestamp)
    if [ "$state" != "$SERVICE_STATE" ] || [ "$STATE_SINCE" -eq 0 ]; then
        STATE_SINCE="$now"
    fi
    SERVICE_STATE="$state"
    name=$(get_app_name "$CURRENT_FOREGROUND")
    if printf 'state=%s\nheartbeat=%s\nstate_since=%s\npid=%s\nforeground_package=%s\nforeground_name=%s\nrules_package=%s\nrate=%s\nmode=%s\nfallback_active=%s\nfallback_package=%s\nerror=%s\n' \
        "$state" "$now" "$STATE_SINCE" "$$" "$CURRENT_FOREGROUND" "$name" \
        "$CURRENT_RULE_PACKAGE" "$CURRENT_RATE" "$EVENT_MODE" \
        "$FALLBACK_ACTIVE" "$FALLBACK_PACKAGE" "$error" \
        > "$STATUS_FILE.tmp" && chmod 0600 "$STATUS_FILE.tmp" && mv "$STATUS_FILE.tmp" "$STATUS_FILE"; then
        publish_module_description "$state" "$(display_app "$CURRENT_FOREGROUND")"
    fi
}

# 由监督进程在工作进程终止后写入终态。
# 不复用 write_status：它用 $$ 写 pid 字段，在监督进程里会写错归属，
# 还会带上监督进程侧的 CURRENT_* 旧变量。这里字段集合保持一致
# （WebUI 的 parseFields 依赖这些字段），但值全部清空。
write_disabled_status() {
    local now=""
    now=$(timestamp)
    printf 'state=disabled\nheartbeat=%s\nstate_since=%s\npid=\nforeground_package=\nforeground_name=\nrules_package=\nrate=\nmode=\nfallback_active=\nfallback_package=\nerror=\n' \
        "$now" "$now" > "$STATUS_FILE.tmp" 2>/dev/null && \
        chmod 0600 "$STATUS_FILE.tmp" 2>/dev/null && \
        mv "$STATUS_FILE.tmp" "$STATUS_FILE" 2>/dev/null || true
    # 即使状态文件写入失败，描述也不能停留在陈旧的「运行中 / PID xxx」。
    publish_module_description "disabled" ""
}

refresh_health_state() {
    case "$EVENT_MODE" in
        events|observer|polling)
            if [ -z "$LAST_ERROR" ]; then
                SERVICE_STATE="running"
            else
                SERVICE_STATE="degraded"
            fi
            ;;
        *) SERVICE_STATE="degraded" ;;
    esac
    write_status "$SERVICE_STATE" "$LAST_ERROR"
}

# ---------------------------------------------------------------- 配置读取

load_monitor_config() {
    local key=""
    local value=""
    local line=""

    FALLBACK_ENABLED=0
    FALLBACK_METHOD="observer"
    MONITOR_POLL_INTERVAL=3
    [ -f "$MONITOR_CONFIG_FILE" ] || return 0
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in ''|\#*) continue ;; esac
        key=${line%%=*}
        value=${line#*=}
        case "$key" in
            fallback_enabled)
                [ "$value" = "1" ] && FALLBACK_ENABLED=1
                ;;
            fallback_method)
                case "$value" in observer|polling) FALLBACK_METHOD="$value" ;; esac
                ;;
            poll_interval)
                case "$value" in
                    ''|*[!0-9]*) ;;
                    *) [ "$value" -ge 1 ] && [ "$value" -le 60 ] && MONITOR_POLL_INTERVAL="$value" ;;
                esac
                ;;
        esac
    done < "$MONITOR_CONFIG_FILE"
}

is_fallback_package() {
    local package="$1"
    [ "$FALLBACK_ENABLED" = "1" ] || return 1
    valid_package "$package" || return 1
    awk -F= -v package="$package" '$1 == "fallback_package" && $2 == package { found = 1 } END { exit !found }' "$MONITOR_CONFIG_FILE" 2>/dev/null
}

get_global_rate() {
    local rate=""
    rate=$(awk -F= '$1 == "global_sample_rate" && $2 ~ /^[0-9]+$/ { print $2; exit }' "$CONFIG_FILE" 2>/dev/null)
    valid_rate "$rate" || rate=125
    printf '%s\n' "$rate"
}

get_game_rate() {
    awk -F= -v package="$1" '$1 == package && $2 ~ /^[0-9]+$/ { print $2; exit }' "$CONFIG_FILE" 2>/dev/null
}

get_rate_command() {
    awk -F= -v rate="$1" '$1 == rate { sub(/^[^=]*=/, ""); print; exit }' "$RATE_CODE_FILE" 2>/dev/null
}

valid_touch_command() {
    printf '%s\n' "$1" | grep -Eq '^touchHidlTest -c wo [0-9]{1,4} [0-9]{1,4} [A-Za-z0-9]{1,8}$'
}

# ---------------------------------------------------------------- 采样率应用

apply_rate() {
    local rate="$1"
    local rules_package="$2"
    local foreground="$3"
    local command=""
    local app_text=""

    valid_rate "$rate" || {
        LAST_ERROR="invalid_rate"
        refresh_health_state
        log_error "拒绝无效采样率：$rate"
        return 1
    }
    command=$(get_rate_command "$rate")
    if ! valid_touch_command "$command"; then
        LAST_ERROR="rate_mapping_invalid"
        refresh_health_state
        log_error "采样率 $rate 没有有效的 touchHidlTest 映射"
        return 1
    fi
    if [ "$rate" = "$CURRENT_RATE" ]; then
        CURRENT_FOREGROUND="$foreground"
        CURRENT_RULE_PACKAGE="$rules_package"
        case "$LAST_ERROR" in
            apply_failed|invalid_rate|rate_mapping_invalid) LAST_ERROR="" ;;
        esac
        refresh_health_state
        return 0
    fi

    # 严格的格式校验把命令固定为可执行文件名加三个参数，split 不会引入 shell 展开。
    set -- $command
    if run_limited 5 "$@" >/dev/null 2>&1; then
        CURRENT_RATE="$rate"
        CURRENT_FOREGROUND="$foreground"
        CURRENT_RULE_PACKAGE="$rules_package"
        app_text=$(display_app "$foreground")
        if [ -n "$rules_package" ]; then
            log_info "触控命令已应用：前台应用 $app_text 命中规则 $rules_package，采样率 $rate"
        else
            log_info "触控命令已应用：前台应用 $app_text 使用全局采样率 $rate"
        fi
        case "$LAST_ERROR" in
            apply_failed|invalid_rate|rate_mapping_invalid) LAST_ERROR="" ;;
        esac
        refresh_health_state
    else
        LAST_ERROR="apply_failed"
        refresh_health_state
        log_error "应用采样率 $rate 失败或超时"
        return 1
    fi
}

handle_package() {
    local foreground="$1"
    local rate=""
    local rules_package=""
    local changed="0"
    local old_foreground="$CURRENT_FOREGROUND"
    local old_rule_package="$CURRENT_RULE_PACKAGE"
    local app_text=""

    valid_package "$foreground" || foreground=""
    if [ "$foreground" != "$old_foreground" ]; then
        changed="1"
        [ -n "$old_foreground" ] && log_info "检测到前台应用退出：$(display_app "$old_foreground")"
        if [ -n "$foreground" ]; then
            log_info "检测到前台应用进入：$(display_app "$foreground")"
        else
            log_info "未检测到前台应用，切换到全局规则"
        fi
    fi
    if [ -n "$foreground" ]; then
        rate=$(get_game_rate "$foreground")
    fi
    if ! valid_rate "$rate"; then
        rate=$(get_global_rate)
    else
        rules_package="$foreground"
    fi
    if [ "$rules_package" != "$old_rule_package" ] || [ "$rate" != "$CURRENT_RATE" ]; then
        changed="1"
    fi
    if [ "$changed" = "1" ]; then
        app_text=$(display_app "$foreground")
        if [ -n "$rules_package" ]; then
            log_info "前台应用 $app_text 命中应用规则，目标采样率 $rate"
        else
            log_info "前台应用 $app_text 使用全局采样率，目标采样率 $rate"
        fi
        if [ "$rate" = "$CURRENT_RATE" ]; then
            log_info "目标采样率未变化，跳过重复触控命令"
        fi
    fi
    apply_rate "$rate" "$rules_package" "$foreground"
}

# ---------------------------------------------------------------- 前台解析

package_from_event() {
    local component=""
    local package=""
    component=$(printf '%s\n' "$1" | awk -F, '
        {
            for (i = NF; i > 0; i--) {
                value = $i
                if (value ~ /\//) {
                    sub(/^[[:space:]" ]+/, "", value)
                    sub(/\].*$/, "", value)
                    sub(/\/.*$/, "", value)
                    print value
                    exit
                }
            }
            for (i = NF; i > 0; i--) {
                value = $i
                gsub(/[^A-Za-z0-9_.]/, "", value)
                if (value ~ /^[A-Za-z0-9_]+\.[A-Za-z0-9_.]+$/) {
                    print value
                    exit
                }
            }
        }')
    package=${component%%/*}
    valid_package "$package" && printf '%s\n' "$package"
}

dump_activities() {
    run_limited 5 dumpsys activity activities 2>/dev/null
}

dump_windows() {
    run_limited 5 dumpsys window 2>/dev/null
}

get_foreground_package() {
    local package=""
    package=$(dump_activities | awk '
        /mResumedActivity|topResumedActivity/ {
            for (i = 1; i < NF; i++) {
                if ($i ~ /^u[0-9]+$/) {
                    value = $(i + 1)
                    sub(/\/.*/, "", value)
                    if (value ~ /^[A-Za-z0-9_.]+$/) {
                        print value
                        exit
                    }
                }
            }
        }')
    if [ -z "$package" ]; then
        package=$(dump_windows | awk '
            /mCurrentFocus|mFocusedApp/ {
                for (i = 1; i <= NF; i++) {
                    if ($i ~ /^[A-Za-z0-9_.]+\//) {
                        value = $i
                        sub(/\/.*/, "", value)
                        if (value ~ /^[A-Za-z0-9_.]+$/) {
                            print value
                            exit
                        }
                    }
                }
            }')
    fi
    valid_package "$package" && printf '%s\n' "$package"
}

# ---------------------------------------------------------------- 事件流

stop_event_stream() {
    if [ -n "$EVENT_PID" ]; then
        kill "$EVENT_PID" 2>/dev/null || true
        # logcat 在锁屏/Doze 下可能被冻结，wait 会永久卡住主循环；这里不等待。
        # T 态经 kill -9 转 Z 后可被回收：仅在已确认退出（Z/消失）时 wait，D 态仍一律跳过。
        if process_is_running "$EVENT_PID"; then
            kill -9 "$EVENT_PID" 2>/dev/null || true
        fi
        process_is_running "$EVENT_PID" || wait "$EVENT_PID" 2>/dev/null || true
        EVENT_PID=""
    fi
    close_fd 3
    rm -f "$EVENT_FIFO"
}

start_event_stream() {
    local attempt=0
    local max_attempts="${1:-3}"
    # 幂等：启动前先清理可能残留的监听进程与 FIFO。
    stop_event_stream
    rm -f "$EVENT_FIFO"
    if ! mkfifo "$EVENT_FIFO"; then
        EVENT_MODE="polling"
        LAST_ERROR="event_pipe_unavailable"
        refresh_health_state
        log_error "无法创建 Activity 事件管道，改用 $FALLBACK_INTERVAL 秒兜底检测"
        return 1
    fi
    chmod 0600 "$EVENT_FIFO"
    if ! exec 3<> "$EVENT_FIFO" 2>/dev/null; then
        EVENT_MODE="polling"
        LAST_ERROR="event_pipe_unavailable"
        refresh_health_state
        log_error "无法打开 Activity 事件管道，改用 $FALLBACK_INTERVAL 秒兜底检测"
        rm -f "$EVENT_FIFO"
        return 1
    fi

    # 开机早期 events 缓冲区可能尚未就绪，logcat 会启动即退出。
    # 先确认进程存活并重试，不要一上来就判定「无法监听 Activity 事件」。
    while [ "$attempt" -lt "$max_attempts" ]; do
        attempt=$((attempt + 1))
        logcat -b events -v brief -s \
            am_resume_activity:I \
            am_restart_activity:I \
            am_relaunch_resume_activity:I \
            wm_resume_activity:I \
            wm_restart_activity:I \
            wm_relaunch_resume_activity:I > "$EVENT_FIFO" 2>/dev/null &
        EVENT_PID=$!
        sleep 1
        if process_is_running "$EVENT_PID"; then
            EVENT_MODE="events"
            if [ "$LAST_ERROR" = "event_stream_unavailable" ]; then
                log_info "Activity 事件监听已恢复，退出定时检测降级模式"
            fi
            if [ "$LAST_ERROR" = "event_pipe_unavailable" ] || [ "$LAST_ERROR" = "event_stream_unavailable" ]; then
                LAST_ERROR=""
            fi
            refresh_health_state
            if [ "$attempt" -gt 1 ]; then
                log_info "Activity 事件监听在第 $attempt 次尝试后启动成功"
            fi
            return 0
        fi
        # 进程已确认退出，wait 会立即返回并回收，不会阻塞。
        wait "$EVENT_PID" 2>/dev/null || true
        EVENT_PID=""
        if [ "$attempt" -lt "$max_attempts" ]; then
            log_info "Activity 事件监听第 $attempt 次启动失败，2 秒后重试（开机早期可能尚未就绪）"
            sleep 2
        fi
    done

    EVENT_MODE="polling"
    if [ "$LAST_ERROR" != "event_stream_unavailable" ]; then
        log_error "Activity 事件监听连续 ${max_attempts} 次启动失败，改用定时检测；每 ${EVENT_RETRY_INTERVAL}s 尝试恢复"
    fi
    LAST_ERROR="event_stream_unavailable"
    refresh_health_state
    return 1
}

# ---------------------------------------------------------------- 前台观察器

start_activity_observer() {
    local candidate=""
    EVENT_PID=""
    OBSERVER_FAILURE="command_unavailable"
    for candidate in cmd am; do
        rm -f "$TRACK_INPUT_FIFO" "$TRACK_OUTPUT_FIFO"
        if ! mkfifo "$TRACK_INPUT_FIFO" "$TRACK_OUTPUT_FIFO"; then
            OBSERVER_FAILURE="fifo_unavailable"
            rm -f "$TRACK_INPUT_FIFO" "$TRACK_OUTPUT_FIFO"
            return 1
        fi
        chmod 0600 "$TRACK_INPUT_FIFO" "$TRACK_OUTPUT_FIFO"
        if ! exec 4<> "$TRACK_OUTPUT_FIFO" 2>/dev/null; then
            OBSERVER_FAILURE="fifo_open_failed"
            close_fd 4
            rm -f "$TRACK_INPUT_FIFO" "$TRACK_OUTPUT_FIFO"
            return 1
        fi
        if [ "$candidate" = "cmd" ]; then
            cmd activity observe-foreground-process < "$TRACK_INPUT_FIFO" > "$TRACK_OUTPUT_FIFO" 2>/dev/null &
        else
            am observe-foreground-process < "$TRACK_INPUT_FIFO" > "$TRACK_OUTPUT_FIFO" 2>/dev/null &
        fi
        EVENT_PID=$!
        if ! exec 5> "$TRACK_INPUT_FIFO" 2>/dev/null; then
            OBSERVER_FAILURE="input_pipe_failed"
            kill "$EVENT_PID" 2>/dev/null || true
            wait "$EVENT_PID" 2>/dev/null || true
            EVENT_PID=""
            close_all_fds
            rm -f "$TRACK_INPUT_FIFO" "$TRACK_OUTPUT_FIFO"
            return 1
        fi
        sleep 1
        if process_is_running "$EVENT_PID"; then
            OBSERVER_COMMAND="$candidate"
            EVENT_MODE="observer"
            LAST_ERROR=""
            log_info "已启动 $candidate 前台进程观察器"
            refresh_health_state
            return 0
        fi
        OBSERVER_FAILURE="observer_start_failed"
        wait "$EVENT_PID" 2>/dev/null || true
        EVENT_PID=""
        close_all_fds
        rm -f "$TRACK_INPUT_FIFO" "$TRACK_OUTPUT_FIFO"
    done
    return 1
}

stop_activity_observer() {
    if [ -n "$EVENT_PID" ]; then
        if fd_is_open 5; then
            printf 'q\n' >&5 2>/dev/null || true
        fi
        close_fd 5
        sleep 1
        if process_is_running "$EVENT_PID"; then
            kill "$EVENT_PID" 2>/dev/null || true
            kill -9 "$EVENT_PID" 2>/dev/null || true
        fi
        # 与 stop_event_stream 相同：T 态经 kill -9 转 Z 后可被回收，D 态不等待。
        process_is_running "$EVENT_PID" || wait "$EVENT_PID" 2>/dev/null || true
        EVENT_PID=""
    else
        close_fd 5
    fi
    close_fd 4
    rm -f "$TRACK_INPUT_FIFO" "$TRACK_OUTPUT_FIFO"
}

start_fallback_monitor() {
    local package="$1"
    FALLBACK_ACTIVE=1
    FALLBACK_PACKAGE="$package"
    stop_event_stream
    log_info "前台应用 $(display_app "$package") 命中检测回退名单"
    if [ "$FALLBACK_METHOD" = "observer" ]; then
        if start_activity_observer; then
            return 0
        fi
        EVENT_MODE="polling"
        LAST_ERROR="activity_observer_unavailable"
        log_error "cmd activity/am 前台进程观察器不可用（$OBSERVER_FAILURE），回退到定时轮询"
    else
        EVENT_MODE="polling"
        LAST_ERROR=""
        log_info "按设置切换到定时轮询，检测间隔 ${MONITOR_POLL_INTERVAL}s"
    fi
    refresh_health_state
}

stop_fallback_monitor() {
    case "$EVENT_MODE" in
        observer) stop_activity_observer ;;
        polling) EVENT_PID="" ;;
    esac
    FALLBACK_ACTIVE=0
    FALLBACK_PACKAGE=""
    [ "$LAST_ERROR" = "activity_observer_unavailable" ] && LAST_ERROR=""
    log_info "前台应用离开检测回退名单，恢复 Activity 事件监听"
    start_event_stream || true
}

handle_monitored_package() {
    local package="$1"
    local previous_fallback="$FALLBACK_PACKAGE"
    valid_package "$package" || package=""
    if [ "$FALLBACK_ACTIVE" = "1" ]; then
        if is_fallback_package "$package"; then
            if [ "$previous_fallback" != "$package" ]; then
                FALLBACK_PACKAGE="$package"
                log_info "检测回退名单应用切换：$(display_app "$package")"
                write_status "$SERVICE_STATE" "$LAST_ERROR"
            fi
        else
            stop_fallback_monitor
        fi
    elif is_fallback_package "$package"; then
        start_fallback_monitor "$package"
    fi
    handle_package "$package"
}

stop_active_monitor() {
    case "$EVENT_MODE" in
        events) stop_event_stream ;;
        observer) stop_activity_observer ;;
        *)
            close_all_fds
            rm -f "$EVENT_FIFO" "$TRACK_INPUT_FIFO" "$TRACK_OUTPUT_FIFO"
            EVENT_PID=""
            ;;
    esac
}

# ---------------------------------------------------------------- worker

worker_cleanup() {
    if [ -n "$WAIT_PID" ]; then
        kill "$WAIT_PID" 2>/dev/null || true
        wait "$WAIT_PID" 2>/dev/null || true
        WAIT_PID=""
    fi
    stop_active_monitor
    # 不写 error：普通退出只标记为 starting/disabled，由 watchdog 决定后续状态。
    # 只有明确判定为致命错误（如配置缺失）才把 error 留在状态文件里。
    if [ -n "$FATAL_ERROR" ]; then
        write_status "error" "$FATAL_ERROR"
    elif is_enabled; then
        write_status "starting" ""
    else
        write_status "disabled" ""
    fi
    if [ -f "$PID_FILE" ] && [ "$(cat "$PID_FILE" 2>/dev/null)" = "$$" ]; then
        rm -f "$PID_FILE"
    fi
}

worker_main() {
    mkdir -p "$RUNTIME_DIR"
    chmod 0700 "$RUNTIME_DIR"
    trap 'worker_cleanup' EXIT
    trap 'exit 0' HUP INT TERM
    STATE_SINCE=$(timestamp)
    SERVICE_STATE="starting"
    write_status "starting" ""

    if [ ! -f "$CONFIG_FILE" ] || [ ! -f "$RATE_CODE_FILE" ]; then
        FATAL_ERROR="config_missing"
        LAST_ERROR="$FATAL_ERROR"
        write_status "error" "$FATAL_ERROR"
        log_error "触控配置缺失，工作进程退出"
        exit 1
    fi

    load_monitor_config
    log_info "触控服务启动（工作进程 $$）；默认使用 Activity 事件监听，检测回退名单：$FALLBACK_ENABLED"
    start_event_stream || true
    handle_monitored_package "$(get_foreground_package)"
    NEXT_FALLBACK=$((SECONDS + FALLBACK_INTERVAL))
    NEXT_HEARTBEAT=$((SECONDS + HEARTBEAT_INTERVAL))
    NEXT_POLL=$((SECONDS + MONITOR_POLL_INTERVAL))

    while is_enabled; do
        case "$EVENT_MODE" in
            events)
                WAIT_SECONDS=$((NEXT_FALLBACK - SECONDS))
                HEARTBEAT_WAIT=$((NEXT_HEARTBEAT - SECONDS))
                [ "$HEARTBEAT_WAIT" -lt "$WAIT_SECONDS" ] && WAIT_SECONDS="$HEARTBEAT_WAIT"
                [ "$WAIT_SECONDS" -gt 0 ] || WAIT_SECONDS=1
                LOOP_START=$SECONDS
                # mksh 的 read -u[n] 要求 fd 紧跟选项：必须写 -u3，-u 3 会把 3 当变量名。
                if IFS= read -r -t "$WAIT_SECONDS" -u3 EVENT_LINE; then
                    PACKAGE=$(package_from_event "$EVENT_LINE")
                    [ -n "$PACKAGE" ] || PACKAGE=$(get_foreground_package)
                    [ -n "$PACKAGE" ] && handle_monitored_package "$PACKAGE"
                else
                    is_enabled || break
                    if [ -n "$EVENT_PID" ] && ! process_is_running "$EVENT_PID"; then
                        wait "$EVENT_PID" 2>/dev/null || true
                        EVENT_PID=""
                        log_info "Activity 事件流已退出，尝试重新启动"
                        if ! start_event_stream; then
                            NEXT_POLL=$((SECONDS + EVENT_RETRY_INTERVAL))
                        fi
                        handle_monitored_package "$(get_foreground_package)"
                    fi
                    if [ "$SECONDS" -ge "$NEXT_FALLBACK" ]; then
                        handle_monitored_package "$(get_foreground_package)"
                        NEXT_FALLBACK=$((SECONDS + FALLBACK_INTERVAL))
                    fi
                    # read 立刻失败（fd 异常/EOF）时防止主循环忙转烧 CPU。
                    [ "$SECONDS" -gt "$LOOP_START" ] || sleep 1
                fi
                ;;
            observer)
                WAIT_SECONDS=$((NEXT_FALLBACK - SECONDS))
                HEARTBEAT_WAIT=$((NEXT_HEARTBEAT - SECONDS))
                [ "$HEARTBEAT_WAIT" -lt "$WAIT_SECONDS" ] && WAIT_SECONDS="$HEARTBEAT_WAIT"
                [ "$WAIT_SECONDS" -gt 0 ] || WAIT_SECONDS=1
                LOOP_START=$SECONDS
                if IFS= read -r -t "$WAIT_SECONDS" -u4 TRACK_LINE; then
                    PACKAGE=$(package_from_event "$TRACK_LINE")
                    [ -n "$PACKAGE" ] || PACKAGE=$(get_foreground_package)
                    handle_monitored_package "$PACKAGE"
                else
                    is_enabled || break
                    if [ -n "$EVENT_PID" ] && ! process_is_running "$EVENT_PID"; then
                        wait "$EVENT_PID" 2>/dev/null || true
                        EVENT_PID=""
                        stop_activity_observer
                        EVENT_MODE="polling"
                        LAST_ERROR="activity_observer_unavailable"
                        refresh_health_state
                        log_error "Activity 观察器已退出，回退到定时轮询"
                        NEXT_POLL=$((SECONDS + MONITOR_POLL_INTERVAL))
                    fi
                    if [ "$SECONDS" -ge "$NEXT_FALLBACK" ]; then
                        handle_monitored_package "$(get_foreground_package)"
                        NEXT_FALLBACK=$((SECONDS + FALLBACK_INTERVAL))
                    fi
                    [ "$SECONDS" -gt "$LOOP_START" ] || sleep 1
                fi
                ;;
            *)
                if [ "$FALLBACK_ACTIVE" = "1" ]; then
                    WAIT_SECONDS="$MONITOR_POLL_INTERVAL"
                else
                    WAIT_SECONDS="$FALLBACK_INTERVAL"
                fi
                POLL_WAIT=$((NEXT_POLL - SECONDS))
                [ "$POLL_WAIT" -lt "$WAIT_SECONDS" ] && WAIT_SECONDS="$POLL_WAIT"
                HEARTBEAT_WAIT=$((NEXT_HEARTBEAT - SECONDS))
                [ "$HEARTBEAT_WAIT" -lt "$WAIT_SECONDS" ] && WAIT_SECONDS="$HEARTBEAT_WAIT"
                [ "$WAIT_SECONDS" -gt 0 ] || WAIT_SECONDS=1
                sleep "$WAIT_SECONDS" &
                WAIT_PID=$!
                wait "$WAIT_PID" 2>/dev/null || true
                WAIT_PID=""
                is_enabled || break
                if [ "$SECONDS" -ge "$NEXT_HEARTBEAT" ]; then
                    refresh_health_state
                    NEXT_HEARTBEAT=$((SECONDS + HEARTBEAT_INTERVAL))
                fi
                if [ "$SECONDS" -ge "$NEXT_POLL" ]; then
                    handle_monitored_package "$(get_foreground_package)"
                    if [ "$FALLBACK_ACTIVE" != "1" ]; then
                        NEXT_POLL=$((SECONDS + EVENT_RETRY_INTERVAL))
                        # 降级后的恢复探测只试一次，避免反复写日志和拉长主循环。
                        start_event_stream 1 || true
                        NEXT_FALLBACK=$((SECONDS + FALLBACK_INTERVAL))
                    else
                        NEXT_POLL=$((SECONDS + MONITOR_POLL_INTERVAL))
                    fi
                fi
                ;;
        esac
        if [ "$SECONDS" -ge "$NEXT_HEARTBEAT" ]; then
            refresh_health_state
            NEXT_HEARTBEAT=$((SECONDS + HEARTBEAT_INTERVAL))
        fi
    done
}

# ---------------------------------------------------------------- watchdog

start_worker() {
    WATCHDOG_ROLE=worker "$SHELL_BIN" "$SERVICE_SCRIPT" >/dev/null 2>&1 &
    WORKER_PID=$!
    printf '%s\n' "$WORKER_PID" > "$PID_FILE.tmp" && \
        chmod 0600 "$PID_FILE.tmp" && mv "$PID_FILE.tmp" "$PID_FILE"
}

watchdog_stop() {
    # TERM trap 与 EXIT trap 会先后触发同一个函数，避免重复写终态与重复调用 ksud。
    [ "${WATCHDOG_STOP_DONE:-}" = "1" ] && return 0
    WATCHDOG_STOP_DONE=1
    local grace=0
    if [ -n "$WATCHDOG_SLEEP_PID" ]; then
        kill "$WATCHDOG_SLEEP_PID" 2>/dev/null || true
        wait "$WATCHDOG_SLEEP_PID" 2>/dev/null || true
        WATCHDOG_SLEEP_PID=""
    fi
    if [ -n "$WORKER_PID" ]; then
        kill "$WORKER_PID" 2>/dev/null || true
        # 给工作进程的 EXIT trap 一个有界窗口，让它自己写终态、清理自己的 PID 文件。
        # 只轮询 worker 自身，绝不 wait 它的 logcat / observer 子进程；
        # D 态（系统冻结）在窗口结束后照常被 -9，2.5.1「不阻塞监督主循环」的权衡不变。
        # 这里只在监督进程退出时执行，不在 5 秒主循环里。
        while [ "$grace" -lt 2 ] && process_is_running "$WORKER_PID"; do
            sleep 1
            grace=$((grace + 1))
        done
        if process_is_running "$WORKER_PID"; then
            kill -9 "$WORKER_PID" 2>/dev/null || true
        fi
        WORKER_PID=""
    fi
    if [ -f "$WATCHDOG_PID_FILE" ] && [ "$(cat "$WATCHDOG_PID_FILE" 2>/dev/null)" = "$$" ]; then
        rm -f "$WATCHDOG_PID_FILE"
    fi
    rm -f "$WATCHDOG_STATUS_FILE" "$WATCHDOG_STATUS_FILE.tmp"
    # SIGKILL 会跳过 worker 的 EXIT trap（worker_cleanup），此时由监督进程兜底写终态，
    # 保证磁盘状态、KernelSU 模块描述与真实进程状态一致。
    if ! is_enabled; then
        write_disabled_status
        rm -f "$PID_FILE" "$PID_FILE.tmp" "$STOP_FILE"
    fi
}

write_watchdog_status() {
    printf 'watchdog_pid=%s\nwatchdog_heartbeat=%s\nwatchdog_state=%s\nworker_pid=%s\n' \
        "$$" "$(timestamp)" "$1" "${WORKER_PID:-}" \
        > "$WATCHDOG_STATUS_FILE.tmp" && \
        chmod 0600 "$WATCHDOG_STATUS_FILE.tmp" && \
        mv "$WATCHDOG_STATUS_FILE.tmp" "$WATCHDOG_STATUS_FILE"
}

watchdog_main() {
    local old=""
    local now=""
    local kept=""
    local t=""
    local count=0

    mkdir -p "$RUNTIME_DIR"
    chmod 0700 "$RUNTIME_DIR"

    if [ -f "$WATCHDOG_PID_FILE" ]; then
        old=$(cat "$WATCHDOG_PID_FILE" 2>/dev/null)
        case "$old" in
            ''|*[!0-9]*) ;;
            *)
                if kill -0 "$old" 2>/dev/null && \
                    tr '\000' ' ' < "/proc/$old/cmdline" 2>/dev/null | grep -Fq "$SERVICE_SCRIPT"; then
                    exit 0
                fi
                ;;
        esac
    fi

    # 上一次卸载/重启若异常退出，标记可能残留；新的监督进程接管后清除。
    rm -f "$STOP_FILE" "$RESTART_FILE"
    printf '%s\n' "$$" > "$WATCHDOG_PID_FILE"
    chmod 0600 "$WATCHDOG_PID_FILE"
    trap 'watchdog_stop; exit 0' HUP INT TERM
    trap 'watchdog_stop' EXIT

    start_worker
    log_info "监督进程启动（PID $$），工作进程 PID $WORKER_PID"
    write_watchdog_status "running"

    while is_enabled; do
        if [ -f "$RESTART_FILE" ]; then
            # 配置变更只重启工作进程：监督进程不退出，避免 stop.flag 与单实例检查竞态。
            rm -f "$RESTART_FILE"
            log_info "收到配置变更请求，热重启工作进程"
            RESTART_TIMES=""
            kill "$WORKER_PID" 2>/dev/null || true
            if process_is_running "$WORKER_PID"; then
                kill -9 "$WORKER_PID" 2>/dev/null || true
            fi
            sleep 1
            # 旧 worker 是监督进程的直接子进程；只在已确认退出（Z/消失）时回收，
            # D 态仍跳过 wait，避免卡住监督主循环。
            process_is_running "$WORKER_PID" || wait "$WORKER_PID" 2>/dev/null || true
            start_worker
            log_info "工作进程已按新配置重启，PID $WORKER_PID"
            write_watchdog_status "restarting"
        elif ! process_is_running "$WORKER_PID"; then
            wait "$WORKER_PID" 2>/dev/null || true
            now=$(timestamp)
            kept=""
            for t in $RESTART_TIMES; do
                case "$t" in
                    ''|*[!0-9]*) ;;
                    *) [ "$((now - t))" -lt "$WATCHDOG_WINDOW" ] && kept="$kept $t" ;;
                esac
            done
            RESTART_TIMES="$kept"
            count=0
            for t in $RESTART_TIMES; do count=$((count + 1)); done
            if [ "$count" -ge "$WATCHDOG_MAX_RESTARTS" ]; then
                # 锁屏/Doze 期间系统可能连续清理后台进程。监督进程绝不退出，冷却后继续尝试。
                log_error "工作进程在 ${WATCHDOG_WINDOW}s 内退出超过 ${WATCHDOG_MAX_RESTARTS} 次，冷却 ${WATCHDOG_COOLDOWN}s 后重试"
                write_watchdog_status "cooldown"
                RESTART_TIMES=""
                sleep "$WATCHDOG_COOLDOWN" &
                WATCHDOG_SLEEP_PID=$!
                wait "$WATCHDOG_SLEEP_PID" 2>/dev/null || true
                WATCHDOG_SLEEP_PID=""
                is_enabled || break
                start_worker
                log_info "冷却结束，重新拉起工作进程，PID $WORKER_PID"
                write_watchdog_status "restarting"
            else
                RESTART_TIMES="$RESTART_TIMES $now"
                start_worker
                log_info "工作进程已重启，PID $WORKER_PID"
                write_watchdog_status "restarting"
            fi
        fi
        write_watchdog_status "running"
        sleep "$WATCHDOG_INTERVAL" &
        WATCHDOG_SLEEP_PID=$!
        wait "$WATCHDOG_SLEEP_PID" 2>/dev/null || true
        WATCHDOG_SLEEP_PID=""
    done
}

# ---------------------------------------------------------------- 入口

if [ ! -f "$ENABLED_FLAG" ]; then
    publish_module_description "disabled" ""
    exit 0
fi
IFS= read -r ENABLED < "$ENABLED_FLAG" || true
if [ "$ENABLED" != "1" ]; then
    publish_module_description "disabled" ""
    exit 0
fi
if [ -f "$STOP_FILE" ] && [ -z "${WATCHDOG_ROLE:-}" ]; then
    # 停止标记由卸载/重启脚本写入；已运行的 watchdog 会自行退出。
    exit 0
fi

case "${WATCHDOG_ROLE:-}" in
    worker) worker_main ;;
    *) watchdog_main ;;
esac

exit 0
