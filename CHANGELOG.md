# Changelog

## 1.0.0 — 2026-11-22

首个正式版本。

- 提供两个独立安装包：`-shell.zip` 固定使用 Shell 后端，`-rust-arm64.zip` 固定使用 Rust 后端（仅 `arm64-v8a`）。
- Shell 事件监听：logcat 事件、焦点查询、亮屏校准、息屏暂停。
- Rust 后端读取、识别和合并事件；启动失败时保持 Rust 后端并重试，不回退 Shell，原因显示在诊断页。
- WebUI：概览、规则编辑、诊断、应用名称映射和全局档位。
- KernelSU / Magisk 安装 ZIP，以及 GitHub Actions 草稿发布工作流。
- 版本号从内部开发版 2.6.1 重置为 1.0.0；从旧内部版本升级前请先备份配置。

维护者：FIOIU8 · 许可证：MIT
