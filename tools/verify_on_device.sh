#!/system/bin/sh
# 设备端隔离验证：ColorOS 触控模块 2.5.2
# 在真实 Android mksh 下验证 A1 路径推导、双进程生命周期、
# restart.flag 热重启、僵尸进程回收、事件流清理与正常禁用路径。
#
# 隔离手段：
#   - RUNTIME_DIR 改写到 /data/local/tmp/ksu_verify/runtime
#   - PATH 前置 mock：touchHidlTest / ksud / logcat
#   - 不写入 /data/adb/modules/，不触碰真实模块系统
#
# 由 adb push 到 /data/local/tmp/ksu_verify/verify.sh 后以 /system/bin/sh 执行。
#
# v2 修正：
#   - mock logcat 用 exec sleep，避免 mock 自身 fork 造成"泄漏"假象
#   - 僵尸统计改为按 /proc/<pid>/stat 的 state+ppid 归因（僵尸的 cmdline 是空的）
#   - 进程统计改为遍历 /proc/*/cmdline（Android ps -A 不含完整路径）
#   - 增加正常禁用路径（flag=0 + stop.flag），而非只测 SIGTERM 强杀

T=/data/local/tmp/ksu_verify
MOD=$T/module
BIN=$T/bin
RUN=$T/runtime
SRC=$T/service.sh.src

fail() { echo "FATAL: $1"; exit 1; }

kill_leftovers() {
    for c in /proc/[0-9]*/cmdline; do
        p=${c#/proc/}; p=${p%/cmdline}
        case "$p" in ''|*[!0-9]*) continue ;; esac
        l=$(tr '\000' ' ' < "$c" 2>/dev/null)
        case "$l" in
            *ksu_verify/module*|*ksu_verify/bin*|*"sleep 600"*)
                kill -9 "$p" 2>/dev/null || true ;;
        esac
    done
}

# ---------------------------------------------------------------- 环境准备
echo "=== ENV ==="
echo "mksh=$KSH_VERSION"
echo "id=$(id -u)"
[ -f "$SRC" ] || fail "service.sh.src missing"
kill_leftovers
sleep 1
rm -rf "$MOD" "$BIN" "$RUN"
mkdir -p "$MOD" "$BIN" "$RUN" || fail "mkdir"

sed "s|^RUNTIME_DIR=.*|RUNTIME_DIR=\"$RUN\"|" "$SRC" > "$MOD/service.sh" || fail "sed"
chmod 0755 "$MOD/service.sh"
grep '^RUNTIME_DIR=' "$MOD/service.sh"

for f in touch_opt.conf rate_code.conf monitor_config.conf app_names.conf; do
    [ -f "$T/$f" ] || fail "$f missing"
done
cp "$T"/touch_opt.conf "$T"/rate_code.conf "$T"/monitor_config.conf "$T"/app_names.conf "$MOD/"
printf '1\n' > "$MOD/touch_enabled.flag"

# mock：触控硬件命令只记录调用
printf '#!/system/bin/sh\necho "MOCK $*" >> %s/touch_calls.log\nexit 0\n' "$T" > "$BIN/touchHidlTest"
# mock：屏蔽 ksud 对真实模块描述的写入
printf '#!/system/bin/sh\nexit 0\n' > "$BIN/ksud"
# mock：事件流输出一条可解析事件后用 exec 原地阻塞，不 fork 子进程
printf '#!/system/bin/sh\necho "11-11 13:00:00.000  1000  1000 I wm_resume_activity: [0,com.tencent.tmgp.sgame/.MainActivity]"\nexec sleep 600\n' > "$BIN/logcat"
chmod 0755 "$BIN"/*
: > "$T/touch_calls.log"

# ---------------------------------------------------------------- A1 专项
echo "=== A1: BARE FILENAME PATH RESOLUTION ==="
head -20 "$SRC" > "$MOD/probe.sh"
echo 'echo "A1_MODDIR=$MODDIR"; exit 0' >> "$MOD/probe.sh"
(cd "$MOD" && /system/bin/sh probe.sh) 2>&1
(cd "$MOD" && /system/bin/sh ./probe.sh) 2>&1
rm -f "$MOD/probe.sh"

# ---------------------------------------------------------------- 工具函数
# 输出 "系统Z态总数/归属本模块的Z态数"。僵尸的 cmdline 为空，只能按 ppid 归因。
zombie_stats() {
    total=0; owned=0
    wd=$(cat "$RUN/watchdog.pid" 2>/dev/null)
    wp=$(cat "$RUN/service.pid" 2>/dev/null)
    for s in /proc/[0-9]*/stat; do
        t=$(sed -n 's/^.*) //p' "$s" 2>/dev/null)
        [ -n "$t" ] || continue
        pair=$(echo "$t" | awk '{print $1, $2}')
        st=${pair%% *}; ppid=${pair##* }
        [ "$st" = "Z" ] || continue
        total=$((total + 1))
        case "$ppid" in
            "$wd"|"$wp") owned=$((owned + 1)) ;;
        esac
    done
    echo "$total/$owned"
}

service_procs() {
    n=0
    for c in /proc/[0-9]*/cmdline; do
        l=$(tr '\000' ' ' < "$c" 2>/dev/null)
        case "$l" in *ksu_verify/module*) n=$((n + 1)) ;; esac
    done
    echo "$n"
}

event_procs() {
    n=0
    for c in /proc/[0-9]*/cmdline; do
        l=$(tr '\000' ' ' < "$c" 2>/dev/null)
        case "$l" in *"sleep 600"*) n=$((n + 1)) ;; esac
    done
    echo "$n"
}

snap() {
    echo "--- SNAP: $1 ---"
    echo "watchdog_pid=$(cat "$RUN/watchdog.pid" 2>/dev/null)"
    echo "worker_pid=$(cat "$RUN/service.pid" 2>/dev/null)"
    echo "service_status=$(tr '\n' '|' < "$RUN/service.status" 2>/dev/null)"
    echo "watchdog_status=$(tr '\n' '|' < "$RUN/watchdog.status" 2>/dev/null)"
    echo "zombies_total/owned=$(zombie_stats)"
    echo "service_procs=$(service_procs) event_procs=$(event_procs)"
}

# ---------------------------------------------------------------- 启动
echo "=== START ==="
(cd "$MOD" && PATH="$BIN:$PATH" exec /system/bin/sh ./service.sh >/dev/null 2>&1) &
WPID=$!
echo "launched_pid=$WPID"
sleep 6
snap "after 6s"
echo "log_head:"
head -8 "$MOD/touch_opt.log" 2>/dev/null

# ---------------------------------------------------------------- 热重启 ×5
echo "=== HOT RESTART x5 ==="
i=1
while [ "$i" -le 5 ]; do
    : > "$RUN/restart.flag"
    sleep 7
    wp=$(cat "$RUN/service.pid" 2>/dev/null)
    wd=$(cat "$RUN/watchdog.pid" 2>/dev/null)
    state=$(grep -o 'state=[a-z]*' "$RUN/service.status" 2>/dev/null | head -1)
    echo "RESTART#$i worker=$wp watchdog=$wd $state zombies=$(zombie_stats) service_procs=$(service_procs) event_procs=$(event_procs)"
    i=$((i + 1))
done
snap "after 5 restarts"

# ---------------------------------------------------------------- 正常禁用路径
echo "=== NORMAL DISABLE (flag=0 + stop.flag) ==="
printf '0\n' > "$MOD/touch_enabled.flag"
: > "$RUN/stop.flag"
sleep 9
echo "after_disable_status=$(tr '\n' '|' < "$RUN/service.status" 2>/dev/null)"
echo "after_disable procs=$(service_procs) events=$(event_procs) zombies=$(zombie_stats)"
echo "runtime_files=$(ls "$RUN" 2>/dev/null | tr '\n' ',')"
# NEW-01 回归断言：禁用后状态必须是 disabled，且不能留下 worker 的 PID 文件与停止标记。
dstate=$(grep -m1 '^state=' "$RUN/service.status" 2>/dev/null)
[ "$dstate" = "state=disabled" ] && echo "CHECK_DISABLED_STATUS=PASS" || echo "CHECK_DISABLED_STATUS=FAIL (got $dstate)"
[ -e "$RUN/service.pid" ] && echo "CHECK_PID_CLEANUP=FAIL (service.pid remains)" || echo "CHECK_PID_CLEANUP=PASS"
[ -e "$RUN/stop.flag" ] && echo "CHECK_STOP_CLEANUP=FAIL (stop.flag remains)" || echo "CHECK_STOP_CLEANUP=PASS"

# ---------------------------------------------------------------- 收尾清理
echo "=== CLEANUP ==="
kill -TERM "$(cat "$RUN/watchdog.pid" 2>/dev/null)" 2>/dev/null || true
kill -TERM "$WPID" 2>/dev/null || true
sleep 2
kill_leftovers
sleep 1
echo "after_cleanup procs=$(service_procs) events=$(event_procs) zombies=$(zombie_stats)"

# ---------------------------------------------------------------- 结果
echo "=== TOUCH CALLS ==="
echo "count=$(wc -l < "$T/touch_calls.log")"
head -3 "$T/touch_calls.log"
echo "=== RESTART LOG LINES ==="
grep -E "热重启|工作进程已按新配置重启|收到配置变更" "$MOD/touch_opt.log" 2>/dev/null | tail -12
echo "=== DISABLE LOG LINES ==="
grep -E "停止|禁用|退出|cleanup|clean" "$MOD/touch_opt.log" 2>/dev/null | tail -10
echo "=== DONE ==="
