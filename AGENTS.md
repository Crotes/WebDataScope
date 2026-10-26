# WebDataScope (WorldQuant Scope)

## 项目概述

WebDataScope（manifest 中的名称为 **WorldQuant Scope**）是一个 Chrome/Edge 浏览器扩展（Manifest V3），为 WorldQuant BRAIN 量化研究平台（`platform.worldquantbrain.com` 及其支持论坛 `support.worldquantbrain.com`）提供增强工具集。主要功能包括：数据集数据分析与标记（`dataAna.js` / `dataFlag.js`）、Genius 排名与运算符使用分析（`genius.js`）、论坛批量点赞（`voteup.js`）、Alpha 详情弹窗（`alphaDetailsPopup.js`）、API 请求监控（`requestMonitorUI.js`）等。

- 参考项目：[BiliScope](https://github.com/gaogaotiantian/biliscope)
- 仓库：`zhangkaihua88/WebDataScope`
- 版本号记录在 `manifest.json` 的 `version` 字段（当前为 0.10.x）。

## 技术栈

- **纯原生 JavaScript + HTML + CSS**，无构建步骤、无打包器、无框架。
- **没有 `package.json`、`pyproject.toml` 等配置文件，没有 npm 依赖、没有 lint/格式化配置、没有测试套件**。
- 第三方库以压缩后的文件形式直接放在 `src/scripts/lib/`（jQuery 3.7、DataTables、Chart.js、jszip、pako、msgpack），通过 manifest 的 `content_scripts` 或 `<script>` 标签加载，不是 npm 管理。
- 后台脚本 `src/scripts/background.js` 是 MV3 Service Worker（`"type": "module"`），以副作用 `import` 方式加载 UMD 库（pako/msgpack 挂到 `globalThis`）。

## 目录结构

- `manifest.json` — 扩展清单（MV3），声明 content scripts、权限、web accessible resources。**这是唯一的“构建配置”**。
- `src/scripts/` — 主要逻辑脚本；`src/scripts/lib/` 为第三方库。
- `src/html/popup/` — 浏览器工具栏 popup（设置界面）；`src/html/WQScope.html` 为独立的 Database Tools 页面。
- `src/css/` — 各页面样式（idcard、menu、genius、simulate、distribution 等，含 DataTables 的库样式）。
- `data/` — 随扩展打包的预计算数据（见下节）；`data/oth/` 存放 `info_data.bin` 等通用数据。
- `img/` — 扩展图标。
- `.github/workflows/release-on-version-change.yml` — 发布流水线。

## 数据文件（`data/*.bin`）

- `.bin` 文件是按 **`<数据集ID>_<地区>_<宇宙>_Delay<N>.bin`** 命名的预计算数据分析结果（如 `analyst11_EUR_TOP1200_Delay1.bin`），共 150+ 个。
- 编码方式：**pako 压缩 + MessagePack 序列化**。读取模式为 `pako.inflate(arrayBuffer)` → `msgpack.decode(...)`（见 `src/content/platform/data/dataAna.js`）。
- `data/dataSetList.json` 是所有可用 `.bin` 数据文件名的清单（不带扩展名）。
- 运行时可手动导入 `WebData.zip`，由 `src/shared/dataStore.js` 写入 IndexedDB；手动导入的数据优先。
- IndexedDB 中缺少对应文件或 info 分片时，`src/background/services/extensionDataService.js` 用 `chrome.runtime.getURL(...)` + `fetch` 回退读取扩展内置 `data/`，content scripts 不直接读取这些文件。
- `data/` 已纳入 Git 版本控制，新增或修改的数据文件应随代码提交。

## 代码组织与运行时架构

- **`background.js`**：Service Worker。负责安装时初始化默认设置（`WQPSettings`）、每日检查 GitHub 更新（仓库 `zhangkaihua88/WebDataScope`，24 小时间隔）、标签页监听、API 请求监控（内存中仅保留最近 200 条会话级记录）、动态注入脚本。
- **content scripts**（按 `manifest.json` 分组注入不同页面）：
  - `platform.worldquantbrain.com/*`（排除 `/genius/*`）：`utils.js`、`uiCard.js`、`dataAna.js`、`noMoreDifficulties.js`、`requestMonitorUI.js` + pako/msgpack/chart.js。
  - `patchColumns.js` 以 `world: "MAIN"`、`document_start` 运行，修补平台页面的列。
  - `performanceStyleFix.js`、`alphaDetailsPopup.js` 针对特定路径。
  - `support.worldquantbrain.com/*`：`voteup.js`（论坛点赞）。
  - 部分脚本（`genius.js`、`dataFlag.js`、`simulate.js`、`distribution.js`、`search.js`）不在 manifest 中静态声明，由 `background.js` 通过 `chrome.scripting` 按需动态注入。
- **跨脚本共享全局**：脚本不是模块，靠全局函数/变量互通；为防止重复注入报错，共享变量用 `var x = x || ...` 的防御写法（见 `dataFlag.js` 开头）。新代码应沿用这一惯例。
- **持久化**：`chrome.storage.local` 存放设置与缓存（键如 `WQPSettings`、`WQPOPSAna`、`WQPRankData`、`WQPAllAlphasCache`、`WQPLikedIds`）；`dataFlag.js` 另用 IndexedDB（库 `WQP_Data_Cache`，store `dataInfo`）缓存数据字段信息。

## 构建、测试与部署

- **无构建命令**。开发调试：在 `chrome://extensions` 开启开发者模式，“加载已解压的扩展程序”选择本仓库根目录；改代码后在扩展页点刷新。
- **无自动化测试、无 CI 检查**。验证方式是手动在 WorldQuant BRAIN 平台页面上操作对应功能。
- **发布流程**：向 `master` 推送 `manifest.json` 的改动会触发 `.github/workflows/release-on-version-change.yml`：用 `jq` 读取 `manifest.json` 的 `version`，若与最新 tag 不同则创建同名 tag 并发布 GitHub Release。**因此发版本只需修改 `manifest.json` 的 `version` 并推送**。注意 workflow 中比较用的是 `v$VERSION` 而实际打 tag 时不带 `v` 前缀，这是已有行为，勿擅自“修复”。

## 代码风格约定

- 代码注释与文档**以中文为主**；新代码的注释也应使用中文。
- 每个脚本文件开头有一行注释说明用途，格式为 `// 文件名: 功能描述`，随后 `console.log('<文件名> loaded')`。
- 文件内用 `// ############################## 分节标题 ##############################` 划分功能区块。
- 原生 DOM 操作为主，jQuery 仅在已加载的页面使用；异步一律 `async/await`。
- 与平台 API 交互的基地址：`https://api.worldquantbrain.com`；另有一个可配置的后端 `https://wq-backend.vercel.app`（存于 `WQPSettings.apiAddress`）。

## 安全注意事项

- 扩展申请了较宽的权限（`cookies`、`webRequest`、`declarativeNetRequest`、`https://*/*` 等），改动涉及网络请求拦截的代码（`background.js`）时要格外谨慎。
- `background.js` 中有 `EXCLUDED_PREFIXES` 列表排除敏感 API 前缀，避免记录；新增请求监控时保持这一排除机制。
- 凭据/会话依赖用户浏览器中已登录的 WorldQuant 账号（通过 `cookies` 权限），**不要在代码中硬编码任何 token 或凭据**。
- 不要改动 `data/*.bin` 的编码格式（pako+msgpack），除非同步更新所有解码方（`dataAna.js`、`dataFlag.js`）。
