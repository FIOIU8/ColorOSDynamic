# ColorOS 触控采样率优化

## 安装

在 GitHub Releases 的 **Assets** 下载 `ColorOSDynamic-vX.Y.Z.zip`。保持 ZIP 原样，在 KernelSU 或 Magisk 管理器里选择本地模块安装，按提示重启。不要下载 **Source code (zip)**，那是仓库源码，不是安装包。模块默认不启用触控优化，安装后可在支持 WebUI 的管理器里开启。

## 发布草稿

1. 在 `_unpacked/module.prop` 更新 `version`（`X.Y.Z`），并递增 `versionCode`，然后提交并推送。首次设置时，包含发布工作流的分支需要成为 GitHub 仓库的默认分支。
2. 打开 **Actions → Draft module release → Run workflow**，选择要发布的分支并运行。工作流会从该提交打包，并在 **Releases** 创建 `vX.Y.Z` 草稿、附加安装 ZIP；不会自动公开。
3. 检查草稿的说明与 **Assets**，确认后手动点击 **Publish release**。已有同名草稿、正式版本或标签时，工作流会停止，不会覆盖。

本地可用 Git Bash 运行 `bash tools/package_module.sh`（需 `git` 和 `unzip`）。它只读取已提交到 `HEAD` 的模块文件，输出到 `dist/`。本地 `docs/`、旧安装包和生成的 ZIP 均不提交。
