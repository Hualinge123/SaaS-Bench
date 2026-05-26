# Windows 桌面启动器崩溃日志与启动诊断

## 概述

当前 Windows 桌面端已经落地的能力，不是最早规划里的“installer 日志 + first-launch 日志 + API 结构化 startup-diagnostic 全链路”，而是一个收敛后的版本：

1. 为 C# WebView2 Launcher 增加独立的崩溃日志系统。
2. 在桌面启动阶段补充关键文件和运行时探测。
3. 在启动失败时给用户展示更可读的错误摘要，同时写入崩溃报告。

这份文档是当前实现的主说明，其他设计/计划文档应以这里描述的范围为准。

## 当前已实现范围

### 1. CrashLogger

文件：
- `packaging/windows/desktop/CrashLogger.cs`
- `packaging/windows/desktop/ClowderDesktop.cs`

能力：
- `desktop-launcher.log` 按大小轮转，单文件超过 5MB 自动归档。
- 保留最近 10 个 launcher 日志归档。
- 崩溃时生成 `logs/crash/crash-desktop-*.json` 和 `logs/crash/crash-desktop-*.log`。
- 崩溃报告最多保留 100 组。
- 全部使用 UTF-8 写入，避免中文乱码。

### 2. 全局崩溃捕获

已接入：
- `AppDomain.CurrentDomain.UnhandledException`
- `Application.ThreadException`
- `LauncherForm.InitializeAsync()` 启动失败分支中的手动 `WriteCrashReport(...)`

说明：
- 这套机制主要覆盖 C# 启动器主进程。
- WebView2 渲染进程、Node API、Agent、Redis 仍然主要依赖各自日志；Launcher 只会记录它们的启动输出和退出码。

### 3. 启动阶段诊断

`ClowderDesktop.cs` 当前已增加：
- 启动时检查关键路径是否存在：`start-windows.ps1`、`stop-windows.ps1`、`tools/node/node.exe`、`packages/api/dist/index.js`、`packages/web/server.cjs`、WebView2 相关 DLL、`assets/splash.html` 等。
- 记录 WebView2 Runtime 版本探测结果。
- PowerShell 路径显式解析，优先尝试 `Sysnative` / `System32`。
- WebView2 初始化失败时自动重试。
- 记录本次启动时间，用于判断 `runtime-state.json` 是否是本轮启动更新的。

### 4. 用户可读的启动失败提示

启动失败时，Launcher 会：
- 先写技术日志和崩溃报告。
- 再生成一份用户可读的错误文案。

当前会归纳的几类问题包括：
- 缺少 `start-windows.ps1`
- WebView2 初始化失败
- 本地服务在 UI ready 前退出
- 等待前端超时
- 本地服务进程未成功拉起

## 当前未实现范围

下面这些曾经出现在早期计划里，但当前代码并没有落地：

- `installer.nsi` 级别的 `logs/install-session.log`
- `scripts/start-windows.ps1` 级别的 `logs/first-launch.log`
- API 侧 `startup-diagnostic.json`
- 根据 `install-session.log` / `first-launch.log` 匹配错误码的完整闭环

所以如果看到旧文档里提到这些文件，应视为“原计划/候选方案”，不是当前事实。

## 日志目录

当前主要目录结构：

```text
logs/
├── desktop-launcher.log
├── desktop-launcher.log.1
├── desktop-launcher.log.2
├── ...
└── crash/
    ├── crash-desktop-2026-04-22T19-30-00.json
    └── crash-desktop-2026-04-22T19-30-00.log
```

相关但不由 CrashLogger 负责的日志：
- `data/logs/api/`
- `data/logs/agent/`

## 崩溃报告内容

每次崩溃报告包含两部分：

### JSON 元数据

示例：

```json
{
  "timestamp": "2026-04-22T11:30:22.123Z",
  "service": "desktop",
  "exception": {
    "type": "System.InvalidOperationException",
    "message": "Timed out waiting for the frontend at http://127.0.0.1:3003/",
    "stackTrace": "..."
  },
  "process": {
    "id": 12345,
    "name": "OfficeClaw",
    "workingSet": 52428800,
    "threads": 8
  },
  "system": {
    "os": "Microsoft Windows NT ...",
    "clr": "4.0.30319.42000",
    "machineName": "WIN-DESKTOP",
    "processorCount": 8
  },
  "context": {
    "phase": "initialization",
    "serviceStartedByLauncher": true,
    "frontendUrl": "http://127.0.0.1:3003/"
  }
}
```

### 日志快照

同名 `.log` 文件是崩溃当时的 `desktop-launcher.log` 快照，方便回看崩溃前最后几十到几百行上下文。

## 进程边界

当前边界如下：

| 组件 | 是否由 CrashLogger 直接捕获 | 主要诊断来源 |
|------|------------------------------|--------------|
| C# Launcher 主进程 | 是 | `desktop-launcher.log` + `logs/crash/*` |
| WebView2 渲染进程 | 否 | WebView2 失败事件 + Launcher 日志 |
| PowerShell 启动脚本 | 否 | Launcher 的 `[start]` / `[start:err]` 输出 |
| API / Agent / Redis | 否 | 各自日志 + Launcher 记录的退出码 |
| 前端 JS 错误 | 否 | 浏览器控制台 / 前端日志 |

## 查看方式

### 脚本

```bash
node scripts/view-crash-logs.mjs
node scripts/view-crash-logs.mjs --latest
node scripts/view-crash-logs.mjs --clean
```

### 手动查看

```powershell
Get-ChildItem logs\crash\crash-*.json | Sort-Object LastWriteTime -Descending
Get-Content logs\desktop-launcher.log -Tail 100
```

## 相关文件

核心代码：
- `packaging/windows/desktop/ClowderDesktop.cs`
- `packaging/windows/desktop/CrashLogger.cs`
- `scripts/build-windows-webview2-launcher.ps1`

辅助脚本：
- `scripts/crash-logger.mjs`
- `scripts/test-crash-logging.mjs`
- `scripts/view-crash-logs.mjs`

## 后续建议

如果后续还要继续补“装不上 / 打不开”的诊断链路，建议按下面顺序推进：

1. 再决定是否真的需要 `installer.nsi` 的安装阶段日志。
2. 再决定是否需要 `start-windows.ps1` 的 first-launch 日志。
3. 如果恢复 API 侧 `startup-diagnostic.json`，一定补 freshness 校验，不要直接相信旧文件。
4. 保持这套桌面端 crash logging 作为最底层兜底，不要被更上层的诊断方案替代掉。
