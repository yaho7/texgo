# Texgo

[English](README.md)

面向 Windows、macOS 和 Linux 的本地 LaTeX 图片工作台，使用 Tauri 2、Rust、React 和 shadcn/ui。安装一个应用即可同时获得图形界面和独立的 `texgo-engine` CLI/JSON-RPC 引擎；项目文件不会上传到服务器。

## 下载

从 [GitHub Releases](https://github.com/yaho7/texgo/releases/latest) 下载对应平台的安装包。

macOS 最低要求为 13.3，PDF 预览还需要 Safari 18+ 对应的 WebKit。Windows 安装包未签名，macOS 为临时签名且未公证；详细说明见[平台要求和签名](docs/desktop-release.md)。

## 使用流程

1. 打开 `.tex` 主文件，自动识别子文件和图片引用；也可独立选择图片目录进行预转换。
2. 选择图片；需要调整时展开输出设置，选择预设或自定义 DPI、质量和目录。
3. 转换为同名 PDF，保留原图片和相对目录结构。
4. 并排对比原图与 PDF，检查引用变更，选择需要更新的引用后再确认。
5. 在转换记录中一次撤销本批次的引用和 PDF，或从侧栏快速切换项目。

图片变化在后台自动检测。“检查应用更新”查询 GitHub 发行版，与图片检测独立。重新扫描、添加目录等低频操作位于菜单中；缺失或歧义图片可定位文件，审核后修复引用。

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
