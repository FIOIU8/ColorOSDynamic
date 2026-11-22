# ColorOS 触控采样率优化

> **非正式版**：本项目所有版本均为非正式、实验性版本，可能随时改动或撤回，不保证稳定性。请先备份可用版本再升级；日常使用建议保留一个已验证的旧包。

按前台应用选择触控档位。模块默认关闭，安装后可以在支持 WebUI 的 KernelSU 或 Magisk 管理器里启用。升级会保留开关、规则、映射、应用名称和特殊应用名单，旧观察器模式会迁移为名单轮询。

## 安装包

- `ColorOSDynamic-vX.Y.Z.zip` 使用 Shell 事件监听，建议日常使用。
- `ColorOSDynamic-vX.Y.Z-rust-arm64-experimental.zip` 为 `arm64-v8a` 试验包，默认同样使用 Shell。在 WebUI 的「规则 → 高级设置」选中 Rust 并保存后才切换。启动失败会切回 Shell，原因显示在「诊断」。

从 GitHub Release 的 Assets 取安装 ZIP，在管理器中安装并重启。WebUI 的「最近成功下发」表示厂商指令返回成功，模块无法读取硬件当前实际频率。

## 监听与息屏

两个后端订阅同一组 `logcat` 事件，使用相同的规则和硬件命令。事件明确时直接更新前台，焦点不明时查询系统。亮屏期间每 60 秒校准一次，名单应用可配置更短间隔。确认息屏后回到全局档并暂停前台查询。若本次事件连接已确认亮屏和息屏事件，息屏期间阻塞等待。无法确认事件覆盖的设备会继续低频检查电源状态。

服务只在状态变化时发布状态，没有周期心跳。Shell 负责配置、状态、规则和 HAL 调用。Rust 试验包替换事件读取、识别和合并部分，因此两版的测试可以区分监听器差异。WebUI 的定时刷新只在可见的概览页工作，日志按需读取。

## 本地验证与打包

```sh
node --test tools/test_rate_layout.js
cargo test --locked --manifest-path native/Cargo.toml
bash tools/package_module.sh --worktree

# 构建 Rust 试验包需要 NDK 和对应 Rust target
rustup target add aarch64-linux-android
ANDROID_NDK_HOME=/path/to/ndk bash tools/build_native.sh
bash tools/package_module.sh --worktree --experimental native/target/aarch64-linux-android/release/touch-listener

# 仅用于 x86_64 模拟器隔离验证的测试二进制（不会进入发布 ZIP）
rustup target add x86_64-linux-android
ANDROID_NDK_HOME=/path/to/ndk bash tools/build_native.sh --target x86_64
```

打包脚本默认使用 Python 3，可用 `COLOROS_PYTHON` 指定解释器。默认以 `HEAD` 的模块内容打包，`--worktree` 读取本地改动。产物写入 `dist/`，发送前会逐一核查 ZIP 文件清单及可执行权限。发布时更新 `module.prop` 中的版本和版本号，在 Actions 手动运行 Draft module release，检查两个产物再发布草稿。

在 Android 模拟器中运行 `tools/verify_on_device.sh` 时，把脚本、`tools/event_fixtures.tsv` 和 `_unpacked` 内容分别推到新建的 `/data/local/tmp/coloros-verify.*` 目录与该目录下的 `module/`。脚本用临时目录和 mock 触控命令测试迁移、热加载、息屏、断流、孤儿回收及停用清理。当 `module/bin/touch-listener` 存在时，脚本会设置仅测试用的 `COLOROS_NATIVE_ABI_OK=1`，让 x86_64 模拟器也能选中 Rust 后端；发布 ZIP 仍只接受 arm64 Android ELF。`tools/measure_listener.sh` 用同一套隔离环境输出 Shell/Rust 的相对 CPU、唤醒和调用次数，模拟器数据只用于判断方向。

```sh
# 设备端隔离度量（Rust 测试二进制需先放入 module/bin/）
adb shell "cd /data/local/tmp/coloros-measure.XXXX && /system/bin/sh measure_listener.sh 3"
```

## 真机功耗与兼容性验收

在同一台 ColorOS 手机上对比模块关闭、2.5.2、2.6 Shell 和 2.6 Rust。先让各组使用同一触控档位以衡量监听成本，再启用正常规则，验证真实使用时的触控和整机耗电。分别记录亮屏静置、定时切换应用和息屏静置三组场景。测试时拔掉充电线，保持亮度、刷新率、网络和交互脚本一致，交错重复各组。

用 Perfetto 记录模块进程及其子进程的 CPU 时间、调度唤醒和进程启动。核对 `dumpsys` 次数、HAL 调用和前台切换时延。电量使用设备可读的电量计或功耗轨。另测分屏、悬浮窗、锁屏/AOD、监听中断和长时间息屏。只有同等正确性和切换时延下 Rust 的进程 CPU 时间或唤醒次数相对 2.6 Shell 改善至少 20%，且超出重复测试波动，才考虑改为默认后端。
