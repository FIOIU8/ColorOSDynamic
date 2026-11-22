# ColorOS 触控采样率优化

[![Release](https://img.shields.io/github/v/release/FIOIU8/ColorOSDynamic?include_prereleases&label=release)](https://github.com/FIOIU8/ColorOSDynamic/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

按前台应用自动切换 ColorOS 触控采样率档位的 KernelSU / Magisk 模块。模块默认关闭，安装后可在支持 WebUI 的模块管理器中启用。

<p>
  <img src="assets/screenshots/overview.png" width="320" alt="概览页">
  <img src="assets/screenshots/rules.png" width="320" alt="规则页">
</p>

> **非正式版（Unofficial）**
>
> 本项目所有版本均为非正式、实验性版本，可能随时改动或撤回，不保证稳定性。模块会调用厂商触控 HAL 指令并修改系统运行状态，使用前请自行评估风险、备份重要数据，并保留一个已验证的旧版本安装包。
>
> 本项目与 OPPO / ColorOS 官方无关。因使用本模块造成的任何问题由使用者自行承担。

## 功能

- 按前台应用选择触控采样率档位，全局档位可单独设置。
- 默认关闭；开关、规则、映射、应用名称和特殊应用名单在升级时保留。
- WebUI 提供概览、规则编辑、诊断、应用名称映射和高级设置。
- 两种事件后端：默认 Shell 监听；可选 Rust `arm64-v8a` 试验后端，启动失败自动回退 Shell。
- 息屏、锁屏或无法确认前台时回到全局档位并暂停前台查询。
- 模块不申请网络权限，也不访问互联网。

## 前置条件

- ColorOS 13+ / Android 13+。
- 已 root，并安装 KernelSU 或 Magisk；建议使用支持 WebUI 的管理器。
- Rust 试验包仅支持 `arm64-v8a`，其他设备请使用默认 Shell 包。

## 安装

1. 从 [Releases](https://github.com/FIOIU8/ColorOSDynamic/releases) 下载安装 ZIP：
   - `ColorOSDynamic-vX.Y.Z.zip`：使用 Shell 事件监听，建议日常使用。
   - `ColorOSDynamic-vX.Y.Z-rust-arm64-experimental.zip`：额外包含 Rust 试验后端，默认仍使用 Shell。
2. 在 KernelSU / Magisk 管理器中安装 ZIP 并重启。
3. 打开模块 WebUI，在概览页启用模块。
4. 在「规则」页添加应用与目标档位，或在「高级设置」中选择 Shell / Rust 后端。

Rust 后端只在 WebUI「规则 → 高级设置」中主动选择后生效；启动失败会切回 Shell，原因显示在「诊断」页。

### 升级

直接在管理器中安装新 ZIP，开关、规则、映射和应用名称会保留。旧观察器模式会自动迁移为名单轮询。跨大版本升级前建议先导出或备份配置。

### 卸载

在模块管理器中卸载并重启。卸载脚本会先停用服务，然后由管理器移除模块文件。

## 使用说明

- WebUI 的「最近成功下发」表示厂商指令返回成功；模块无法读取硬件当前实际频率。
- 部分游戏的游戏助手边缘滑动可能受触控档位影响，遇到问题请先在 WebUI 中停用对应规则并反馈。
- 诊断页可查看服务状态、当前前台应用、监听方式和最近日志。

## 监听与息屏

两个后端订阅同一组 `logcat` 事件，使用相同的规则和硬件命令。事件明确时直接更新前台，焦点不明时查询系统。亮屏期间每 60 秒校准一次，名单应用可配置更短间隔。确认息屏后回到全局档并暂停前台查询。若本次事件连接已确认亮屏和息屏事件，息屏期间阻塞等待；无法确认事件覆盖的设备会继续低频检查电源状态。

服务只在状态变化时发布状态，没有周期心跳。Shell 负责配置、状态、规则和 HAL 调用。Rust 试验包替换事件读取、识别和合并部分，因此两版的测试可以区分监听器差异。WebUI 的定时刷新只在可见的概览页工作，日志按需读取。

## 开发与打包

```sh
node --test tools/test_rate_layout.js
cargo fmt --manifest-path native/Cargo.toml -- --check
cargo clippy --locked --all-targets --manifest-path native/Cargo.toml -- -D warnings
cargo test --locked --manifest-path native/Cargo.toml
bash tools/package_module.sh --worktree
```

打包脚本默认使用 Python 3；Windows 上会自动回退到 `python`，也可以用 `COLOROS_PYTHON` 指定解释器。默认以 `HEAD` 的模块内容打包，`--worktree` 读取本地改动。产物写入 `dist/`，发送前会逐一核查 ZIP 文件清单及可执行权限。

构建 Rust 试验包需要 NDK 和对应 Rust target：

```sh
rustup target add aarch64-linux-android
ANDROID_NDK_HOME=/path/to/ndk bash tools/build_native.sh
bash tools/package_module.sh --worktree --experimental native/target/aarch64-linux-android/release/touch-listener
```

仅用于 x86_64 模拟器隔离验证的测试二进制（不会进入发布 ZIP）：

```sh
rustup target add x86_64-linux-android
ANDROID_NDK_HOME=/path/to/ndk bash tools/build_native.sh --target x86_64
```

WebUI 交互测试需要本机安装 Playwright：

```sh
npm i playwright
node tools/test_webui.js
```

在 Android 模拟器中运行 `tools/verify_on_device.sh` 时，把脚本、`tools/event_fixtures.tsv` 和仓库 `module/` 目录的内容分别推到新建的 `/data/local/tmp/coloros-verify.*` 目录与该目录下的 `module/`。脚本用临时目录和 mock 触控命令测试迁移、热加载、息屏、断流、孤儿回收及停用清理。当 `module/bin/touch-listener` 存在时，脚本会设置仅测试用的 `COLOROS_NATIVE_ABI_OK=1`，让 x86_64 模拟器也能选中 Rust 后端；发布 ZIP 仍只接受 arm64 Android ELF。`tools/measure_listener.sh` 用同一套隔离环境输出 Shell/Rust 的相对 CPU、唤醒和调用次数，模拟器数据只用于判断方向。

```sh
# 设备端隔离度量（Rust 测试二进制需先放入 module/bin/）
adb shell "cd /data/local/tmp/coloros-measure.XXXX && /system/bin/sh measure_listener.sh 3"
```

## 发布流程

1. 更新 `module/module.prop` 中的 `version` 与 `versionCode`。
2. 在 Actions 手动运行 **Draft module release**。
3. 检查工作流生成的两个 ZIP，然后发布草稿。

工作流会先运行脚本语法检查、Node 测试和 cargo fmt/clippy/test，再构建 arm64 Rust 监听器并创建草稿 Release。

## 真机功耗与兼容性验收

在同一台 ColorOS 手机上对比模块关闭、1.0.0 Shell 和 1.0.0 Rust。先让各组使用同一触控档位以衡量监听成本，再启用正常规则，验证真实使用时的触控和整机耗电。分别记录亮屏静置、定时切换应用和息屏静置三组场景。测试时拔掉充电线，保持亮度、刷新率、网络和交互脚本一致，交错重复各组。

用 Perfetto 记录模块进程及其子进程的 CPU 时间、调度唤醒和进程启动。核对 `dumpsys` 次数、HAL 调用和前台切换时延。电量使用设备可读的电量计或功耗轨。另测分屏、悬浮窗、锁屏/AOD、监听中断和长时间息屏。只有同等正确性和切换时延下 Rust 的进程 CPU 时间或唤醒次数相对 Shell 改善至少 20%，且超出重复测试波动，才考虑改为默认后端。

## 反馈

请通过 [GitHub Issues](https://github.com/FIOIU8/ColorOSDynamic/issues) 反馈问题，并附上设备型号、ColorOS 版本、复现步骤和诊断页日志。

## 作者与许可证

作者 / 维护者：**FIOIU8**

本项目使用 [MIT License](LICENSE) 发布。
