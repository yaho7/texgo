# Texgo

[English](README.md)

面向 Windows、macOS 和 Linux 的本地 LaTeX 项目图片维护工具，使用 Tauri 2、Rust、React 和 shadcn/ui。安装一个应用即可同时获得图形界面和独立的 `texgo-engine` CLI/JSON-RPC 引擎；项目文件不会上传到服务器。

## 下载

从 [GitHub Releases](https://github.com/yaho7/texgo/releases/latest) 下载对应平台的安装包。

macOS 最低要求为 13.3，PDF 预览还需要 Safari 18+ 对应的 WebKit。Windows 安装包未签名，macOS 使用 Developer ID 正式签名并经过 Apple 公证；详细说明见[平台要求和签名](docs/desktop-release.md)。

## 使用流程

1. 打开或拖入 LaTeX 的 `.tex` 主文件，自动识别子文件和图片引用。
2. 按底部推荐操作维护项目：审核引用、更新图片、处理问题，或确认项目已是最新。
3. 默认更新全部待处理图片；需要部分处理时进入临时选择模式，按 Esc 退出。预设、DPI、质量和输出目录收纳在底部参数弹层中。
4. 使用覆盖式对比：原图在左，PDF 在右。转换引起的引用变化会自动打开审核，可按文件或逐条选择后确认；同路径 PDF 更新不重复审核。
5. 从侧栏切换“图片”和“操作记录”。操作记录提供统一撤销，恢复引用和 PDF，保留源图片。

图片变化在后台自动检测，刷新保留当前图片、搜索、筛选和对比位置。普通问题在“问题”筛选和当前图片信息中处理，只有安全阻塞才显示顶部提示。项目菜单中的“关闭当前项目”会明确关闭项目；切换到设置或操作记录不会中断后台维护。

图片转换不需要 GraphicsMagick 或 TeX。质量 100 使用无损图像编码，DPI 不会放大原图。需要编译文档时，本机还需安装 TeX 发行版和 `latexmk`。

## 开发者接入

内置引擎可在桌面应用未运行时独立调用，支持版本化 JSON 配置和标准输入输出上的 JSON-RPC。可以接入 VS Code、LaTeX Workshop 或其他编辑器，完成扫描、转换、编译及自动监听，无需再安装第二套工具。

- [CLI 与 API 文档](docs/api.md)
- [JSON 配置定义](docs/project.schema.json)
- [VS Code 接入示例](examples/vscode/)
- [引擎安装路径](docs/desktop-release.md#one-install-gui-and-cli)
- [详细使用说明](desktop/README.zh.md)

## 开发与发布

应用源码位于 `desktop/`。安装开发依赖后，在本地执行无输出静态检查：

```sh
cd desktop
npm run check
```

每次 push 的四个平台全部打包成功后，自动发布到 GitHub Release，main 发布会标记为 Latest，无需手动创建标签。编译、打包与发布交给 GitHub Actions，不在本地执行。见[开发说明](desktop/README.md)和[发布流程](docs/desktop-release.md)。

## 许可证

[MIT](LICENSE)。


### 后台快速转换与设置

侧栏底部的“设置”集中管理默认预设、通知、自动检测、启动与关闭行为。系统级快捷键默认为 macOS `Cmd + Option + Enter`、Windows / Linux `Ctrl + Alt + Enter`，可直接录制新组合或关闭。Smart Convert 和前台共用项目状态：处理待更新图片，已有 PDF 沿用原输出位置；存在待审核引用时优先审核，不自动修改 TeX。

关闭窗口默认保持后台运行，可从托盘打开、快速转换或退出。转换结果通过系统通知提示，点击通知可定位到对应操作记录或问题。Windows 通知点击依赖已安装应用，且系统插件仅报告屏幕上仍可见的 toast 点击；三平台的交付行为以系统通知权限为准。详见[后台工作流与实现说明](docs/background-workflow.md)。
