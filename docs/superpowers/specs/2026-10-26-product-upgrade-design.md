# Texgo 产品升级设计

状态：待用户审阅；本文不是实现完成报告。

## 范围与现状

按用户给定的九个 Phase 顺序实施。现有 Rust Workspace 是项目状态的权威来源；前端消费 `WorkspaceStatus.nextAction`，不另算一套待处理任务。保留 Transaction、Journal、Undo、引用审核、指纹校验、外部修改检测与 symlink 防护。

本轮初步审阅已覆盖 App、CommandBar、Preview、History、Updater、Workspace 入口、桌面命令、后台任务、automation、observation、发布工作流及相关文档和测试。实施前继续完整阅读各阶段涉及模块；不把初步审阅表述为全仓库审计完成。

已确认：

- `App.tsx` 683 行，混合业务操作、对话框、原生事件、轮询和布局状态。
- 前端每 2.5 秒调用 `poll_workspace`；Rust 比较目录元数据快照，变化时全量刷新。快照目前包含 `.texgo`、JSON 和 PDF。
- GUI 操作由 `commands::work` 在工作线程持有 Workspace mutex；文件变更还需要项目文件锁。预览使用独立快照。
- automation 已有 `build_document`，支持 pdfLaTeX、XeLaTeX、LuaLaTeX，默认 XeLaTeX；没有 auto 模式。编译要求已有配置文件。
- 引用审核提交完整 preview 和选择的 ID；执行时再次验证。不能在提交时重建 preview 并冒充用户审核过的内容。
- Rename 回归测试已经覆盖源图、PDF、引用、永久 ignore、Undo、冲突、外部修改和 symlink，补测试应针对缺口而不是重复堆砌。
- 当前 CI 已有 frontend/PDF/Rust verify 和四平台打包；发布文档声称没有测试门禁，已过时。
- main 推送仍会发布 Latest；当前更新功能只检查 GitHub Release 并打开网页。
- 预览已有分隔线键盘操作与双击复位，但 Space 仅切换原图/对比，没有独立 PDF 模式。

## 方案选择

采用逐领域迁移：先建立操作所有权，再逐个抽离 hook，最后改交互。每个单元可独立验证和回滚。

不选择仅把整个 App 移入一个 controller hook：虽然入口变短，但状态所有权仍不清晰。不选择一次性重写为全局 store：会扩大风险，同时改变大量现有行为。保留 React hook、领域状态与 Rust 快照即可。

## Phase 1：Safety

记录当前 checkout 和已有用户修改，运行用户指定的四类基线检查。未通过或未运行的检查分别列明，不能计为通过。

2026-10-26 初始基线：

| 检查 | 结果 |
| --- | --- |
| TypeScript `tsc --noEmit` | 通过 |
| Vitest `run` | 13 个文件、145 项通过 |
| Node PDF test | 1 项通过 |
| `cargo test` | 首次启动失败：shell 无 cargo；正在安装工具链 |

前三项直接使用 Codex 捆绑 Node 执行 package scripts 对应入口；初始 shell 无 npm。原有用户修改为 `desktop/scripts/review-ui.mjs` 与 `desktop/src/styles.css`，不得混入本次提交。

增加针对性测试：旧项目异步响应不能覆盖新项目；后台完成不能挤走前台审核；dialog 阻止应用快捷键；取消/失败后恢复可操作状态；rename 前后保留选择和 ignore；100/500/1000 图片列表分页保持 DOM 有界。

## Phase 2：App architecture

`App.tsx` 负责页面组合、连接 hooks、布局和 dialogs。按依赖逐步提取：

| 模块 | 独占责任 |
| --- | --- |
| `state/operationMachine.ts` | 操作状态、允许的迁移、操作令牌 |
| `hooks/useWorkspace.ts` | 打开/关闭、接纳快照、刷新、recent 和项目代次 |
| `hooks/useAssetSelection.ts` | 搜索、筛选、active、选择及 rename ID 迁移 |
| `hooks/useConversion.ts` | 转换意图、进度、取消、完成反馈 |
| `hooks/useReviewFlow.ts` | 原始审核快照、repair preview、选择应用 |
| `hooks/useHistory.ts` | 读取请求代次、操作记录、Undo |
| `hooks/useDesktopEvents.ts` | 原生订阅生命周期及清理 |
| `hooks/useAppShortcuts.ts` | 快捷键优先级与 dialog/input 边界 |
| `hooks/useBackgroundAutomation.ts` | 后台事件与前台协调、延迟接纳结果 |

业务状态采用 discriminated union：idle、opening、scanning、converting、reviewing、applyingReferences、renaming、undoing、repairing、validating。进行中状态携带操作令牌和 workspace 代次，conversion 携带进度/取消，review 携带原始 preview。不能独立设置 `busy` 和业务 dialog 数据。

UI 保留独立的小状态：页面、sidebar、drawer、settings、update、selection。完成反馈不是文件操作；其期间延迟自动审核。持有业务操作时原生事件只排队/合并项目快照，按 workspace 代次和操作所有权接纳，不能清除另一项操作。原生层仍串行化文件修改，前端状态机不代替文件安全检查。

## Phase 3：文件观察

Rust `watcher/` 管理 notify watcher 的启动、替换和销毁。打开或切换项目时更换观察实例；关闭项目或关闭自动检测时释放。事件携带 workspace 代次。

连续事件采用 500 ms trailing debounce；保留 30 秒低频元数据 fallback，并在恢复窗口焦点时核对。watcher 初始化失败、错误或事件溢出触发核对，呈现普通 inline 状态，不弹模态框。

不直接忽略所有 PDF：用户外部修改 managed PDF 是安全事件，必须发现。内部写入按路径和预期完成指纹记录；只抑制与预期一致的自写事件。事务结束后做一次核对，保留期间的外部变化。`.texgo` 内部日志/备份写入不驱动循环，但 ignore/config 的外部变更仍需被核对。不可用时间窗口吞掉所有事件。

事件只触发已有 Workspace 刷新服务，不在 watcher 中实现 scanner。第一版保持安全的全量引用解析；没有足够测试前不做增量 TeX 解析。

## Phase 4：Command Bar 与基础交互

左侧显示后端最重要状态，中间一个参数 Popover，右侧一个推荐主操作。转换下拉只保留 pending、选择、当前、全部四种意图。upToDate 时保留低权重“转换…”入口。引用审核优先级不变，不能默认修改 TeX。

补齐列表右键操作并与现有菜单共用动作；Reveal 使用平台正确名称。Preview 增加原图/PDF/对比循环和适应窗口/100%，默认不放大原图。Home 提供简洁用途、打开/拖入和最近项目。顶部提供总图片/待更新/问题/待审核四个计数。

保持分页，所有状态可通过键盘读取和操作；icon button、dialog title/description、aria-live、active row、reduced-motion 逐项检查。沿用中性色和现有布局，不重做 dashboard。

## Phase 5：LaTeX 验证

增加默认关闭的 `validateAfterConversion` 与默认 auto 的引擎选择。将 automation 编译服务扩展为 Desktop/CLI/RPC 共用入口；GUI 不启动独立 shell 编译实现。

auto 不强制覆盖 latexmkrc 的引擎设置；显式 pdfLaTeX/XeLaTeX/LuaLaTeX 才传对应参数。优先使用用户已有合法项目配置；无配置时使用受约束的内存默认配置，不静默改写用户配置。

同路径转换后可验证；有待审核引用时记录“等待引用审核”，用户完成应用后验证最终项目。取消或不应用引用时不能宣称最终项目已验证。记录验证所对应项目代次、批次和时间；后续文件变化令当前验证结果过期。

结果区分通过、编译失败、缺少 latexmk、取消、执行失败。转换成功与编译失败分别表达，不回滚转换。History 展示结果和可打开的日志路径。子进程参数数组调用，设置超时/取消、输出体积约束；沿用输出目录与 symlink 安全检查。日志结果不改变 Undo 文件集合。

## Phase 6：History / Errors / Settings

时间线区分转换、引用应用、rename、验证。保留 Undo 具体阻止原因和可展开文件详情，旧 Journal 新字段需 serde 默认值兼容。rename 摘要从真实结果展示 PDF、引用、ignore 迁移，不凭 UI 猜测。

错误按 status、inline、decision dialog、安全阻塞分层，保留原始技术详情但优先给出文件和恢复动作。结构化日志按 workspace/scanner/conversion/journal/watcher/automation/notification 分类；默认 warn/error，高级设置可启用 debug 和打开日志目录，不记录文件内容。

设置分为常规、转换、自动化、通知、快捷键、高级，保留已有快捷键录制防触发和注册失败回滚。

## Phase 7：Updater / Release

使用 Tauri signed updater：公钥固定到应用配置，私钥仅放 CI Secret，不存仓库或日志。签名或 feed 不可用时安全失败，不能退化成下载后直接执行。下载/安装/重启为明确用户动作；有文件操作或审核时不重启。

main：测试、构建、打包、上传 artifacts，不创建 Latest。`desktop-v<version>-beta.N`：pre-release；`desktop-v<version>`：稳定 Latest。发布前 tag 与 package/Cargo/Tauri 版本必须一致。

增加 `version:check` 同时核对 manifest 与 lockfile。保留 Apple Developer ID、公证、Windows NSIS、Linux deb/AppImage 和两种 macOS 架构。签名密钥配置和跨平台安装升级测试完成前，不宣称更新端到端验收完成。

## Phase 8：VS Code 薄客户端

`extensions/vscode/` 提供 Scan、Update Changed Images、Review References、Open in Texgo 及状态栏。仅调用 engine；process 参数数组、request ID、超时、退出清理和 workspace trust 边界明确。更新仅传后端 pending IDs。

现有 RPC `references.apply` 只有 confirm，不具备桌面完整审核协议；先扩展兼容的 reviewed preview + selected IDs 请求，再实现 extension 确认应用。不能让扩展绕过已审核快照检查。Open in Texgo 需原生打开项目协议，不能假定启动程序就能传入项目。

## Phase 9：公开发布材料

README 中英文采用定位、截图、下载、五步流程、文档链接。真实 Home/Workspace/Compare 截图从确定性 fixture 获取并说明；演示 GIF 5–12 秒，不用合成图冒充实际 UI。

补 CONTRIBUTING、bug/feature issue forms、所需 labels。关闭 issue 前逐条核对复现与修复证据；不能因为标题相关就批量关闭。同步 API/schema、后台流程和发布文档，删除过期的“本地禁止测试”叙述，以本次用户明确允许安装和运行测试为准。

## 验收和提交

每个阶段按功能单元执行：回归测试 → 实现 → focused checks → diff review → scoped commit。阶段结束运行 TypeScript、Vitest、PDF、Rust，并检查条件编译与文档。不自动 push、不发布未验证的版本。

Windows 中文路径/保留名/Explorer/WebView2/通知/托盘，macOS 两种架构/签名/公证/Finder/Dock/Cmd/关闭语义，Linux WebKitGTK/xdg-open/tray 缺失分别需要平台测试；macOS 本机通过不等于三平台通过。

完成报告按 Architecture、UX、Backend、Release、Tests、Files changed、Remaining work 列出实现、证据和边界；真实签名分发、未有设备的系统行为等必须单独标记未验收。
