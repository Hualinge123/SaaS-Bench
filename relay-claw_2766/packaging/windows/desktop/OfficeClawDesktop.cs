using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Speech.Recognition;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{[DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetProcessDPIAware();[DllImport("shcore.dll", SetLastError = true)]
    private static extern int SetProcessDpiAwareness(int awareness);

    private const string InstanceMutexName = @"Local\OfficeClaw.WebView2Desktop";
    private const string ActivationEventName = @"Local\OfficeClaw.WebView2Desktop.Activate";
    private const string ActivationPayloadFileName = "officeclaw-toast-activation.txt";
    internal const string OAuthCallbackActivationPrefixForNavigation = "__oauth_callback__";

    private static void OnUnhandledException(object sender, UnhandledExceptionEventArgs e)
    {
        try
        {
            var exception = e.ExceptionObject as Exception;
            if (exception != null)
            {
                var projectRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                var crashLogger = new CrashLogger(projectRoot);
                var context = new System.Collections.Generic.Dictionary<string, object>();
                context.Add("isTerminating", e.IsTerminating);
                context.Add("source", "AppDomain.UnhandledException");
                crashLogger.WriteCrashReport(exception, context);
                crashLogger.AppendLog("FATAL: Unhandled exception - " + exception.Message);
            }
        }
        catch
        {
            // 最后的防线，避免崩溃报告本身导致崩溃
        }
    }

    private static void OnThreadException(object sender, System.Threading.ThreadExceptionEventArgs e)
    {
        try
        {
            var projectRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var crashLogger = new CrashLogger(projectRoot);
            var context = new System.Collections.Generic.Dictionary<string, object>();
            context.Add("source", "Application.ThreadException");
            crashLogger.WriteCrashReport(e.Exception, context);
            crashLogger.AppendLog("ERROR: Thread exception - " + e.Exception.Message);
        }
        catch
        {
            // 最后的防线
        }
    }

    private static void EnableHighDpi()
    {
        try
        {
            // PROCESS_PER_MONITOR_DPI_AWARE = 2
            SetProcessDpiAwareness(2);
        }
        catch
        {
            // Fallback for Windows 7 / early Win8
            try { SetProcessDPIAware(); } catch { }
        }
    }

    [STAThread]
    private static void Main()
    {
        // 注册全局未处理异常处理器
        AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
        Application.ThreadException += OnThreadException;

        EnableHighDpi();
        var initialActivationThreadId = ExtractActivationThreadId(Environment.GetCommandLineArgs());

        EventWaitHandle activationEvent;
        try
        {
            activationEvent = EventWaitHandle.OpenExisting(ActivationEventName);
        }
        catch (WaitHandleCannotBeOpenedException)
        {
            activationEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ActivationEventName);
        }

        using (activationEvent)
        {
            bool createdNew;
            using (var mutex = new Mutex(true, InstanceMutexName, out createdNew))
            {
                if (!createdNew)
                {
                    WriteActivationPayload(initialActivationThreadId);
                    activationEvent.Set();
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new LauncherForm(activationEvent, initialActivationThreadId));
            }
        }
    }

    internal static string GetActivationPayloadPath()
    {
        return Path.Combine(Path.GetTempPath(), ActivationPayloadFileName);
    }

    private static string ExtractActivationThreadId(string[] args)
    {
        if (args == null) return null;
        foreach (var arg in args)
        {
            if (string.IsNullOrWhiteSpace(arg)) continue;
            Uri uri;
            if (!Uri.TryCreate(arg, UriKind.Absolute, out uri)) continue;
            if (!string.Equals(uri.Scheme, "officeclaw", StringComparison.OrdinalIgnoreCase)) continue;

            var oauthCallback = ExtractOAuthCallbackActivationTarget(uri);
            if (!string.IsNullOrWhiteSpace(oauthCallback)) return oauthCallback;

            var query = uri.Query;
            if (string.IsNullOrWhiteSpace(query)) return null;
            var match = Regex.Match(query, "(?:^|[?&])threadId=([^&]*)");
            if (!match.Success) return null;
            return Uri.UnescapeDataString(match.Groups[1].Value.Replace("+", " "));
        }
        return null;
    }

    private static string ExtractOAuthCallbackActivationTarget(Uri uri)
    {
        if (!string.Equals(uri.Host, "oauth", StringComparison.OrdinalIgnoreCase)) return null;
        if (!string.Equals(uri.AbsolutePath, "/callback", StringComparison.OrdinalIgnoreCase)) return null;

        var error = ExtractQueryValue(uri.Query, "error");
        if (!string.IsNullOrWhiteSpace(error))
        {
            return OAuthCallbackActivationPrefixForNavigation + "?error=" + Uri.EscapeDataString(error);
        }

        var code = ExtractQueryValue(uri.Query, "code");
        var state = ExtractQueryValue(uri.Query, "state");
        if (!string.IsNullOrWhiteSpace(code) && !string.IsNullOrWhiteSpace(state))
        {
            return OAuthCallbackActivationPrefixForNavigation +
                   "?code=" + Uri.EscapeDataString(code) +
                   "&state=" + Uri.EscapeDataString(state);
        }

        if (HasQueryKey(uri.Query, "code") || HasQueryKey(uri.Query, "state"))
        {
            return OAuthCallbackActivationPrefixForNavigation + "?error=access_denied";
        }

        return null;
    }

    private static string ExtractQueryValue(string query, string key)
    {
        if (string.IsNullOrWhiteSpace(query)) return null;
        var pattern = "(?:^|[?&])" + Regex.Escape(key) + "=([^&]*)";
        var match = Regex.Match(query, pattern, RegexOptions.IgnoreCase);
        if (!match.Success) return null;
        return Uri.UnescapeDataString(match.Groups[1].Value.Replace("+", " ")).Trim();
    }

    private static bool HasQueryKey(string query, string key)
    {
        if (string.IsNullOrWhiteSpace(query)) return false;
        var pattern = "(?:^|[?&])" + Regex.Escape(key) + "(?:=|&|$)";
        return Regex.IsMatch(query, pattern, RegexOptions.IgnoreCase);
    }

    private static void WriteActivationPayload(string threadId)
    {
        if (string.IsNullOrWhiteSpace(threadId)) return;
        try
        {
            File.WriteAllText(GetActivationPayloadPath(), threadId, Encoding.UTF8);
        }
        catch
        {
            // Best-effort handoff; the activation event still restores the app.
        }
    }
}

internal sealed class LauncherForm : Form, IMessageFilter
{
    // =========================================================
    // API Imports & Constants
    // =========================================================
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);[DllImport("user32.dll")]
    private static extern bool SetWindowPlacement(IntPtr hWnd, [In] ref WINDOWPLACEMENT lpwndpl);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appID);

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PROPVARIANT pvar);

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern int SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);

    // DWM API 用于恢复系统边框阴影
    [DllImport("dwmapi.dll")]
    private static extern int DwmExtendFrameIntoClientArea(IntPtr hWnd, ref MARGINS pMarInset);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int dwAttribute, ref int pvAttribute, int cbAttribute);

    // kernel32 API 用于防休眠
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint SetThreadExecutionState(uint esFlags);

    // 防休眠常量
    private const uint ES_CONTINUOUS = 0x80000000;
    private const uint ES_SYSTEM_REQUIRED = 0x00000001;
    private const uint ES_DISPLAY_REQUIRED = 0x00000002;

    // 防休眠状态
    private bool _preventSleepEnabled = false;

    // 配置文件路径
    private string GetPreventSleepConfigPath()
    {
        // ~/.jiuwenclaw/config/config.yaml
        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        return Path.Combine(userProfile, ".jiuwenclaw", "config", "config.yaml");
    }

    // 读取 preventSleep.enabled
    private bool ReadPreventSleepEnabled()
    {
        var configPath = GetPreventSleepConfigPath();
        if (!File.Exists(configPath))
        {
            return false;
        }

        try
        {
            var content = File.ReadAllText(configPath);
            // 简单解析 YAML: 查找 "preventSleep:" 然后 "enabled: true/false"
            var lines = content.Split('\n');
            bool inPreventSleepSection = false;
            foreach (var line in lines)
            {
                var trimmed = line.Trim();
                if (trimmed.StartsWith("#", StringComparison.Ordinal))
                {
                    continue;
                }
                if (trimmed == "preventSleep:" || trimmed.StartsWith("preventSleep:", StringComparison.Ordinal))
                {
                    inPreventSleepSection = true;
                    continue;
                }
                if (inPreventSleepSection)
                {
                    if (trimmed.StartsWith("enabled:", StringComparison.Ordinal))
                    {
                        var value = trimmed.Substring("enabled:".Length).Trim().ToLowerInvariant();
                        return value == "true" || value == "1" || value == "yes";
                    }
                    // 如果遇到其他顶级 key，说明已经出了 preventSleep section
                    if (!trimmed.StartsWith("-", StringComparison.Ordinal) && !trimmed.StartsWith("#", StringComparison.Ordinal) && trimmed.Contains(":") && !trimmed.StartsWith("enabled:", StringComparison.Ordinal))
                    {
                        inPreventSleepSection = false;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            AppendLog("Failed reading preventSleep config: " + ex.Message);
        }

        return false;
    }

    private static bool IsSupportDevToolsEnabled()
    {
        var value = Environment.GetEnvironmentVariable("SUPPORT_DEV_TOOLS");
        if (value == null) return false;
        var normalized = value.Trim().ToLowerInvariant();
        return normalized == "1" || normalized == "true";
    }

    // 写入 preventSleep.enabled
    private void WritePreventSleepEnabled(bool enabled)
    {
        var configPath = GetPreventSleepConfigPath();
        try
        {
            // 确保目录存在
            var dir = Path.GetDirectoryName(configPath);
            if (dir != null && !Directory.Exists(dir))
            {
                Directory.CreateDirectory(dir);
            }

            // 如果文件不存在，创建新的
            if (!File.Exists(configPath))
            {
                var defaultContent = "preventSleep:\n  enabled: " + (enabled ? "true" : "false") + "\n";
                File.WriteAllText(configPath, defaultContent);
                AppendLog("Created preventSleep config file with enabled=" + enabled);
                return;
            }

            // 读取并修改现有文件
            var content = File.ReadAllText(configPath);
            var lines = content.Split('\n');
            var newLines = new List<string>();
            bool inPreventSleepSection = false;
            bool foundAndUpdated = false;

            for (int i = 0; i < lines.Length; i++)
            {
                var line = lines[i];
                var trimmed = line.Trim();

                if (trimmed == "preventSleep:" || trimmed.StartsWith("preventSleep:", StringComparison.Ordinal))
                {
                    inPreventSleepSection = true;
                    newLines.Add(line);
                    continue;
                }

                if (inPreventSleepSection && !foundAndUpdated)
                {
                    if (trimmed.StartsWith("enabled:", StringComparison.Ordinal))
                    {
                        // 替换 enabled 行，保持原有缩进
                        var indent = line.Substring(0, line.IndexOf("enabled", StringComparison.Ordinal));
                        newLines.Add(indent + "enabled: " + (enabled ? "true" : "false"));
                        foundAndUpdated = true;
                        continue;
                    }
                    // 遇到其他顶级 key，说明没有找到 enabled，需要添加
                    if (!trimmed.StartsWith("-", StringComparison.Ordinal) && !trimmed.StartsWith("#", StringComparison.Ordinal) && trimmed.Contains(":") && !trimmed.StartsWith("enabled:", StringComparison.Ordinal))
                    {
                        // 在 preventSleep section 后添加 enabled 行
                        if (!foundAndUpdated)
                        {
                            newLines.Add("  enabled: " + (enabled ? "true" : "false"));
                            foundAndUpdated = true;
                        }
                        inPreventSleepSection = false;
                    }
                }

                newLines.Add(line);
            }

            // 如果 preventSleep section 存在但没有 enabled，添加到末尾
            if (inPreventSleepSection && !foundAndUpdated)
            {
                newLines.Add("  enabled: " + (enabled ? "true" : "false"));
                foundAndUpdated = true;
            }

            // 如果整个文件都没有 preventSleep section，添加到末尾
            if (!foundAndUpdated)
            {
                newLines.Add("");
                newLines.Add("preventSleep:");
                newLines.Add("  enabled: " + (enabled ? "true" : "false"));
            }

            File.WriteAllText(configPath, string.Join("\n", newLines));
            AppendLog("Updated preventSleep config: enabled=" + enabled);
        }
        catch (Exception ex)
        {
            AppendLog("Failed writing preventSleep config: " + ex.Message);
        }
    }

    /// <summary>
    /// 启动时从配置文件恢复防休眠设置。
    /// </summary>
    private void RestorePreventSleepFromConfig()
    {
        try
        {
            var enabled = ReadPreventSleepEnabled();
            if (enabled)
            {
                EnablePreventSleep();
                AppendLog("Restored prevent sleep setting from config: enabled");
            }
        }
        catch (Exception ex)
        {
            AppendLog("Failed to restore prevent sleep setting: " + ex.Message);
        }
    }

    // User32 API 用于获取显示器工作区（防最大化遮挡任务栏）
    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [DllImport("user32.dll")]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    private static extern IntPtr SetCursor(IntPtr hCursor);

    [DllImport("user32.dll")]
    private static extern bool ScreenToClient(IntPtr hWnd, ref POINT lpPoint);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    private const int VK_LBUTTON = 0x01;

    [DllImport("user32.dll")]
    private static extern IntPtr LoadCursor(IntPtr hInstance, int lpCursorName);

    [DllImport("user32.dll")]
    private static extern bool FlashWindowEx(ref FLASHWINFO pwfi);

    private const int SW_RESTORE = 9;
    private const int SW_SHOWMINIMIZED = 2;
    private const int WM_NCLBUTTONDOWN = 0xA1;
    private const int WM_GETMINMAXINFO = 0x0024;
    private const int WM_NCCALCSIZE = 0x0083;
    private const int HTCAPTION = 0x2;
    private const int WM_NCHITTEST = 0x0084;
    private const int WM_SETCURSOR = 0x0020;
    private const int HTLEFT = 10;
    private const int HTRIGHT = 11;
    private const int HTTOP = 12;
    private const int HTTOPLEFT = 13;
    private const int HTTOPRIGHT = 14;
    private const int HTBOTTOM = 15;
    private const int HTBOTTOMLEFT = 16;
    private const int HTBOTTOMRIGHT = 17;
    private const int IDC_SIZEWE = 32644;
    private const int IDC_SIZENS = 32645;
    private const int IDC_SIZENWSE = 32642;
    private const int IDC_SIZENESW = 32643;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int SWP_NOMOVE = 0x0002;
    private const int SWP_NOSIZE = 0x0001;
    private const int SWP_NOZORDER = 0x0004;
    private const int SWP_NOACTIVATE = 0x0010;
    private const int SWP_FRAMECHANGED = 0x0020;
    private const int SM_CXSIZEFRAME = 32;
    private const int SM_CYSIZEFRAME = 33;
    private const int SM_CXPADDEDBORDER = 92;
    private const uint MONITOR_DEFAULTTONEAREST = 2;

    private const string WindowMinimizeMessage = "window.minimize";
    private const string WindowToggleMaximizeMessage = "window.toggleMaximize";
    private const string WindowCloseMessage = "window.close";
    private const string WindowSyncStateMessage = "window.syncState";
    private const string WindowStartDragMessage = "window.startDrag";
    private const string WindowStartResizeMessagePrefix = "window.startResize:";
    private const string WindowStateMessageType = "window.state";
    private const string WindowFlashTaskbarMessage = "window.flashTaskbar";
    private const string WindowStopFlashMessage = "window.stopFlash";
    private const string DesktopCloseActionSyncMessageType = "desktop.closeAction.sync";
    private const string DesktopCloseActionSetMessageType = "desktop.closeAction.set";
    private const string DesktopCloseActionStateMessageType = "desktop.closeAction.state";
    private const int MinimumContentWidthCssPx = 592;
    private const int WebView2InitializationAttempts = 3;
    private const int WebView2InitializationRetryDelayMs = 1500;

    // 防休眠消息常量
    private const string PreventSleepEnableMessage = "preventSleep.enable";
    private const string PreventSleepDisableMessage = "preventSleep.disable";
    private const string PreventSleepSyncStateMessage = "preventSleep.syncState";
    private const string PreventSleepStateMessageType = "preventSleep.state";

    [StructLayout(LayoutKind.Sequential)]
    internal struct TRACKMOUSEEVENT
    {
        public int cbSize;
        public uint dwFlags;
        public IntPtr hwndTrack;
        public uint dwHoverTime;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WINDOWPLACEMENT
    {
        public int length;
        public int flags;
        public int showCmd;
        public POINT ptMinPosition;
        public POINT ptMaxPosition;
        public RECT rcNormalPosition;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MINMAXINFO
    {
        public POINT ptReserved;
        public POINT ptMaxSize;
        public POINT ptMaxPosition;
        public POINT ptMinTrackSize;
        public POINT ptMaxTrackSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MARGINS
    {
        public int cxLeftWidth;
        public int cxRightWidth;
        public int cyTopHeight;
        public int cyBottomHeight;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NCCALCSIZE_PARAMS
    {
        public RECT rcNewWindow;
        public RECT rcOldWindow;
        public RECT rcClient;
        public IntPtr lppos;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FLASHWINFO
    {
        public uint cbSize;
        public IntPtr hwnd;
        public uint dwFlags;
        public uint uCount;
        public uint dwTimeout;
    }

    private const uint FLASHW_ALL = 3;
    private const uint FLASHW_TIMERNOFG = 12;
    private const int ToastProcessTimeoutMs = 4000;
    private const int TrayBalloonFallbackTimeoutMs = 5000;
    private const string ToastAppUserModelId = "OfficeClaw";
    private const string ToastActivationProtocol = "officeclaw";
    private const ushort VT_LPWSTR = 31;

    private static readonly PROPERTYKEY AppUserModelIdPropertyKey = new PROPERTYKEY
    {
        fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
        pid = 5
    };

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct PROPERTYKEY
    {
        public Guid fmtid;
        public uint pid;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROPVARIANT
    {
        public ushort vt;
        public ushort wReserved1;
        public ushort wReserved2;
        public ushort wReserved3;
        public IntPtr p;
    }

    [ComImport]
    [Guid("00021401-0000-0000-C000-000000000046")]
    private class CShellLink
    {
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("000214F9-0000-0000-C000-000000000046")]
    private interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cchMaxPath, IntPtr pfd, uint fFlags);
        void GetIDList(out IntPtr ppidl);
        void SetIDList(IntPtr pidl);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cchMaxName);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cchMaxPath);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cchMaxPath);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
        void GetHotkey(out short pwHotkey);
        void SetHotkey(short wHotkey);
        void GetShowCmd(out int piShowCmd);
        void SetShowCmd(int iShowCmd);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cchIconPath, out int piIcon);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
        void Resolve(IntPtr hwnd, uint fFlags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    private interface IPropertyStore
    {
        void GetCount(out uint cProps);
        void GetAt(uint iProp, out PROPERTYKEY pkey);
        void GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
        void SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
        void Commit();
    }

    private readonly object _logLock = new object();
    private readonly NotifyIcon _notifyIcon;
    private readonly EventWaitHandle _activationEvent;
    private readonly RegisteredWaitHandle _activationWaitHandle;
    private readonly CancellationTokenSource _lifecycleCancellation = new CancellationTokenSource();
    private readonly string _projectRoot;
    private readonly string _logFilePath;
    private readonly string _runtimeStatePath;
    private readonly DateTime _startupStartedAtUtc;
    private readonly string _desktopPrefsPath;
    private readonly CrashLogger _crashLogger;
    private readonly List<string> _serviceOutputTail = new List<string>();
    private const int MaxServiceOutputTailLines = 80;
    private Process _serviceHostProcess;
    private bool _serviceStartedByLauncher;
    private bool _mainWebViewShown;
    private bool _exitRequested;
    private bool _trayHintShown;
    private bool _isHiddenToTray;
    private bool _hasTrayRestorePlacement;
    private WINDOWPLACEMENT _trayRestorePlacement;
    private string _frontendUrl;
    private WebView2 _splashWebView;
    private WebView2 _webView;
    private string _lastDesktopNotificationThreadId;
    private string _pendingActivationThreadId;
    private SpeechRecognitionEngine _speechRecognitionEngine;
    private readonly object _speechLock = new object();
    private string _speechSessionId;
    private readonly StringBuilder _speechFinalBuffer = new StringBuilder();

    public LauncherForm(EventWaitHandle activationEvent, string initialActivationThreadId)
    {
        _activationEvent = activationEvent;
        _activationWaitHandle = ThreadPool.RegisterWaitForSingleObject(
            _activationEvent,
            (_, __) => RestoreFromExternalActivation(),
            null,
            Timeout.Infinite,
            false
        );
        _projectRoot = ResolveProjectRoot();
        _logFilePath = Path.Combine(_projectRoot, "logs", "desktop-launcher.log");
        _runtimeStatePath = Path.Combine(_projectRoot, ".office-claw", "run", "windows", "runtime-state.json");
        _startupStartedAtUtc = DateTime.UtcNow;
        _desktopPrefsPath = Path.Combine(_projectRoot, ".office-claw", "desktop-preferences.json");
        _crashLogger = new CrashLogger(_projectRoot);
        Directory.CreateDirectory(Path.GetDirectoryName(_logFilePath) ?? _projectRoot);
        _frontendUrl = BuildFrontendUrl();

        // [功能 2] 保留任务栏预览窗口的标题和图标
        Text = "OfficeClaw";
        ShowIcon = true;
        // 保持 Sizable 边框类型以保留原生 Resize 与缩放动画
        FormBorderStyle = FormBorderStyle.Sizable;

        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(592, 640);
        ClientSize = new Size(1440, 960);
        WindowState = FormWindowState.Maximized;
        BackColor = Color.FromArgb(255, 248, 242);
        Icon = ResolveAppIcon();
        TrySetToastAppUserModelId();
        EnsureToastIdentityShortcut();
        EnsureToastActivationProtocol();
        _pendingActivationThreadId = string.IsNullOrWhiteSpace(initialActivationThreadId) ? null : initialActivationThreadId;
        _notifyIcon = CreateNotifyIcon();
        _trayRestorePlacement = CreateEmptyWindowPlacement();
        Resize += (_, __) => PublishWindowState();

        Shown += async (_, __) => await InitializeAsync();
        FormClosing += OnFormClosing;
        FormClosed += (_, __) => DisposeNotifyIcon();
        Application.AddMessageFilter(this);

    }

    private IntPtr CursorForHitTest(int hit)
    {
        if (hit == HTLEFT || hit == HTRIGHT) return LoadCursor(IntPtr.Zero, IDC_SIZEWE);
        if (hit == HTTOP || hit == HTBOTTOM) return LoadCursor(IntPtr.Zero, IDC_SIZENS);
        if (hit == HTTOPLEFT || hit == HTBOTTOMRIGHT) return LoadCursor(IntPtr.Zero, IDC_SIZENWSE);
        if (hit == HTTOPRIGHT || hit == HTBOTTOMLEFT) return LoadCursor(IntPtr.Zero, IDC_SIZENESW);
        return IntPtr.Zero;
    }

    protected override CreateParams CreateParams
    {
        get
        {
            return base.CreateParams;
        }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_GETMINMAXINFO)
        {
            base.WndProc(ref m);
            ApplyMinimumTrackSize(m.LParam);
            return;
        }

        if (m.Msg == WM_NCCALCSIZE && m.WParam != IntPtr.Zero)
        {
            var nccsp = (NCCALCSIZE_PARAMS)Marshal.PtrToStructure(m.LParam, typeof(NCCALCSIZE_PARAMS));

            if (WindowState == FormWindowState.Maximized)
            {
                // [功能 4] 最大化时不覆盖任务栏：将客户端大小严格限制在显示器工作区
                IntPtr monitor = MonitorFromWindow(Handle, MONITOR_DEFAULTTONEAREST);
                if (monitor != IntPtr.Zero)
                {
                    var monitorInfo = new MONITORINFO();
                    monitorInfo.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
                    if (GetMonitorInfo(monitor, ref monitorInfo))
                    {
                        nccsp.rcNewWindow = monitorInfo.rcWork;
                        Marshal.StructureToPtr(nccsp, m.LParam, false);
                        m.Result = IntPtr.Zero;
                        return;
                    }
                }
            }
            else
            {
                if (Environment.OSVersion.Version.Build >= 22000)
                {
                    nccsp.rcNewWindow.Left += 1;
                    nccsp.rcNewWindow.Top += 1;
                    nccsp.rcNewWindow.Right -= 1;
                    nccsp.rcNewWindow.Bottom -= 1;
                    Marshal.StructureToPtr(nccsp, m.LParam, false);
                }
                m.Result = IntPtr.Zero;
                return;
            }
        }

        if (m.Msg == WM_NCHITTEST)
        {
            base.WndProc(ref m);
            if (WindowState != FormWindowState.Maximized)
            {
                Point cursor = PointToClient(GetScreenPointFromLParam(m.LParam));
                int hitTest = GetResizeHitTest(cursor);

                if (hitTest != 0) m.Result = (IntPtr)hitTest;
            }
            return;
        }

        if (m.Msg == WM_SETCURSOR)
        {
            int hitTest = (int)m.LParam & 0xFFFF;
            IntPtr cursorHandle = CursorForHitTest(hitTest);
            if (cursorHandle != IntPtr.Zero)
            {
                SetCursor(cursorHandle);
                m.Result = (IntPtr)1;
                return;
            }
        }

        base.WndProc(ref m);
    }

    private void ApplyMinimumTrackSize(IntPtr minMaxInfoPtr)
    {
        if (minMaxInfoPtr == IntPtr.Zero)
        {
            return;
        }

        var info = (MINMAXINFO)Marshal.PtrToStructure(minMaxInfoPtr, typeof(MINMAXINFO));
        int minContentWidth = ScaleCssPixelsToWindowPixels(MinimumContentWidthCssPx);
        int chromeWidth = GetCurrentChromeWidth();
        info.ptMinTrackSize.X = Math.Max(info.ptMinTrackSize.X, minContentWidth + chromeWidth);
        Marshal.StructureToPtr(info, minMaxInfoPtr, false);
    }

    private int ScaleCssPixelsToWindowPixels(int cssPixels)
    {
        uint dpi = 96;
        try
        {
            if (IsHandleCreated)
            {
                dpi = GetDpiForWindow(Handle);
            }
        }
        catch
        {
            dpi = 96;
        }

        if (dpi == 0)
        {
            dpi = 96;
        }

        return (int)Math.Ceiling(cssPixels * dpi / 96.0);
    }

    private int GetCurrentChromeWidth()
    {
        RECT windowRect;
        RECT clientRect;
        if (IsHandleCreated && GetWindowRect(Handle, out windowRect) && GetClientRect(Handle, out clientRect))
        {
            int windowWidth = windowRect.Right - windowRect.Left;
            int clientWidth = clientRect.Right - clientRect.Left;
            return Math.Max(0, windowWidth - clientWidth);
        }

        return Math.Max(0, Width - ClientSize.Width);
    }

    private Point GetScreenPointFromLParam(IntPtr lParam)
    {
        int value = unchecked((int)lParam.ToInt64());
        return new Point((short)(value & 0xFFFF), (short)((value >> 16) & 0xFFFF));
    }

    private int GetResizeHitTest(Point clientPoint)
    {
        int borderWidth = GetSystemMetrics(SM_CXSIZEFRAME) + GetSystemMetrics(SM_CXPADDEDBORDER);
        int borderHeight = GetSystemMetrics(SM_CYSIZEFRAME) + GetSystemMetrics(SM_CXPADDEDBORDER);
        bool top = clientPoint.Y < borderHeight;
        bool bottom = clientPoint.Y >= ClientSize.Height - borderHeight;
        bool left = clientPoint.X < borderWidth;
        bool right = clientPoint.X >= ClientSize.Width - borderWidth;

        if (top && left) return HTTOPLEFT;
        if (top && right) return HTTOPRIGHT;
        if (bottom && left) return HTBOTTOMLEFT;
        if (bottom && right) return HTBOTTOMRIGHT;
        if (top) return HTTOP;
        if (bottom) return HTBOTTOM;
        if (left) return HTLEFT;
        if (right) return HTRIGHT;
        return 0;
    }

    private int EdgeHitTest()
    {
        POINT screenPt;
        if (!GetCursorPos(out screenPt)) return 0;
        var bounds = Bounds;
        if (screenPt.X < bounds.Left || screenPt.X >= bounds.Right
            || screenPt.Y < bounds.Top || screenPt.Y >= bounds.Bottom)
            return 0;
        var pt = new POINT { X = screenPt.X, Y = screenPt.Y };
        ScreenToClient(Handle, ref pt);
        return GetResizeHitTest(new Point(pt.X, pt.Y));
    }

    public bool PreFilterMessage(ref Message m)
    {
        if (m.Msg == WM_LBUTTONDOWN && WindowState != FormWindowState.Maximized)
        {
            int hitTest = EdgeHitTest();
            if (hitTest != 0)
            {
                ReleaseCapture();
                SendMessage(Handle, WM_NCLBUTTONDOWN, hitTest, 0);
                return true;
            }
        }
        return false;
    }

    // =========================================================
    // 恢复窗口阴影
    // =========================================================
    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        try
        {
            // [功能 3] 保留系统默认边框阴影：向客户区内侵入 1 像素，DWM 将借此渲染原生阴影
            var margins = new MARGINS { cxLeftWidth = 0, cxRightWidth = 0, cyTopHeight = 0, cyBottomHeight = 1 };
            DwmExtendFrameIntoClientArea(Handle, ref margins);
        }
        catch (Exception ex)
        {
            AppendLog("Failed to extend frame for drop shadow: " + ex.Message);
        }
    }

    private async Task InitializeAsync()
    {
        try
        {
            AppendLog("Launcher boot started.");
            LogVersion();
            LogStartupFileDiagnostics();

            // 初始化启动页 WebView2
            await InitializeSplashWebViewAsync().ConfigureAwait(true);

            if (!await IsFrontendReadyAsync().ConfigureAwait(true))
            {
                AppendLog("Starting local services...");
                // 删除旧的 runtime state 文件，避免读取到上次运行的错误端口
                try
                {
                    if (File.Exists(_runtimeStatePath))
                    {
                        File.Delete(_runtimeStatePath);
                        AppendLog("Cleared stale runtime state.");
                    }
                }
                catch (Exception ex)
                {
                    AppendLog("Warning: Could not delete stale runtime state: " + ex.Message);
                }
                StartManagedServices();
                _serviceStartedByLauncher = true;
            }
            else
            {
                AppendLog("Frontend already running - reusing existing services.");
            }

            await WaitForFrontendAsync(TimeSpan.FromMinutes(2)).ConfigureAwait(true);

            await InitializeWebViewAsync().ConfigureAwait(true);
            AppendLog("Desktop window ready.");

            // 启动时恢复防休眠设置
            RestorePreventSleepFromConfig();
        }
        catch (Exception ex)
        {
            if (_lifecycleCancellation.IsCancellationRequested || ex is OperationCanceledException)
            {
                AppendLog("Launcher initialization canceled during shutdown.");
                return;
            }

            LogException("Launcher failed", ex);
            var errorMessage = BuildStartupErrorMessage(ex);
            AppendLog("Launcher failure summary: " + DescribeStartupFailure(ex));

            var context = new Dictionary<string, object>();
            context.Add("phase", "initialization");
            context.Add("serviceStartedByLauncher", _serviceStartedByLauncher);
            context.Add("frontendUrl", _frontendUrl);
            context.Add("startupDiagnostics", ReadRecentStartupLogs(80));
            _crashLogger.WriteCrashReport(ex, context);
            MessageBox.Show(
                this,
                errorMessage,
                "OfficeClaw 启动失败",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            RequestExit();
        }
    }

    private static string ResolveProjectRoot()
    {
        return AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }

    private string BuildFrontendUrl()
    {
        // 不在构造函数读取 runtime state，因为可能是上次运行遗留的旧数据
        // 正确的 URL 会在 WaitForFrontendAsync() 轮询时从新写入的 runtime state 刷新
        var port = ReadPortFromEnv("FRONTEND_PORT", 3003);
        return "http://127.0.0.1:" + port + "/";
    }

    private Icon ResolveAppIcon()
    {
        try
        {
            var icoPath = Path.Combine(_projectRoot, "assets", "app.ico");
            if (File.Exists(icoPath))
            {
                return new Icon(icoPath);
            }
            return Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
        }
        catch
        {
            return SystemIcons.Application;
        }
    }

    private static PROPVARIANT CreateStringPropVariant(string value)
    {
        return new PROPVARIANT
        {
            vt = VT_LPWSTR,
            p = Marshal.StringToCoTaskMemUni(value)
        };
    }

    private string ResolveToastShortcutIconPath()
    {
        var icoPath = Path.Combine(_projectRoot, "assets", "app.ico");
        return File.Exists(icoPath) ? icoPath : Application.ExecutablePath;
    }

    private void TrySetToastAppUserModelId()
    {
        try
        {
            var result = SetCurrentProcessExplicitAppUserModelID(ToastAppUserModelId);
            if (result != 0)
            {
                AppendLog("SetCurrentProcessExplicitAppUserModelID returned HRESULT 0x" + result.ToString("X8"));
            }
        }
        catch (Exception ex)
        {
            AppendLog("Failed setting toast AppUserModelID: " + ex.Message);
        }
    }

    private void EnsureToastIdentityShortcut()
    {
        try
        {
            var programsDir = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            if (string.IsNullOrWhiteSpace(programsDir))
            {
                AppendLog("Skipped toast identity shortcut: Start Menu programs folder unavailable.");
                return;
            }

            var shortcutDir = Path.Combine(programsDir, "OfficeClaw");
            Directory.CreateDirectory(shortcutDir);
            var shortcutPath = Path.Combine(shortcutDir, "OfficeClaw.lnk");

            var shellLink = (IShellLinkW)new CShellLink();
            shellLink.SetPath(Application.ExecutablePath);
            shellLink.SetArguments("");
            shellLink.SetDescription("OfficeClaw");
            shellLink.SetIconLocation(ResolveToastShortcutIconPath(), 0);

            var workingDirectory = Path.GetDirectoryName(Application.ExecutablePath);
            if (!string.IsNullOrWhiteSpace(workingDirectory))
            {
                shellLink.SetWorkingDirectory(workingDirectory);
            }

            var propertyStore = (IPropertyStore)shellLink;
            var key = AppUserModelIdPropertyKey;
            var propVariant = CreateStringPropVariant(ToastAppUserModelId);
            try
            {
                propertyStore.SetValue(ref key, ref propVariant);
                propertyStore.Commit();
            }
            finally
            {
                PropVariantClear(ref propVariant);
            }

            var persistFile = (System.Runtime.InteropServices.ComTypes.IPersistFile)shellLink;
            persistFile.Save(shortcutPath, true);
            AppendLog("Toast identity shortcut ensured: " + shortcutPath);
        }
        catch (Exception ex)
        {
            AppendLog("Failed ensuring toast identity shortcut: " + ex.Message);
        }
    }

    private void EnsureToastActivationProtocol()
    {
        try
        {
            using (var protocolKey = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + ToastActivationProtocol))
            using (var commandKey = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + ToastActivationProtocol + @"\shell\open\command"))
            {
                if (protocolKey == null || commandKey == null)
                {
                    AppendLog("Failed ensuring toast activation protocol: registry key unavailable.");
                    return;
                }

                protocolKey.SetValue("", "URL:OfficeClaw Protocol", RegistryValueKind.String);
                protocolKey.SetValue("URL Protocol", "", RegistryValueKind.String);
                commandKey.SetValue("", "\"" + Application.ExecutablePath + "\" \"%1\"", RegistryValueKind.String);
            }
            AppendLog("Toast activation protocol ensured: " + ToastActivationProtocol);
        }
        catch (Exception ex)
        {
            AppendLog("Failed ensuring toast activation protocol: " + ex.Message);
        }
    }

    private NotifyIcon CreateNotifyIcon()
    {
        var contextMenu = new ContextMenuStrip();
        contextMenu.ShowImageMargin = false;
        contextMenu.Items.Add("打开 OfficeClaw", null, (_, __) => RestoreFromExternalActivation());
        contextMenu.Items.Add("退出", null, (_, __) => RequestExit());

        var notifyIcon = new NotifyIcon
        {
            Text = "OfficeClaw",
            Visible = true,
            Icon = Icon ?? SystemIcons.Application,
            ContextMenuStrip = contextMenu,
        };
        notifyIcon.DoubleClick += (_, __) => RestoreFromExternalActivation();
        notifyIcon.BalloonTipClicked += (_, __) =>
        {
            var pendingThreadId = _lastDesktopNotificationThreadId;
            _lastDesktopNotificationThreadId = null;
            RestoreFromExternalActivation(pendingThreadId);
        };
        return notifyIcon;
    }

    private void DisposeNotifyIcon()
    {
        if (!_lifecycleCancellation.IsCancellationRequested)
        {
            _lifecycleCancellation.Cancel();
        }
        _activationWaitHandle.Unregister(null);
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
        _lifecycleCancellation.Dispose();
    }

    private void OnFormClosing(object sender, FormClosingEventArgs eventArgs)
    {
        if (!_exitRequested && eventArgs.CloseReason == CloseReason.UserClosing)
        {
            eventArgs.Cancel = true;
            ShowCloseConfirmationDialog();
            return;
        }

        _notifyIcon.Visible = false;

        // StopManagedServices is now called asynchronously in RequestExit()
        // to improve user experience (window closes immediately, services stop in background)
    }

    private void ShowCloseConfirmationDialog()
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action)ShowCloseConfirmationDialog);
            return;
        }

        string savedAction = ReadCloseActionPref();
        if (savedAction == "minimize") { HideToTray(); return; }
        if (savedAction == "exit") { RequestExit(); return; }

        using (var dialog = new CloseConfirmationDialog())
        {
            var result = dialog.ShowDialog(this);
            if (result == DialogResult.OK)
            {
                if (dialog.DontAskAgain)
                    WriteDesktopPref("closeAction", dialog.ShouldMinimize ? "minimize" : "exit");

                if (dialog.ShouldMinimize)
                    HideToTray();
                else
                    RequestExit();
            }
        }
    }

    private string ReadDesktopPref(string key)
    {
        try
        {
            if (!File.Exists(_desktopPrefsPath)) return null;
            var content = File.ReadAllText(_desktopPrefsPath);
            var match = Regex.Match(content, "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"(?<v>[^\"]*)\"");
            return match.Success ? match.Groups["v"].Value : null;
        }
        catch { return null; }
    }

    private void WriteDesktopPref(string key, string value)
    {
        try
        {
            var dir = Path.GetDirectoryName(_desktopPrefsPath);
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);

            string content = "{}";
            if (File.Exists(_desktopPrefsPath))
                content = File.ReadAllText(_desktopPrefsPath);

            var pattern = "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"[^\"]*\"";
            var replacement = "\"" + key + "\": \"" + value + "\"";
            if (Regex.IsMatch(content, pattern))
                content = Regex.Replace(content, pattern, replacement);
            else
                content = content.TrimEnd().TrimEnd('}') + (content.Contains(":") ? ", " : " ") + replacement + " }";

            File.WriteAllText(_desktopPrefsPath, content);
        }
        catch { }
    }

    private string NormalizeCloseAction(string value)
    {
        if (value == "minimize" || value == "exit")
        {
            return value;
        }

        return "ask";
    }

    private string ReadCloseActionPref()
    {
        return NormalizeCloseAction(ReadDesktopPref("closeAction"));
    }

    private void WriteCloseActionPref(string value)
    {
        WriteDesktopPref("closeAction", NormalizeCloseAction(value));
    }

    private void PublishCloseActionState()
    {
        var value = ReadCloseActionPref();
        var payload = "{\"type\":\"" + DesktopCloseActionStateMessageType + "\",\"value\":\"" + EscapeJsonString(value) + "\"}";
        PublishToWebViews(payload);
    }

    private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs eventArgs)
    {
        string message;
        try
        {
            message = eventArgs.TryGetWebMessageAsString();
        }
        catch (Exception ex)
        {
            AppendLog("Failed reading WebView2 message: " + ex.Message);
            return;
        }

        HandleWindowMessage(message);
    }

    private void HandleWindowMessage(string message)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            return;
        }

        if (message.StartsWith("{", StringComparison.Ordinal))
        {
            HandleJsonMessage(message);
            return;
        }

        if (message.StartsWith(WindowStartResizeMessagePrefix, StringComparison.Ordinal))
        {
            StartWindowResize(message.Substring(WindowStartResizeMessagePrefix.Length));
            return;
        }

        switch (message)
        {
            case WindowMinimizeMessage:
                WindowState = FormWindowState.Minimized;
                PublishWindowState();
                return;
            case WindowToggleMaximizeMessage:
                ToggleMaximize();
                return;
            case WindowCloseMessage:
                ShowCloseConfirmationDialog();
                return;
            case WindowSyncStateMessage:
                PublishWindowState();
                return;
            case WindowStartDragMessage:
                StartWindowDrag();
                return;
            case WindowFlashTaskbarMessage:
                FlashTaskbarIfUnfocused();
                return;
            case WindowStopFlashMessage:
                StopFlash();
                return;
            case PreventSleepEnableMessage:
                EnablePreventSleep();
                return;
            case PreventSleepDisableMessage:
                DisablePreventSleep();
                return;
            case PreventSleepSyncStateMessage:
                PublishPreventSleepState(_preventSleepEnabled);
                return;
            default:
                AppendLog("Ignoring unknown WebView2 message: " + message);
                return;
        }
    }

    private void HandleJsonMessage(string message)
    {
        try
        {
            var typeMatch = Regex.Match(message, "\"type\"\\s*:\\s*\"([^\"]+)\"");
            if (!typeMatch.Success) return;

            var type = typeMatch.Groups[1].Value;
            if (type == "desktop.notification")
            {
                var title = ExtractJsonStringField(message, "title") ?? "OfficeClaw";
                var body = ExtractJsonStringField(message, "body") ?? "";
                var notificationType = ExtractJsonStringField(message, "notificationType") ?? "info";
                var threadId = ExtractJsonStringField(message, "threadId");

                ShowDesktopNotificationIfUnfocused(title, body, notificationType, threadId);
                return;
            }

            if (type == DesktopCloseActionSyncMessageType)
            {
                PublishCloseActionState();
                return;
            }

            if (type == DesktopCloseActionSetMessageType)
            {
                WriteCloseActionPref(ExtractJsonStringField(message, "value"));
                PublishCloseActionState();
                return;
            }

            if (type == "voice.transcription.start")
            {
                StartNativeTranscription(
                    ExtractJsonStringField(message, "sessionId"),
                    ExtractJsonStringField(message, "language")
                );
                return;
            }

            if (type == "voice.transcription.stop")
            {
                StopNativeTranscription(ExtractJsonStringField(message, "sessionId"));
                return;
            }
        }
        catch (Exception ex)
        {
            AppendLog("Failed to parse JSON message: " + ex.Message);
        }
    }

    private void StartNativeTranscription(string sessionId, string language)
    {
        lock (_speechLock)
        {
            StopNativeTranscriptionInternal();
            _speechFinalBuffer.Clear();
            _speechSessionId = string.IsNullOrWhiteSpace(sessionId) ? Guid.NewGuid().ToString("N") : sessionId;

            try
            {
                RecognizerInfo selected = null;
                var requestedCulture = !string.IsNullOrWhiteSpace(language) ? language : "zh-CN";
                foreach (var recognizer in SpeechRecognitionEngine.InstalledRecognizers())
                {
                    if (recognizer.Culture.Name.Equals(requestedCulture, StringComparison.OrdinalIgnoreCase))
                    {
                        selected = recognizer;
                        break;
                    }
                }
                if (selected == null)
                {
                    foreach (var recognizer in SpeechRecognitionEngine.InstalledRecognizers())
                    {
                        if (recognizer.Culture.Name.StartsWith("zh", StringComparison.OrdinalIgnoreCase))
                        {
                            selected = recognizer;
                            break;
                        }
                    }
                }
                if (selected == null)
                {
                    foreach (var recognizer in SpeechRecognitionEngine.InstalledRecognizers())
                    {
                        selected = recognizer;
                        break;
                    }
                }

                if (selected == null)
                {
                    PublishVoiceMessage("voice.transcription.error", _speechSessionId, null, "No Windows speech recognizer installed");
                    return;
                }

                _speechRecognitionEngine = new SpeechRecognitionEngine(selected);
                _speechRecognitionEngine.SetInputToDefaultAudioDevice();
                _speechRecognitionEngine.LoadGrammar(new DictationGrammar());
                _speechRecognitionEngine.InitialSilenceTimeout = TimeSpan.FromSeconds(6);
                _speechRecognitionEngine.EndSilenceTimeout = TimeSpan.FromSeconds(1.2);
                _speechRecognitionEngine.EndSilenceTimeoutAmbiguous = TimeSpan.FromSeconds(1.5);
                _speechRecognitionEngine.SpeechHypothesized += OnSpeechHypothesized;
                _speechRecognitionEngine.SpeechRecognized += OnSpeechRecognized;
                _speechRecognitionEngine.SpeechRecognitionRejected += OnSpeechRejected;
                _speechRecognitionEngine.RecognizeCompleted += OnSpeechRecognizeCompleted;
                _speechRecognitionEngine.RecognizeAsync(RecognizeMode.Multiple);
            }
            catch (Exception ex)
            {
                PublishVoiceMessage("voice.transcription.error", _speechSessionId, null, ex.Message);
                StopNativeTranscriptionInternal();
            }
        }
    }

    private void StopNativeTranscription(string sessionId)
    {
        lock (_speechLock)
        {
            if (_speechRecognitionEngine == null) return;
            if (!string.IsNullOrWhiteSpace(sessionId) && !string.Equals(sessionId, _speechSessionId, StringComparison.Ordinal))
            {
                return;
            }
            try
            {
                _speechRecognitionEngine.RecognizeAsyncStop();
            }
            catch
            {
                FinalizeSpeechAndCleanup();
            }
        }
    }

    private void OnSpeechHypothesized(object sender, SpeechHypothesizedEventArgs e)
    {
        var text = e.Result == null ? null : e.Result.Text;
        PublishVoiceMessage("voice.transcription.partial", _speechSessionId, text, null);
    }

    private void OnSpeechRecognized(object sender, SpeechRecognizedEventArgs e)
    {
        if (e.Result == null || string.IsNullOrWhiteSpace(e.Result.Text)) return;
        _speechFinalBuffer.Append(e.Result.Text).Append(" ");
        PublishVoiceMessage("voice.transcription.partial", _speechSessionId, _speechFinalBuffer.ToString(), null);
    }

    private void OnSpeechRejected(object sender, SpeechRecognitionRejectedEventArgs e)
    {
        PublishVoiceMessage("voice.transcription.error", _speechSessionId, null, "Speech rejected");
    }

    private void OnSpeechRecognizeCompleted(object sender, RecognizeCompletedEventArgs e)
    {
        if (e.Error != null)
        {
            PublishVoiceMessage("voice.transcription.error", _speechSessionId, null, e.Error.Message);
        }
        else
        {
            var finalText = _speechFinalBuffer.ToString().Trim();
            PublishVoiceMessage("voice.transcription.final", _speechSessionId, finalText, null);
        }
        StopNativeTranscriptionInternal();
    }

    private void FinalizeSpeechAndCleanup()
    {
        var finalText = _speechFinalBuffer.ToString().Trim();
        PublishVoiceMessage("voice.transcription.final", _speechSessionId, finalText, null);
        StopNativeTranscriptionInternal();
    }

    private void StopNativeTranscriptionInternal()
    {
        if (_speechRecognitionEngine != null)
        {
            try
            {
                _speechRecognitionEngine.SpeechHypothesized -= OnSpeechHypothesized;
                _speechRecognitionEngine.SpeechRecognized -= OnSpeechRecognized;
                _speechRecognitionEngine.SpeechRecognitionRejected -= OnSpeechRejected;
                _speechRecognitionEngine.RecognizeCompleted -= OnSpeechRecognizeCompleted;
                _speechRecognitionEngine.RecognizeAsyncCancel();
                _speechRecognitionEngine.Dispose();
            }
            catch { }
            _speechRecognitionEngine = null;
        }
        _speechSessionId = null;
        _speechFinalBuffer.Clear();
    }

    private void PublishVoiceMessage(string type, string sessionId, string text, string error)
    {
        var payload = "{\"type\":\"" + EscapeJsonString(type) + "\"," +
                      "\"sessionId\":" + (sessionId == null ? "null" : "\"" + EscapeJsonString(sessionId) + "\"") + "," +
                      "\"text\":" + (text == null ? "null" : "\"" + EscapeJsonString(text) + "\"") + "," +
                      "\"error\":" + (error == null ? "null" : "\"" + EscapeJsonString(error) + "\"") + "}";
        PublishToWebViews(payload);
    }

    private void PublishToWebViews(string payload)
    {
        try
        {
            if (_webView != null && !_webView.IsDisposed && _webView.CoreWebView2 != null)
            {
                _webView.CoreWebView2.PostWebMessageAsJson(payload);
            }
            if (_splashWebView != null && !_splashWebView.IsDisposed && _splashWebView.CoreWebView2 != null)
            {
                _splashWebView.CoreWebView2.PostWebMessageAsJson(payload);
            }
        }
        catch (Exception ex)
        {
            AppendLog("Failed to publish voice message: " + ex.Message);
        }
    }

    private static string ExtractJsonStringField(string json, string fieldName)
    {
        var pattern = "\"" + Regex.Escape(fieldName) + "\"\\s*:\\s*(null|\"((?:\\\\.|[^\"])*)\")";
        var match = Regex.Match(json, pattern, RegexOptions.Singleline);
        if (!match.Success || match.Groups[1].Value == "null") return null;
        return DecodeJsonString(match.Groups[2].Value);
    }

    private static string EscapeJsonString(string value)
    {
        if (value == null) return "";

        var builder = new StringBuilder(value.Length);
        for (var i = 0; i < value.Length; i++)
        {
            var ch = value[i];
            switch (ch)
            {
                case '"': builder.Append("\\\""); break;
                case '\\': builder.Append("\\\\"); break;
                case '\b': builder.Append("\\b"); break;
                case '\f': builder.Append("\\f"); break;
                case '\n': builder.Append("\\n"); break;
                case '\r': builder.Append("\\r"); break;
                case '\t': builder.Append("\\t"); break;
                default:
                    if (ch < 0x20)
                    {
                        builder.Append("\\u").Append(((int)ch).ToString("x4"));
                    }
                    else
                    {
                        builder.Append(ch);
                    }
                    break;
            }
        }
        return builder.ToString();
    }

    private static string DecodeJsonString(string value)
    {
        var builder = new StringBuilder(value.Length);
        for (var i = 0; i < value.Length; i++)
        {
            var ch = value[i];
            if (ch != '\\' || i + 1 >= value.Length)
            {
                builder.Append(ch);
                continue;
            }

            var escaped = value[++i];
            switch (escaped)
            {
                case '"': builder.Append('"'); break;
                case '\\': builder.Append('\\'); break;
                case '/': builder.Append('/'); break;
                case 'b': builder.Append('\b'); break;
                case 'f': builder.Append('\f'); break;
                case 'n': builder.Append('\n'); break;
                case 'r': builder.Append('\r'); break;
                case 't': builder.Append('\t'); break;
                case 'u':
                    if (i + 4 < value.Length)
                    {
                        var hex = value.Substring(i + 1, 4);
                        try
                        {
                            builder.Append((char)Convert.ToInt32(hex, 16));
                            i += 4;
                        }
                        catch
                        {
                            builder.Append("\\u").Append(hex);
                            i += 4;
                        }
                    }
                    else
                    {
                        builder.Append("\\u");
                    }
                    break;
                default:
                    builder.Append(escaped);
                    break;
            }
        }
        return builder.ToString();
    }

    private bool IsWindowForeground()
    {
        if (!IsHandleCreated) return true;
        return GetForegroundWindow() == Handle;
    }

    private void ShowDesktopNotificationIfUnfocused(string title, string body, string notificationType, string threadId)
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action<string, string, string, string>)ShowDesktopNotificationIfUnfocused, title, body, notificationType, threadId);
            return;
        }

        if (IsWindowForeground()) return;

        _lastDesktopNotificationThreadId = string.IsNullOrWhiteSpace(threadId) ? null : threadId;
        var icon = notificationType == "error" ? ToolTipIcon.Error : ToolTipIcon.Info;
        ShowPersistentToastOrFallback(title, body, notificationType, icon, threadId);

        FlashTaskbar();

        AppendLog("Desktop notification requested: " + title + " - " + body);
    }

    private void ShowPersistentToastOrFallback(string title, string body, string notificationType, ToolTipIcon fallbackIcon, string threadId)
    {
        Task.Run(() =>
        {
            if (_lifecycleCancellation.IsCancellationRequested)
            {
                return;
            }

            var toastSubmitted = TryShowWindowsToast(title, body, notificationType, threadId);
            if (toastSubmitted)
            {
                AppendLog("Windows toast submitted; skipping tray balloon fallback.");
                return;
            }

            ShowTrayBalloonFallback(title, body, fallbackIcon, "toast-failed");
        });
    }

    private void ShowTrayBalloonFallback(string title, string body, ToolTipIcon fallbackIcon, string reason)
    {
        try
        {
            if (!IsDisposed && IsHandleCreated)
            {
                BeginInvoke((Action)(() =>
                {
                    try
                    {
                        _notifyIcon.ShowBalloonTip(TrayBalloonFallbackTimeoutMs, title, body, fallbackIcon);
                        AppendLog("Tray balloon fallback shown (" + reason + "): " + title);
                    }
                    catch (Exception ex)
                    {
                        AppendLog("Tray balloon fallback failed (" + reason + "): " + ex.Message);
                    }
                }));
            }
        }
        catch (ObjectDisposedException ex)
        {
            AppendLog("Tray balloon fallback skipped (" + reason + "): " + ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            AppendLog("Tray balloon fallback skipped (" + reason + "): " + ex.Message);
        }
    }

    private bool TryShowWindowsToast(string title, string body, string notificationType, string threadId)
    {
        try
        {
            var powerShellPath = ResolveWindowsPowerShellPath();
            var script = BuildToastPowerShellScript(title, body, notificationType, threadId);
            var encodedScript = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
            var startInfo = new ProcessStartInfo
            {
                FileName = powerShellPath,
                Arguments = "-NoProfile -ExecutionPolicy Bypass -EncodedCommand " + encodedScript,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };

            using (var process = Process.Start(startInfo))
            {
                if (process == null)
                {
                    AppendLog("Windows toast failed: PowerShell process did not start.");
                    return false;
                }

                if (!process.WaitForExit(ToastProcessTimeoutMs))
                {
                    try { process.Kill(); } catch { }
                    AppendLog("Windows toast failed: PowerShell timed out.");
                    return false;
                }

                if (process.ExitCode != 0)
                {
                    var error = process.StandardError.ReadToEnd();
                    AppendLog("Windows toast failed with exit code " + process.ExitCode + ": " + error);
                    return false;
                }
            }

            AppendLog("Windows toast submitted successfully: " + title);
            return true;
        }
        catch (Exception ex)
        {
            AppendLog("Windows toast failed: " + ex.Message);
            return false;
        }
    }

    private static string EscapeXml(string value)
    {
        return SecurityElement.Escape(value ?? "") ?? "";
    }

    private static string EscapePowerShellSingleQuoted(string value)
    {
        return (value ?? "").Replace("'", "''");
    }

    private static string BuildToastTag(string notificationType)
    {
        if (notificationType == "error") return "task-error";
        if (notificationType == "success") return "task-success";
        return "task-info";
    }

    private static string BuildToastActivationUri(string threadId)
    {
        var builder = new StringBuilder(ToastActivationProtocol + "://notification");
        if (!string.IsNullOrWhiteSpace(threadId))
        {
            builder.Append("?threadId=").Append(Uri.EscapeDataString(threadId));
        }
        return builder.ToString();
    }

    private static string BuildToastPowerShellScript(string title, string body, string notificationType, string threadId)
    {
        var activationUri = BuildToastActivationUri(threadId);
        var toastXml =
            "<toast duration=\"long\" activationType=\"protocol\" launch=\"" + EscapeXml(activationUri) + "\">" +
            "<visual><binding template=\"ToastGeneric\">" +
            "<text>" + EscapeXml(title) + "</text>" +
            "<text>" + EscapeXml(body) + "</text>" +
            "</binding></visual>" +
            "</toast>";

        return
            "$ErrorActionPreference = 'Stop'\n" +
            "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null\n" +
            "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null\n" +
            "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument\n" +
            "$xml.LoadXml('" + EscapePowerShellSingleQuoted(toastXml) + "')\n" +
            "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)\n" +
            "$toast.Tag = '" + EscapePowerShellSingleQuoted(BuildToastTag(notificationType)) + "'\n" +
            "$toast.Group = 'OfficeClaw'\n" +
            "$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('" + ToastAppUserModelId + "')\n" +
            "$notifier.Show($toast)\n";
    }

    private void FlashTaskbarIfUnfocused()
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action)FlashTaskbarIfUnfocused);
            return;
        }

        if (IsWindowForeground()) return;

        FlashTaskbar();
    }

    private void RefreshNativeFrame()
    {
        if (!IsHandleCreated)
        {
            return;
        }

        SetWindowPos(
            Handle,
            IntPtr.Zero,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
        );
    }

    private void StartWindowDrag()
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action)StartWindowDrag);
            return;
        }

        if (!IsHandleCreated)
        {
            return;
        }

        if (WindowState == FormWindowState.Maximized)
        {
            // 获取当前鼠标位置
            POINT cursorPos;
            if (!GetCursorPos(out cursorPos))
            {
                return;
            }

            // 获取最大化窗口的位置
            RECT maxWindowRect;
            if (!GetWindowRect(Handle, out maxWindowRect))
            {
                return;
            }

            // 获取窗口的 WINDOWPLACEMENT，其中包含还原后的尺寸
            var placement = CreateEmptyWindowPlacement();
            if (!GetWindowPlacement(Handle, ref placement))
            {
                return;
            }

            // 使用 rcNormalPosition 获取还原后的窗口尺寸（这是窗口记忆的尺寸，不会累积变化）
            int normalWidth = placement.rcNormalPosition.Right - placement.rcNormalPosition.Left;
            int normalHeight = placement.rcNormalPosition.Bottom - placement.rcNormalPosition.Top;

            // 计算鼠标在最大化窗口中的相对位置（从左上角开始）
            int relativeX = cursorPos.X - maxWindowRect.Left;
            int relativeY = cursorPos.Y - maxWindowRect.Top;

            // 计算最大化窗口的尺寸
            int maxWidth = maxWindowRect.Right - maxWindowRect.Left;
            int maxHeight = maxWindowRect.Bottom - maxWindowRect.Top;

            // 按比例缩放鼠标的相对位置到还原后的窗口
            // 这样可以保持鼠标在窗口中的相对位置不变
            double scaleX = (double)normalWidth / maxWidth;
            double scaleY = (double)normalHeight / maxHeight;

            int adjustedRelativeX = (int)(relativeX * scaleX);
            int adjustedRelativeY = (int)(relativeY * scaleY);

            // 计算新窗口位置，让鼠标保持在相同的相对位置
            int newX = cursorPos.X - adjustedRelativeX;
            int newY = cursorPos.Y - adjustedRelativeY;

            // 确保窗口不会移出屏幕
            IntPtr monitor = MonitorFromWindow(Handle, MONITOR_DEFAULTTONEAREST);
            if (monitor != IntPtr.Zero)
            {
                var monitorInfo = new MONITORINFO();
                monitorInfo.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
                if (GetMonitorInfo(monitor, ref monitorInfo))
                {
                    // 限制在工作区内
                    if (newX < monitorInfo.rcWork.Left)
                    {
                        newX = monitorInfo.rcWork.Left;
                    }
                    if (newY < monitorInfo.rcWork.Top)
                    {
                        newY = monitorInfo.rcWork.Top;
                    }
                    if (newX + normalWidth > monitorInfo.rcWork.Right)
                    {
                        newX = monitorInfo.rcWork.Right - normalWidth;
                    }
                    if (newY + normalHeight > monitorInfo.rcWork.Bottom)
                    {
                        newY = monitorInfo.rcWork.Bottom - normalHeight;
                    }
                }
            }

            // 还原窗口
            WindowState = FormWindowState.Normal;
            RefreshNativeFrame();

            // 设置窗口新位置（保持原有尺寸）
            SetWindowPos(Handle, IntPtr.Zero, newX, newY, normalWidth, normalHeight, SWP_NOZORDER | SWP_NOACTIVATE);
        }

        ReleaseCapture();
        SendMessage(Handle, WM_NCLBUTTONDOWN, HTCAPTION, 0);
    }

    private int ResizeDirectionToHitTest(string direction)
    {
        switch (direction)
        {
            case "left": return HTLEFT;
            case "right": return HTRIGHT;
            case "top": return HTTOP;
            case "bottom": return HTBOTTOM;
            case "top-left": return HTTOPLEFT;
            case "top-right": return HTTOPRIGHT;
            case "bottom-left": return HTBOTTOMLEFT;
            case "bottom-right": return HTBOTTOMRIGHT;
            default: return 0;
        }
    }

    private void StartWindowResize(string direction)
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action<string>)StartWindowResize, direction);
            return;
        }

        if (!IsHandleCreated || WindowState == FormWindowState.Maximized)
        {
            return;
        }

        int hitTest = ResizeDirectionToHitTest(direction);
        if (hitTest == 0)
        {
            AppendLog("Ignoring unknown resize direction: " + direction);
            return;
        }

        ReleaseCapture();
        SendMessage(Handle, WM_NCLBUTTONDOWN, hitTest, 0);
    }

    private void ToggleMaximize()
    {
        if (WindowState == FormWindowState.Maximized)
        {
            WindowState = FormWindowState.Normal;
            RefreshNativeFrame();
        }
        else
        {
            WindowState = FormWindowState.Maximized;
        }

        PublishWindowState();
    }

    private void FlashTaskbar()
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action)FlashTaskbar);
            return;
        }

        if (!IsHandleCreated) return;

        var flashInfo = new FLASHWINFO
        {
            cbSize = (uint)Marshal.SizeOf(typeof(FLASHWINFO)),
            hwnd = Handle,
            dwFlags = FLASHW_ALL | FLASHW_TIMERNOFG,
            uCount = 5,
            dwTimeout = 0
        };

        FlashWindowEx(ref flashInfo);
        AppendLog("Taskbar flash triggered for background notification");
    }

    private void StopFlash()
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action)StopFlash);
            return;
        }

        if (!IsHandleCreated) return;

        var flashInfo = new FLASHWINFO
        {
            cbSize = (uint)Marshal.SizeOf(typeof(FLASHWINFO)),
            hwnd = Handle,
            dwFlags = 0,
            uCount = 0,
            dwTimeout = 0
        };

        FlashWindowEx(ref flashInfo);
    }

    private void PublishWindowState()
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action)PublishWindowState);
            return;
        }

        var isMaximized = WindowState == FormWindowState.Maximized ? "true" : "false";
        var isMinimized = WindowState == FormWindowState.Minimized ? "true" : "false";
        var canMaximize = MaximizeBox ? "true" : "false";
        var payload =
            "{\"type\":\"" + WindowStateMessageType + "\",\"payload\":{\"isMaximized\":" + isMaximized + ",\"isMinimized\":" + isMinimized + ",\"canMaximize\":" + canMaximize + "}}";

        try
        {
            if (_splashWebView != null && !_splashWebView.IsDisposed && _splashWebView.CoreWebView2 != null)
            {
                _splashWebView.CoreWebView2.PostWebMessageAsJson(payload);
            }

            if (_webView != null && !_webView.IsDisposed && _webView.CoreWebView2 != null)
            {
                _webView.CoreWebView2.PostWebMessageAsJson(payload);
            }
        }
        catch (Exception ex)
        {
            AppendLog("Failed posting WebView2 window state: " + ex.Message);
        }
    }

    /// <summary>
    /// 启用防休眠：阻止系统进入休眠和显示器关闭。
    /// </summary>
    private void EnablePreventSleep()
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action)EnablePreventSleep);
            return;
        }

        if (_preventSleepEnabled) return;

        // ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
        uint result = SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED);

        if (result == 0)
        {
            AppendLog("Failed to enable prevent sleep: SetThreadExecutionState returned 0");
            PublishPreventSleepState(false, "系统 API 调用失败");
            return;
        }

        _preventSleepEnabled = true;
        WritePreventSleepEnabled(true); // 持久化到配置文件
        AppendLog("Prevent sleep enabled: system will not sleep while app is running");
        PublishPreventSleepState(true);
    }

    /// <summary>
    /// 禁用防休眠：恢复系统正常休眠行为，并持久化配置。
    /// </summary>
    private void DisablePreventSleep()
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action)DisablePreventSleep);
            return;
        }

        if (!_preventSleepEnabled) return;

        SetThreadExecutionState(ES_CONTINUOUS);
        _preventSleepEnabled = false;
        WritePreventSleepEnabled(false); // 持久化到配置文件
        AppendLog("Prevent sleep disabled: system will resume normal sleep behavior");
        PublishPreventSleepState(false);
    }

    /// <summary>
    /// 仅释放防休眠限制（退出时使用），恢复系统正常休眠行为，但不修改配置文件。
    /// 这样下次启动时可以根据配置文件恢复用户之前的设置。
    /// </summary>
    private void ReleasePreventSleepOnly()
    {
        if (!_preventSleepEnabled) return;

        SetThreadExecutionState(ES_CONTINUOUS);
        _preventSleepEnabled = false;
        AppendLog("Prevent sleep released: system will resume normal sleep behavior (config preserved)");
    }

    /// <summary>
    /// 发布防休眠状态到 WebView。
    /// </summary>
    private void PublishPreventSleepState(bool enabled, string error = null)
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action<bool, string>)PublishPreventSleepState, enabled, error);
            return;
        }

        var enabledStr = enabled ? "true" : "false";
        var errorStr = error != null ? "\"" + error + "\"" : "null";
        var payload = "{\"type\":\"" + PreventSleepStateMessageType + "\",\"payload\":{\"enabled\":" + enabledStr + ",\"error\":" + errorStr + "}}";

        try
        {
            if (_webView != null && !_webView.IsDisposed && _webView.CoreWebView2 != null)
            {
                _webView.CoreWebView2.PostWebMessageAsJson(payload);
            }
        }
        catch (Exception ex)
        {
            AppendLog("Failed posting prevent sleep state: " + ex.Message);
        }
    }

    private static WINDOWPLACEMENT CreateEmptyWindowPlacement()
    {
        return new WINDOWPLACEMENT
        {
            length = Marshal.SizeOf(typeof(WINDOWPLACEMENT))
        };
    }

    private void CaptureTrayRestorePlacement()
    {
        if (!IsHandleCreated)
        {
            return;
        }

        var placement = CreateEmptyWindowPlacement();
        if (!GetWindowPlacement(Handle, ref placement))
        {
            return;
        }

        if (placement.showCmd == SW_SHOWMINIMIZED)
        {
            placement.showCmd = SW_RESTORE;
        }

        _trayRestorePlacement = placement;
        _hasTrayRestorePlacement = true;
    }

    private void RestoreFromTrayPlacement()
    {
        if (!_hasTrayRestorePlacement)
        {
            ShowWindow(Handle, SW_RESTORE);
            return;
        }

        var placement = _trayRestorePlacement;
        if (placement.showCmd == SW_SHOWMINIMIZED)
        {
            placement.showCmd = SW_RESTORE;
        }

        SetWindowPlacement(Handle, ref placement);
    }

    private void HideToTray()
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action)HideToTray);
            return;
        }

        CaptureTrayRestorePlacement();

        _isHiddenToTray = true;
        ShowInTaskbar = false;
        WindowState = FormWindowState.Minimized;
        Hide();
        _notifyIcon.Visible = true;
        PublishWindowState();
        if (!_trayHintShown)
        {
            _notifyIcon.ShowBalloonTip(
                2500,
                "OfficeClaw",
                "OfficeClaw 仍在后台运行，右键托盘图标可退出。",
                ToolTipIcon.Info
            );
            _trayHintShown = true;
        }
    }

    private void RestoreFromTray()
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action)RestoreFromTray);
            return;
        }

        _isHiddenToTray = false;
        ShowInTaskbar = true;
        Show();
        RestoreFromTrayPlacement();
        SetForegroundWindow(Handle);
        Activate();
        PublishWindowState();
    }


    private static string EscapeJavaScriptSingleQuoted(string value)
    {
        return value
            .Replace("\\", "\\\\")
            .Replace("'", "\\'");
    }

    private void NavigateToThreadIfReady(string threadId)
    {
        if (string.IsNullOrWhiteSpace(threadId))
        {
            return;
        }

        if (_webView == null || _webView.IsDisposed || _webView.CoreWebView2 == null)
        {
            _pendingActivationThreadId = threadId;
            return;
        }

        try
        {
            string targetPath;
            if (threadId.StartsWith(Program.OAuthCallbackActivationPrefixForNavigation, StringComparison.Ordinal))
            {
                targetPath = "/login/callback" + threadId.Substring(Program.OAuthCallbackActivationPrefixForNavigation.Length);
            }
            else
            {
                var encodedThreadId = Uri.EscapeDataString(threadId);
                targetPath = "/thread/" + encodedThreadId;
            }
            var script = "(function(){try{var current=window.location.pathname+window.location.search;if(current!=='" + EscapeJavaScriptSingleQuoted(targetPath) + "'){" +
                         "window.location.assign('" + EscapeJavaScriptSingleQuoted(targetPath) + "');}}catch(_){}})();";
            _webView.CoreWebView2.ExecuteScriptAsync(script);
            _pendingActivationThreadId = null;
        }
        catch (Exception ex)
        {
            AppendLog("Failed to navigate to thread from notification: " + ex.Message);
        }
    }

    private string ConsumeActivationPayloadThreadId()
    {
        try
        {
            var payloadPath = Program.GetActivationPayloadPath();
            if (!File.Exists(payloadPath))
            {
                return null;
            }

            var threadId = File.ReadAllText(payloadPath, Encoding.UTF8).Trim();
            try { File.Delete(payloadPath); } catch { }
            return string.IsNullOrWhiteSpace(threadId) ? null : threadId;
        }
        catch (Exception ex)
        {
            AppendLog("Failed reading toast activation payload: " + ex.Message);
            return null;
        }
    }

    private void RestoreFromExternalActivation(string threadId = null)
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action<string>)RestoreFromExternalActivation, threadId);
            return;
        }

        if (string.IsNullOrWhiteSpace(threadId))
        {
            threadId = ConsumeActivationPayloadThreadId();
        }

        if (!string.IsNullOrWhiteSpace(threadId))
        {
            _pendingActivationThreadId = threadId;
        }

        if (_isHiddenToTray)
        {
            RestoreFromTray();
            NavigateToThreadIfReady(_pendingActivationThreadId);
            return;
        }

        if (WindowState == FormWindowState.Minimized)
        {
            ShowInTaskbar = true;
            ShowWindow(Handle, SW_RESTORE);
            SetForegroundWindow(Handle);
            PublishWindowState();
            NavigateToThreadIfReady(_pendingActivationThreadId);
            return;
        }

        if (!Visible)
        {
            Show();
        }

        ShowInTaskbar = true;
        Activate();
        PublishWindowState();
        NavigateToThreadIfReady(_pendingActivationThreadId);
    }

    private void RequestExit()
    {
        if (IsDisposed)
        {
            return;
        }

        if (InvokeRequired)
        {
            BeginInvoke((Action)RequestExit);
            return;
        }

        if (_exitRequested)
        {
            return;
        }

        _exitRequested = true;
        if (!_lifecycleCancellation.IsCancellationRequested)
        {
            _lifecycleCancellation.Cancel();
        }

        // 退出前释放防休眠限制，恢复系统正常休眠行为
        // 注意：只释放系统限制，不修改配置文件，这样下次启动可以恢复用户设置
        if (_preventSleepEnabled)
        {
            ReleasePreventSleepOnly();
        }

        // Hide window immediately for better user experience
        // Services will be stopped asynchronously in background
        Hide();
        _notifyIcon.Visible = false;

        // Start stopping services asynchronously (fire-and-forget)
        // The PowerShell process will continue running even after this app exits
        StopManagedServicesAsync();

        // Close window immediately
        Close();
    }

    private int ReadPortFromEnv(string key, int fallback)
    {
        try
        {
            var envPath = Path.Combine(_projectRoot, ".env");
            if (!File.Exists(envPath))
            {
                return fallback;
            }

            foreach (var rawLine in File.ReadAllLines(envPath))
            {
                var line = rawLine.Trim();
                if (line.Length == 0 || line.StartsWith("#", StringComparison.Ordinal))
                {
                    continue;
                }

                var separatorIndex = line.IndexOf('=');
                if (separatorIndex <= 0)
                {
                    continue;
                }

                var candidateKey = line.Substring(0, separatorIndex).Trim();
                if (!string.Equals(candidateKey, key, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var value = line.Substring(separatorIndex + 1).Trim().Trim('"').Trim('\'');
                int port;
                if (int.TryParse(value, out port) && port > 0)
                {
                    return port;
                }
            }
        }
        catch (Exception ex)
        {
            AppendLog("Failed reading .env: " + ex.Message);
        }

        return fallback;
    }

    private bool TryRefreshFrontendUrlFromRuntimeState()
    {
        string runtimeUrl;
        if (TryReadRuntimeStateValue("FrontendUrl", out runtimeUrl) && !string.IsNullOrWhiteSpace(runtimeUrl))
        {
            _frontendUrl = runtimeUrl.Trim();
            return true;
        }

        string runtimePort;
        if (TryReadRuntimeStateValue("WebPort", out runtimePort))
        {
            int port;
            if (int.TryParse(runtimePort, out port) && port > 0)
            {
                _frontendUrl = "http://127.0.0.1:" + port + "/";
                return true;
            }
        }

        return false;
    }

    private bool TryReadRuntimeStateValue(string key, out string value)
    {
        value = null;
        try
        {
            if (!File.Exists(_runtimeStatePath))
            {
                return false;
            }

            var content = File.ReadAllText(_runtimeStatePath);
            var pattern =
                "\"" + Regex.Escape(key) + "\"\\s*:\\s*(?:\"(?<text>(?:\\\\.|[^\"])*)\"|(?<number>\\d+)|null)";
            var match = Regex.Match(content, pattern);
            if (!match.Success)
            {
                return false;
            }

            if (match.Groups["text"].Success)
            {
                value = Regex.Unescape(match.Groups["text"].Value);
                return true;
            }

            if (match.Groups["number"].Success)
            {
                value = match.Groups["number"].Value;
                return true;
            }
        }
        catch (Exception ex)
        {
            AppendLog("Failed reading runtime state: " + ex.Message);
        }

        return false;
    }

    private void StartManagedServices()
    {
        var startScript = Path.Combine(_projectRoot, "scripts", "start-windows.ps1");
        LogPathStatus("startup script", startScript);
        if (!File.Exists(startScript))
        {
            throw new FileNotFoundException("Missing startup script: " + startScript);
        }

        var powerShellPath = ResolveWindowsPowerShellPath();
        LogPathStatus("powershell", powerShellPath);

        var info = new ProcessStartInfo
        {
            FileName = powerShellPath,
            Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + startScript + "\" -Quick",
            WorkingDirectory = _projectRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };

        _serviceHostProcess = new Process
        {
            StartInfo = info,
            EnableRaisingEvents = true,
        };

        _serviceHostProcess.OutputDataReceived += (_, eventArgs) =>
        {
            if (!string.IsNullOrEmpty(eventArgs.Data))
            {
                AddServiceOutputLine(eventArgs.Data);
                AppendLog("[start] " + eventArgs.Data);
            }
        };

        _serviceHostProcess.ErrorDataReceived += (_, eventArgs) =>
        {
            if (!string.IsNullOrEmpty(eventArgs.Data))
            {
                AddServiceOutputLine("[stderr] " + eventArgs.Data);
                AppendLog("[start:err] " + eventArgs.Data);
            }
        };

        _serviceHostProcess.Exited += (_, __) =>
        {
            AppendLog("Service host exited with code " + _serviceHostProcess.ExitCode + ".");
        };

        try
        {
            if (!_serviceHostProcess.Start())
            {
                throw new InvalidOperationException("Failed to start local services.");
            }
        }
        catch (Exception ex)
        {
            LogException("Failed to start service host process", ex);
            throw;
        }

        _serviceHostProcess.BeginOutputReadLine();
        _serviceHostProcess.BeginErrorReadLine();
        AppendLog("Started service host via start-windows.ps1.");
    }

    private static string ResolveWindowsPowerShellPath()
    {
        var windowsDir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        if (string.IsNullOrWhiteSpace(windowsDir))
        {
            windowsDir = Environment.GetEnvironmentVariable("WINDIR");
        }

        if (!string.IsNullOrWhiteSpace(windowsDir))
        {
            var candidates = new[]
            {
                Path.Combine(windowsDir, "Sysnative", "WindowsPowerShell", "v1.0", "powershell.exe"),
                Path.Combine(windowsDir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
            };
            foreach (var candidate in candidates)
            {
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }
        }

        return "powershell.exe";
    }

    private void LogStartupFileDiagnostics()
    {
        AppendLog("Startup diagnostics: project root = " + _projectRoot);
        LogPathStatus("OfficeClaw executable", Application.ExecutablePath);
        LogPathStatus("startup script", Path.Combine(_projectRoot, "scripts", "start-windows.ps1"));
        LogPathStatus("stop script", Path.Combine(_projectRoot, "scripts", "stop-windows.ps1"));
        LogPathStatus("bundled node", Path.Combine(_projectRoot, "tools", "node", "node.exe"));
        LogPathStatus("api entry", Path.Combine(_projectRoot, "packages", "api", "dist", "cli.js"));
        LogPathStatus("green-package web standalone server", Path.Combine(_projectRoot, "packages", "green-package", "web", "server.cjs"));
        LogPathStatus("green-package web dist (Vite)", Path.Combine(_projectRoot, "packages", "green-package", "web", "dist", "index.html"));
        LogPathStatus("WebView2 loader", Path.Combine(_projectRoot, "WebView2Loader.dll"));
        LogPathStatus("WebView2 core dll", Path.Combine(_projectRoot, "Microsoft.Web.WebView2.Core.dll"));
        LogPathStatus("splash html", Path.Combine(_projectRoot, "assets", "splash.html"));
        LogPathStatus("release marker", Path.Combine(_projectRoot, ".office-claw-release.json"));
        LogWebView2RuntimeVersion();
    }

    private void LogVersion()
    {
        try
        {
            var releasePath = Path.Combine(_projectRoot, ".office-claw-release.json");
            if (!File.Exists(releasePath))
            {
                AppendLog("Release version: unknown (release marker not found)");
                return;
            }
            var content = File.ReadAllText(releasePath, Encoding.UTF8);
            var match = System.Text.RegularExpressions.Regex.Match(content, "\"version\"\\s*:\\s*\"([^\"]+)\"");
            var version = match.Success ? match.Groups[1].Value : "unknown";
            AppendLog("Release version: " + version);
        }
        catch (Exception ex)
        {
            AppendLog("Release version probe failed: " + ex.GetType().FullName + ": " + ex.Message);
        }
    }

    private void LogWebView2RuntimeVersion()
    {
        try
        {
            var version = CoreWebView2Environment.GetAvailableBrowserVersionString(null);
            if (string.IsNullOrWhiteSpace(version))
            {
                AppendLog("WebView2 runtime version: unavailable");
                return;
            }

            AppendLog("WebView2 runtime version: " + version);
        }
        catch (Exception ex)
        {
            AppendLog("WebView2 runtime version probe failed: " + ex.GetType().FullName + ": " + ex.Message);
        }
    }

    private void LogPathStatus(string label, string path)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                AppendLog("Path status [" + label + "]: empty");
                return;
            }

            if (File.Exists(path))
            {
                var fileInfo = new FileInfo(path);
                AppendLog(
                    "Path status [" + label + "]: file exists, size=" +
                    fileInfo.Length +
                    ", updated=" +
                    fileInfo.LastWriteTimeUtc.ToString("u") +
                    ", path=" +
                    path
                );
                return;
            }

            if (Directory.Exists(path))
            {
                var directoryInfo = new DirectoryInfo(path);
                AppendLog(
                    "Path status [" + label + "]: directory exists, updated=" +
                    directoryInfo.LastWriteTimeUtc.ToString("u") +
                    ", path=" +
                    path
                );
                return;
            }

            AppendLog("Path status [" + label + "]: missing, path=" + path);
        }
        catch (Exception ex)
        {
            AppendLog("Path status [" + label + "] failed: " + ex.GetType().FullName + ": " + ex.Message);
        }
    }

    private async Task EnsureCoreWebView2WithRetryAsync(WebView2 webView, string phase)
    {
        Exception lastError = null;
        for (var attempt = 1; attempt <= WebView2InitializationAttempts; attempt++)
        {
            _lifecycleCancellation.Token.ThrowIfCancellationRequested();
            bool shouldRetry = false;

            try
            {
                AppendLog(
                    "Initializing WebView2 (" +
                    phase +
                    "), attempt " +
                    attempt +
                    "/" +
                    WebView2InitializationAttempts +
                    "."
                );
                await webView.EnsureCoreWebView2Async().ConfigureAwait(true);
                AppendLog("WebView2 initialized (" + phase + ").");
                return;
            }
            catch (OperationCanceledException ex)
            {
                if (_lifecycleCancellation.IsCancellationRequested)
                {
                    AppendLog("WebView2 initialization canceled during shutdown (" + phase + ").");
                    throw;
                }
                // Unexpected cancellation from another source, treat as error
                lastError = ex;
                LogException(
                    "WebView2 initialization canceled unexpectedly (" +
                    phase +
                    ", attempt " +
                    attempt +
                    "/" +
                    WebView2InitializationAttempts +
                    ")",
                    ex
                );
                shouldRetry = attempt < WebView2InitializationAttempts;
            }
            catch (Exception ex)
            {
                lastError = ex;
                LogException(
                    "WebView2 initialization failed (" +
                    phase +
                    ", attempt " +
                    attempt +
                    "/" +
                    WebView2InitializationAttempts +
                    ")",
                    ex
                );
                shouldRetry = attempt < WebView2InitializationAttempts;
            }

            if (shouldRetry)
            {
                AppendLog("Retrying WebView2 initialization (" + phase + ") after failure.");
                await Task.Delay(WebView2InitializationRetryDelayMs, _lifecycleCancellation.Token).ConfigureAwait(true);
            }
        }

        throw new InvalidOperationException("WebView2 initialization failed after retries (" + phase + ").", lastError);
    }

    private async Task WaitForFrontendAsync(TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            TryRefreshFrontendUrlFromRuntimeState();
            if (await IsFrontendReadyAsync().ConfigureAwait(true))
            {
                return;
            }

            if (_serviceStartedByLauncher && _serviceHostProcess != null && _serviceHostProcess.HasExited)
            {
                throw new InvalidOperationException(
                    "Local services exited before the UI became ready. Check " + _logFilePath + " for details."
                );
            }

            await Task.Delay(1000).ConfigureAwait(true);
        }

        throw new TimeoutException("Timed out waiting for the frontend at " + _frontendUrl);
    }

    private int _frontendCheckFailCount = 0;

    private Task<bool> IsFrontendReadyAsync()
    {
        return Task.Run(() =>
        {
            try
            {
                var uri = new Uri(_frontendUrl);
                using (var client = new System.Net.Sockets.TcpClient())
                {
                    var ar = client.BeginConnect(uri.Host, uri.Port, null, null);
                    if (ar.AsyncWaitHandle.WaitOne(TimeSpan.FromSeconds(1.5)))
                    {
                        client.EndConnect(ar);
                        _frontendCheckFailCount = 0;
                        return true;
                    }
                    _frontendCheckFailCount++;
                    if (_frontendCheckFailCount == 1)
                        AppendLog("Frontend TCP check timed out (no response on " + _frontendUrl + " within 1.5s)");
                    return false;
                }
            }
            catch (Exception ex)
            {
                _frontendCheckFailCount++;
                if (_frontendCheckFailCount == 1)
                {
                    var sockEx = ex as System.Net.Sockets.SocketException;
                    if (sockEx != null)
                        AppendLog(string.Format("Frontend TCP check failed: SocketException ErrorCode={0}, message={1}", sockEx.ErrorCode, sockEx.Message));
                    else
                        AppendLog(string.Format("Frontend TCP check failed: {0}: {1}", ex.GetType().Name, ex.Message));
                }
                return false;
            }
        });
    }

    private async Task InitializeSplashWebViewAsync()
    {
        var userDataFolder = Path.Combine(_projectRoot, ".office-claw", "webview2");
        Directory.CreateDirectory(userDataFolder);

        _splashWebView = new WebView2
        {
            Dock = DockStyle.Fill,
            CreationProperties = new CoreWebView2CreationProperties
            {
                UserDataFolder = userDataFolder,
                AdditionalBrowserArguments = "--no-proxy-server",
            },
        };

        Controls.Add(_splashWebView);

        await EnsureCoreWebView2WithRetryAsync(_splashWebView, "splash").ConfigureAwait(true);

        var settings = _splashWebView.CoreWebView2.Settings;
        settings.IsStatusBarEnabled = false;
        var devToolsEnabled = IsSupportDevToolsEnabled();
        settings.AreDevToolsEnabled = devToolsEnabled;
        settings.AreDefaultContextMenusEnabled = devToolsEnabled;
        settings.IsZoomControlEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.IsPinchZoomEnabled = false;
        settings.IsPasswordAutosaveEnabled = true;
        settings.IsGeneralAutofillEnabled = false;
        settings.IsSwipeNavigationEnabled = false;

        _splashWebView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;

        var splashHtmlPath = Path.Combine(_projectRoot, "assets", "splash.html");
        if (File.Exists(splashHtmlPath))
        {
            _splashWebView.Source = new Uri("file:///" + splashHtmlPath.Replace("\\", "/"));
        }
        else
        {
            AppendLog("Warning: splash.html not found at " + splashHtmlPath);
        }

        PublishWindowState();
    }

    private async Task InitializeWebViewAsync()
    {
        var userDataFolder = Path.Combine(_projectRoot, ".office-claw", "webview2");
        Directory.CreateDirectory(userDataFolder);

        _webView = new WebView2
        {
            Dock = DockStyle.Fill,
            CreationProperties = new CoreWebView2CreationProperties
            {
                UserDataFolder = userDataFolder,
                AdditionalBrowserArguments = "--no-proxy-server",
            },
        };

        Controls.Add(_webView);
        if (_splashWebView != null && !_splashWebView.IsDisposed)
        {
            _webView.SendToBack();
        }

        await EnsureCoreWebView2WithRetryAsync(_webView, "main").ConfigureAwait(true);

        await _webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
            "(function(){" +
            "var LOGIN_STYLE_ID='clawder-login-hide';" +
            "var EXTERNAL_STYLE_ID='clawder-external-window-controls-style';" +
            "var EXTERNAL_ROOT_ID='clawder-external-window-controls';" +
            "var HEADER_BAR_ID='clawder-huawei-header-bar';" +
            "var MSG_MIN='window.minimize';" +
            "var MSG_MAX='window.toggleMaximize';" +
            "var MSG_CLOSE='window.close';" +
            "var MSG_SYNC='window.syncState';" +
            "var MSG_DRAG='window.startDrag';" +
            "function getBridge(){return window.chrome&&window.chrome.webview?window.chrome.webview:null;}" +
            "function post(msg){try{var b=getBridge();if(b&&b.postMessage)b.postMessage(msg);}catch(_){}}" +
            "function isLocalHost(){" +
            "try{" +
            "var host=(window.location&&window.location.hostname?window.location.hostname:'').toLowerCase();" +
            "if(!host)return false;" +
            "return host==='127.0.0.1'||host==='localhost'||host==='::1'||host==='[::1]';" +
            "}catch(_){return true;}" +
            "}" +
            "function isHuaweicloud(){" +
            "try{" +
            "var host=(window.location&&window.location.hostname?window.location.hostname:'').toLowerCase();" +
            "if(!host)return false;" +
            "return /\\.huaweicloud\\.com$/i.test(host);" +
            "}catch(_){return false;}" +
            "}" +
            "function ensureLoginCss(){" +
            "if(document.getElementById(LOGIN_STYLE_ID))return;" +
            "var style=document.createElement('style');" +
            "style.id=LOGIN_STYLE_ID;" +
            "var target=document.head||document.documentElement;" +
            "if(target)target.appendChild(style);" +
            "}" +
            "function ensureExternalControlsCss(){" +
            "if(document.getElementById(EXTERNAL_STYLE_ID))return;" +
            "var style=document.createElement('style');" +
            "style.id=EXTERNAL_STYLE_ID;" +
            "style.textContent='"
            + "#'+HEADER_BAR_ID+'{position:fixed;top:0;left:0;right:0;height:36px;z-index:2147483647;"
            + "background:transparent;display:flex;align-items:center;justify-content:flex-end;"
            + "font-family:Segoe UI,Arial,sans-serif;-webkit-app-region:drag;app-region:drag;"
            + "user-select:none;-webkit-user-select:none;}"
            + "#'+HEADER_BAR_ID+' .clawder-header-controls{-webkit-app-region:no-drag;app-region:no-drag;"
            + "display:flex;align-items:center;padding-right:12px;}"
            + "#'+HEADER_BAR_ID+' button{appearance:none;-webkit-appearance:none;width:36px;height:36px;border:none;"
            + "background:transparent;color:#434343;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;"
            + "transition:background-color .15s ease,color .15s ease;-webkit-app-region:no-drag;app-region:no-drag;}"
            + "#'+HEADER_BAR_ID+' button:hover{background:rgba(0,0,0,.08);color:#1f1f1f}"
            + "#'+HEADER_BAR_ID+' button[data-role=close]:hover{background:#e5484d;color:#fff}"
            + "#'+HEADER_BAR_ID+' button:focus-visible{outline:2px solid #2563eb;outline-offset:-2px}"
            + "#'+HEADER_BAR_ID+' svg{width:20px;height:20px;pointer-events:none}"
            + "#'+HEADER_BAR_ID+' .clawder-restore{display:none}"
            + "#'+HEADER_BAR_ID+'[data-maximized=true] .clawder-max{display:none}"
            + "#'+HEADER_BAR_ID+'[data-maximized=true] .clawder-restore{display:block}"
            + "#clawder-external-window-controls{position:fixed;top:0;right:0;z-index:2147483647;display:flex;align-items:center;"
            + "background:rgba(255,255,255,.85);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);"
            + "border:1px solid rgba(0,0,0,.08);border-top:none;border-right:none;border-bottom-left-radius:10px;"
            + "overflow:hidden;font-family:Segoe UI,Arial,sans-serif}"
            + "#clawder-external-window-controls button{appearance:none;-webkit-appearance:none;width:38px;height:30px;border:none;"
            + "background:transparent;color:#434343;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;"
            + "transition:background-color .15s ease,color .15s ease}"
            + "#clawder-external-window-controls button:hover{background:rgba(0,0,0,.08);color:#1f1f1f}"
            + "#clawder-external-window-controls button[data-role=close]:hover{background:#e5484d;color:#fff}"
            + "#clawder-external-window-controls button:focus-visible{outline:2px solid #2563eb;outline-offset:-2px}"
            + "#clawder-external-window-controls svg{width:20px;height:20px;pointer-events:none}"
            + "#clawder-external-window-controls .clawder-restore{display:none}"
            + "#clawder-external-window-controls[data-maximized=true] .clawder-max{display:none}"
            + "#clawder-external-window-controls[data-maximized=true] .clawder-restore{display:block}"
            + "';" +
            "var target=document.head||document.documentElement;" +
            "if(target)target.appendChild(style);" +
            "}" +
            "function setMaximizedState(isMax){" +
            "var header=document.getElementById(HEADER_BAR_ID);" +
            "if(header){header.setAttribute('data-maximized',isMax?'true':'false');"
            + "var maxBtn=header.querySelector('button[data-role=maximize]');"
            + "if(maxBtn){maxBtn.title=isMax?'还原':'最大化';maxBtn.setAttribute('aria-label',isMax?'还原':'最大化');}}" +
            "var root=document.getElementById(EXTERNAL_ROOT_ID);" +
            "if(!root)return;" +
            "root.setAttribute('data-maximized',isMax?'true':'false');" +
            "var maxBtn=root.querySelector('button[data-role=maximize]');" +
            "if(maxBtn){maxBtn.title=isMax?'还原':'最大化';maxBtn.setAttribute('aria-label',isMax?'还原':'最大化');}" +
            "}" +
            "function createHeaderBar(){" +
            "var bridge=getBridge();" +
            "if(!bridge)return;" +
            "if(!isHuaweicloud())return;" +
            "ensureExternalControlsCss();" +
            "if(document.getElementById(HEADER_BAR_ID))return;" +
            "var header=document.createElement('div');" +
            "header.id=HEADER_BAR_ID;" +
            "header.setAttribute('data-maximized','false');" +
            "header.innerHTML='" +
            "<div class=\"clawder-header-controls\">"
            + "<button type=\"button\" data-role=\"minimize\" title=\"最小化\" aria-label=\"最小化\">"
            + "<svg viewBox=\"0 0 16 16\" fill=\"none\"><path d=\"M4 8H12\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\"/></svg>"
            + "</button>"
            + "<button type=\"button\" data-role=\"maximize\" title=\"最大化\" aria-label=\"最大化\">"
            + "<svg class=\"clawder-max\" viewBox=\"0 0 16 16\" fill=\"none\"><rect x=\"4.25\" y=\"4.25\" width=\"7.5\" height=\"7.5\" rx=\"0.9\" stroke=\"currentColor\" stroke-width=\"1.2\"/></svg>"
            + "<svg class=\"clawder-restore\" viewBox=\"0 0 16 16\" fill=\"none\"><path d=\"M5.75 4.25H10.1C10.984 4.25 11.7 4.966 11.7 5.85V10.2\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M10.25 5.75H5.9C5.016 5.75 4.3 6.466 4.3 7.35V11.1C4.3 11.984 5.016 12.7 5.9 12.7H10.25C11.134 12.7 11.85 11.984 11.85 11.1V7.35C11.85 6.466 11.134 5.75 10.25 5.75Z\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/></svg>"
            + "</button>"
            + "<button type=\"button\" data-role=\"close\" title=\"关闭\" aria-label=\"关闭\">"
            + "<svg viewBox=\"0 0 16 16\" fill=\"none\"><path d=\"M5 5L11 11\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\"/><path d=\"M11 5L5 11\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\"/></svg>"
            + "</button>"
            + "</div>';" +
            "var parent=document.body||document.documentElement;" +
            "if(parent)parent.appendChild(header);" +
            "var minBtn=header.querySelector('button[data-role=minimize]');" +
            "var maxBtn=header.querySelector('button[data-role=maximize]');" +
            "var closeBtn=header.querySelector('button[data-role=close]');" +
            "if(minBtn)minBtn.addEventListener('click',function(e){e.stopPropagation();post(MSG_MIN);});" +
            "if(maxBtn)maxBtn.addEventListener('click',function(e){e.stopPropagation();post(MSG_MAX);});" +
            "if(closeBtn)closeBtn.addEventListener('click',function(e){e.stopPropagation();post(MSG_CLOSE);});" +
            "header.addEventListener('mousedown',function(e){if(e.target.closest('button'))return;post(MSG_DRAG);});" +
            "post(MSG_SYNC);" +
            "}" +
            "function ensureExternalControls(){" +
            "var bridge=getBridge();" +
            "if(!bridge){return;}" +
            "if(!isHuaweicloud()){" +
            "var oldRoot=document.getElementById(EXTERNAL_ROOT_ID);" +
            "if(oldRoot&&oldRoot.parentNode)oldRoot.parentNode.removeChild(oldRoot);" +
            "var oldHeader=document.getElementById(HEADER_BAR_ID);" +
            "if(oldHeader&&oldHeader.parentNode)oldHeader.parentNode.removeChild(oldHeader);" +
            "return;" +
            "}" +
            "}" +
            "function bindStateListener(){" +
            "var bridge=getBridge();" +
            "if(!bridge||!bridge.addEventListener||window.__clawderExternalWindowControlsBound)return;" +
            "window.__clawderExternalWindowControlsBound=true;" +
            "bridge.addEventListener('message',function(event){" +
            "var data=event?event.data:null;" +
            "if(!data||typeof data!=='object')return;" +
            "if(data.type!=='window.state')return;" +
            "var payload=data.payload||{};" +
            "setMaximizedState(!!payload.isMaximized);" +
            "});" +
            "}" +
            "function boot(){" +
            "ensureLoginCss();" +
            "bindStateListener();" +
            "createHeaderBar();" +
            "ensureExternalControls();" +
            "}" +
            "if(document.readyState==='loading'){" +
            "document.addEventListener('DOMContentLoaded',boot,{once:true});" +
            "}else{" +
            "boot();" +
            "}" +
            "})();"
        ).ConfigureAwait(true);

var settings = _webView.CoreWebView2.Settings;
        settings.IsStatusBarEnabled = false;
        var devToolsEnabled = IsSupportDevToolsEnabled();
        settings.AreDevToolsEnabled = devToolsEnabled;
        // 屏蔽右键菜单，但保留键盘快捷键（Ctrl+C 复制、Ctrl+V 粘贴、Ctrl+A 全选等）
        settings.AreDefaultContextMenusEnabled = devToolsEnabled;
        settings.IsZoomControlEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.IsPinchZoomEnabled = false;
        settings.IsPasswordAutosaveEnabled = true;
        settings.IsGeneralAutofillEnabled = false;
        settings.IsSwipeNavigationEnabled = false;

        _webView.CoreWebView2.NewWindowRequested += OnNewWindowRequested;
        _webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
        _webView.CoreWebView2.ProcessFailed += (_, eventArgs) =>
        {
            AppendLog("WebView2 process failed: " + eventArgs.ProcessFailedKind);
        };
        _webView.CoreWebView2.NavigationCompleted += async (_, eventArgs) =>
        {
            PublishWindowState();
            if (!_mainWebViewShown && eventArgs.IsSuccess)
            {
                RevealMainWebView();
            }

            if (!_mainWebViewShown && !eventArgs.IsSuccess)
            {
                AppendLog("Main WebView navigation failed before splash handoff: " + eventArgs.WebErrorStatus);
            }

            if (eventArgs.IsSuccess)
            {
                await InjectLoginCssAsync().ConfigureAwait(true);
                NavigateToThreadIfReady(_pendingActivationThreadId);
            }
        };
        _webView.Source = new Uri(_frontendUrl);
    }

    private void RevealMainWebView()
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action)RevealMainWebView);
            return;
        }

        if (_mainWebViewShown)
        {
            return;
        }

        _mainWebViewShown = true;
        _webView.BringToFront();

        if (_splashWebView != null && !_splashWebView.IsDisposed)
        {
            Controls.Remove(_splashWebView);
            _splashWebView.Dispose();
            _splashWebView = null;
        }
    }

    private async Task InjectLoginCssAsync()
    {
        if (_webView == null || _webView.IsDisposed || _webView.CoreWebView2 == null)
        {
            return;
        }

        try
        {
            var huaweiScript =
                "(function(){" +
                "var urls={" +
                "'注册':'https://id5.cloud.huawei.com/UnifiedIDMPortal/portal/userRegister/regbyemail.html?themeName=red&access_type=offline&clientID=103493351&loginChannel=88000000&loginUrl=https%3A%2F%2Fauth.huaweicloud.com%2Fauthui%2Flogin.html%23&casLoginUrl=https%3A%2F%2Fauth.huaweicloud.com%2Fauthui%2FcasLogin&service=https%3A%2F%2Fauth.huaweicloud.com%2Fauthui%2FcasLogin&countryCode=th&scope=https%3A%2F%2Fwww.huawei.com%2Fauth%2Faccount%2Funified.profile+https%3A%2F%2Fwww.huawei.com%2Fauth%2Faccount%2Frisk.idstate&reqClientType=88&state=8d71793cbfd845e38ed4b62fc6801a8a&lang=zh-cn'," +
                "'忘记密码':'https://id5.cloud.huawei.com/UnifiedIDMPortal/portal/resetPwd/forgetbyid.html?reqClientType=88&loginChannel=88000000&regionCode=th&loginUrl=https%3A%2F%2Fauth.huaweicloud.com%2Fauthui%2Flogin.html%23%2FhwIDLogin&lang=zh-cn&themeName=lightred&clientID=103493351&service=https%3A%2F%2Fauth.huaweicloud.com%2Fauthui%2FcasLogin%3Fservice%3Dhttps%253A%252F%252Fversatile.cn-north-4.myhuaweicloud.com%252Fv1%252Fclaw%252Fcas%252Flogin%252Fcallback&refererPage=unified_login&srcScenID=6000014&state=3873d9b02024477f910a0c9585fa53ad#/forgetPwd/forgetbyid'," +
                "'忘记账号名':'https://reg.huaweicloud.com/registerui/cn/index.html#/account/forgotName'" +
                "};" +
                "function isHuaweicloud(){try{var h=location.hostname;return h&&/\\.huaweicloud\\.com$/i.test(h)}catch(e){return false}}" +
                "function replaceSpans(){if(!isHuaweicloud())return;Object.keys(urls).forEach(function(text){var result=document.evaluate('//span[contains(@class,\"hwid-vertical-align\") and normalize-space(text())=\"'+text+'\"]',document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);for(var i=0;i<result.snapshotLength;i++){var s=result.snapshotItem(i);if(s.tagName==='A')continue;var linkUrl=urls[text];var parent=s.parentNode;var hwidLinkAncestor=null;while(parent&&parent!==document){if(parent.classList&&parent.classList.contains('hwid-link')){hwidLinkAncestor=parent;break}parent=parent.parentNode}if(hwidLinkAncestor){var p=s.parentNode;while(p&&p!==hwidLinkAncestor.parentNode){(function(el,url){el.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();window.open(url,'_blank','noopener,noreferrer')},true)})(p,linkUrl);p=p.parentNode}}var a=document.createElement('a');a.href=linkUrl;a.className=s.className;a.textContent=s.textContent;a.style.cssText='font-size:14px;color:#000;';a.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();window.open(this.href,'_blank','noopener,noreferrer')});a.addEventListener('mouseenter',function(){this.style.color='#526ecc'});a.addEventListener('mouseleave',function(){this.style.color='#000'});s.parentNode.replaceChild(a,s)}})}" +
                "replaceSpans();" +
                "function fixPrivacyLinks(){if(!isHuaweicloud())return;var container=document.querySelector('.privacyMsg');if(!container)return;var links=container.querySelectorAll('a');for(var i=0;i<links.length;i++){var a=links[i];a.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();window.open(this.href,'_blank','noopener,noreferrer')},true)}}" +
                "fixPrivacyLinks();" +
                "function hideElements(){if(!isHuaweicloud())return;var html=document.documentElement;if(html)html.style.setProperty('min-width','0','important');var body=document.body;if(body)body.style.setProperty('min-width','0','important');var idp=document.getElementById('idpLinkDiv');if(idp)idp.style.display='none';var eChannel=document.getElementById('eChannelLinkDiv');if(eChannel)eChannel.style.display='none';var vmall=document.getElementById('vmallLinkDiv');if(vmall)vmall.style.display='none';var idpLogin=document.getElementById('idpLoginLinkDiv');if(idpLogin)idpLogin.style.display='none';var intervals=document.querySelectorAll('#hwAccountLinkDiv ~ .intervalDiv');for(var i=0;i<intervals.length;i++){intervals[i].style.display='none'}}" +
                "hideElements();" +
                "function fixForgetPwdLink(){if(!isHuaweicloud())return;var container=document.querySelector('.forgetPwdLink');if(!container)return;var forgetPwdUrl='https://auth.huaweicloud.com/authui/login.html?locale=zh-cn&UserType=e&service=https%3A%2F%2Fversatile.cn-north-4.myhuaweicloud.com%2Fv1%2Fclaw%2Fcas%2Flogin%2Fcallback#/fpwd';var links=container.querySelectorAll('a');for(var i=0;i<links.length;i++){var a=links[i];if(a.textContent.trim()==='忘记密码'){a.className='loginBottomColor';a.removeAttribute('ng-click');a.href=forgetPwdUrl;a.addEventListener('click',function(e){e.preventDefault();e.stopImmediatePropagation();window.open(this.href,'_blank','noopener,noreferrer')},true);break}}var spans=container.querySelectorAll('span');for(var i=0;i<spans.length;i++){var s=spans[i];if(s.textContent.trim()==='忘记密码'){var a=document.createElement('a');a.href=forgetPwdUrl;a.textContent='忘记密码';a.style.cssText='font-size:14px;color:rgba(0,0,0,.5);';a.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();window.open(this.href,'_blank','noopener,noreferrer')});a.addEventListener('mouseenter',function(){this.style.color='#526ecc';this.style.textDecoration='none'});a.addEventListener('mouseleave',function(){this.style.color='rgba(0,0,0,.5)'});s.parentNode.replaceChild(a,s);break}}}" +
                "fixForgetPwdLink();" +
                "function styleLoginAdv(){if(!isHuaweicloud())return;var container=document.getElementById('loginAdv');if(!container)return;var img=document.getElementById('loginAdImgDefault');if(img)img.style.marginRight='20px';var links=container.querySelectorAll('a');for(var i=0;i<links.length;i++){var a=links[i];a.removeAttribute('href');a.removeAttribute('target')}}" +
                "styleLoginAdv();" +
                "if(document.readyState!=='complete'){document.addEventListener('DOMContentLoaded',function(){replaceSpans();fixPrivacyLinks();hideElements();fixForgetPwdLink();styleLoginAdv()})}" +
                "new MutationObserver(function(){replaceSpans();fixPrivacyLinks();hideElements();fixForgetPwdLink();styleLoginAdv()}).observe(document.documentElement,{childList:true,subtree:true});" +
                "})();";
            await _webView.CoreWebView2.ExecuteScriptAsync(huaweiScript).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            AppendLog("Failed to inject Huawei register link script: " + ex.Message);
        }
    }

    private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs eventArgs)
    {
        eventArgs.Handled = true;
        try
        {
            Process.Start(new ProcessStartInfo(eventArgs.Uri) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            AppendLog("Failed to open external link: " + ex.Message);
        }
    }

    private void StopManagedServices()
    {
        try
        {
            var stopScript = Path.Combine(_projectRoot, "scripts", "stop-windows.ps1");
            if (File.Exists(stopScript))
            {
                var powerShellPath = ResolveWindowsPowerShellPath();
                var stopInfo = new ProcessStartInfo
                {
                    FileName = powerShellPath,
                    Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + stopScript + "\"",
                    WorkingDirectory = _projectRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };

                using (var stopProcess = Process.Start(stopInfo))
                {
                    if (stopProcess != null && !stopProcess.WaitForExit(15000))
                    {
                        stopProcess.Kill();
                    }
                }
            }
        }
        catch (Exception ex)
        {
            AppendLog("Failed stopping services cleanly: " + ex.Message);
        }
        finally
        {
            try
            {
                if (_serviceHostProcess != null && !_serviceHostProcess.HasExited)
                {
                    _serviceHostProcess.Kill();
                    _serviceHostProcess.WaitForExit(5000);
                }
            }
            catch (Exception ex)
            {
                AppendLog("Failed terminating service host: " + ex.Message);
            }
        }
    }

    /// <summary>
    /// Stops managed services asynchronously without blocking the UI.
    /// The PowerShell process will continue running even after this application exits.
    /// </summary>
    private void StopManagedServicesAsync()
    {
        try
        {
            var stopScript = Path.Combine(_projectRoot, "scripts", "stop-windows.ps1");
            if (File.Exists(stopScript))
            {
                AppendLog("Starting stop-windows.ps1 in background...");

                // Start PowerShell process without waiting
                // It will continue running even after this app exits
                var powerShellPath = ResolveWindowsPowerShellPath();
                var stopInfo = new ProcessStartInfo
                {
                    FileName = powerShellPath,
                    Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + stopScript + "\"",
                    WorkingDirectory = _projectRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };

                Process.Start(stopInfo);
            }

            // Kill serviceHostProcess immediately if it's still running
            // This is a fallback in case stop-windows.ps1 takes too long
            if (_serviceHostProcess != null && !_serviceHostProcess.HasExited)
            {
                AppendLog("Terminating service host process...");
                _serviceHostProcess.Kill();
            }
        }
        catch (Exception ex)
        {
            AppendLog("Failed starting stop script: " + ex.Message);
        }
    }

    private void LogException(string context, Exception exception)
    {
        if (exception == null)
        {
            AppendLog(context + ": <null exception>");
            return;
        }

        var current = exception;
        var depth = 0;
        while (current != null)
        {
            AppendLog(
                context +
                " [" +
                depth +
                "]: type=" +
                current.GetType().FullName +
                ", hresult=0x" +
                current.HResult.ToString("X8") +
                ", message=" +
                current.Message
            );
            if (!string.IsNullOrWhiteSpace(current.StackTrace))
            {
                AppendLog(context + " [" + depth + "] stack: " + current.StackTrace);
            }

            current = current.InnerException;
            depth++;
        }
    }

    private string GetServiceErrorSummary()
    {
        string[] lines;
        lock (_serviceOutputTail)
        {
            if (_serviceOutputTail.Count == 0) return "";
            lines = _serviceOutputTail.ToArray();
        }

        var errLines = new List<string>();
        foreach (var line in lines)
        {
            var trimmed = line.Trim();
            if (trimmed.Contains("[ERR]") || trimmed.Contains("[stderr]")
                || trimmed.Contains("[WARN]") && (trimmed.Contains("stopped") || trimmed.Contains("failed") || trimmed.Contains("exit")))
            {
                errLines.Add(trimmed);
            }
        }

        if (errLines.Count == 0)
        {
            for (int i = Math.Max(0, lines.Length - 10); i < lines.Length; i++)
            {
                errLines.Add(lines[i].Trim());
            }
        }

        var sb = new StringBuilder();
        sb.AppendLine();
        sb.AppendLine("── 服务进程错误输出 ──");
        foreach (var line in errLines)
        {
            sb.AppendLine(TruncateForDialog(line, 180));
        }
        sb.Append("──");
        return sb.ToString();
    }

    private string BuildStartupErrorMessage(Exception exception)
    {
        var builder = new StringBuilder();
        builder.AppendLine("OfficeClaw 没有成功启动");
        builder.AppendLine();
        builder.AppendLine("程序已停止启动，避免继续停留在不可用状态。");
        builder.AppendLine("可能原因：" + DescribeStartupFailure(exception));

        var observation = DescribeStartupObservation();
        if (!string.IsNullOrWhiteSpace(observation))
        {
            builder.AppendLine();
            builder.AppendLine("检测结果：" + observation);
        }

        var serviceErrors = GetServiceErrorSummary();
        if (!string.IsNullOrWhiteSpace(serviceErrors))
        {
            builder.AppendLine(serviceErrors);
        }

        builder.AppendLine();
        builder.AppendLine("请按顺序尝试：");

        var steps = BuildTroubleshootingSteps(exception);
        for (var index = 0; index < steps.Length; index++)
        {
            builder.AppendLine((index + 1).ToString() + ". " + steps[index]);
        }

        builder.AppendLine();
        builder.AppendLine("如需反馈，请附上日志文件：");
        builder.AppendLine(_logFilePath);
        builder.AppendLine();
        builder.AppendLine("错误摘要：" + TruncateForDialog(GetInnermostExceptionMessage(exception), 320));
        return builder.ToString().TrimEnd();
    }

    private string DescribeStartupFailure(Exception exception)
    {
        var combinedMessage = BuildStartupDiagnosticText(exception).ToLowerInvariant();
        if (combinedMessage.Contains("missing startup script") || combinedMessage.Contains("start-windows.ps1"))
        {
            return "启动脚本缺失，安装内容可能不完整。";
        }

        if (combinedMessage.Contains("webview2 initialization failed"))
        {
            return "内置浏览器初始化失败，可能是 WebView2 运行时缺失、损坏或被系统策略拦截。";
        }

        if (
            combinedMessage.Contains("dll load failed") ||
            combinedMessage.Contains("vcruntime") ||
            combinedMessage.Contains("msvcp") ||
            combinedMessage.Contains("greenlet")
        )
        {
            return "运行时依赖加载失败，可能是 VC++ 运行时库缺失、损坏，或安装包文件不完整。";
        }

        if (
            combinedMessage.Contains("err_module_not_found") ||
            combinedMessage.Contains("cannot find package") ||
            combinedMessage.Contains("cannot find module") ||
            combinedMessage.Contains("api build artifact not found")
        )
        {
            return "本地服务依赖加载失败，安装包可能缺少必要的 npm 模块或构建产物。";
        }

        if (combinedMessage.Contains("eaddrinuse") || (combinedMessage.Contains("port") && combinedMessage.Contains("in use")))
        {
            return "本地服务端口被占用，API 或前端无法监听需要的端口。";
        }

        if (
            combinedMessage.Contains("redis start failed") ||
            combinedMessage.Contains("redis port") ||
            combinedMessage.Contains("wrongpass") ||
            combinedMessage.Contains("noauth")
        )
        {
            return "Redis 启动或连接失败，可能是端口占用、密码不匹配或 Redis 数据目录不可用。";
        }

        if (
            combinedMessage.Contains("frontend failed to become ready") ||
            combinedMessage.Contains("web dist not found") ||
            combinedMessage.Contains("web build not found") ||
            combinedMessage.Contains("vite not found") ||
            combinedMessage.Contains("server.cjs") ||
            combinedMessage.Contains("dist/index.html")
        )
        {
            return "前端服务没有成功启动，可能是前端运行文件缺失或静态服务启动失败。";
        }

        if (combinedMessage.Contains("api failed to become ready"))
        {
            return "API 服务没有成功启动，可能是依赖、配置、端口或运行时环境异常。";
        }

        if (combinedMessage.Contains("local services exited before the ui became ready"))
        {
            return "本地服务在界面准备完成前就退出了。";
        }

        if (combinedMessage.Contains("timed out waiting for the frontend"))
        {
            return "前端服务启动超时。";
        }

        if (combinedMessage.Contains("failed to start local services"))
        {
            return "本地服务进程没有成功拉起。";
        }

        return "启动过程中出现未预期错误。";
    }

    private string DescribeStartupObservation()
    {
        var observations = new List<string>();
        var startScript = Path.Combine(_projectRoot, "scripts", "start-windows.ps1");
        var bundledNode = Path.Combine(_projectRoot, "tools", "node", "node.exe");
        var apiEntry = Path.Combine(_projectRoot, "packages", "api", "dist", "cli.js");
        var webEntry = Path.Combine(_projectRoot, "packages", "green-package", "web", "server.cjs");

        if (!File.Exists(startScript))
        {
            observations.Add("缺少 scripts/start-windows.ps1");
        }
        if (!File.Exists(bundledNode))
        {
            observations.Add("缺少 tools/node/node.exe");
        }
        if (!File.Exists(apiEntry))
        {
            observations.Add("缺少 packages/api/dist/cli.js");
        }
        if (!File.Exists(webEntry))
        {
            observations.Add("缺少 packages/green-package/web/server.cjs");
        }

        if (observations.Count == 0)
        {
            observations.Add(
                WasFileUpdatedDuringCurrentLaunch(_runtimeStatePath)
                    ? "关键文件存在，服务状态已刷新"
                    : "关键文件存在，但服务没有完成启动"
            );
        }

        return string.Join("；", observations.ToArray());
    }

    private string[] BuildTroubleshootingSteps(Exception exception)
    {
        var combinedMessage = BuildStartupDiagnosticText(exception).ToLowerInvariant();
        var apiLogPath = Path.Combine(_projectRoot, "data", "logs", "api", "api.log");
        var startupLogDir = Path.Combine(_projectRoot, "logs", "startup");

        if (combinedMessage.Contains("missing startup script") || combinedMessage.Contains("start-windows.ps1"))
        {
            return new[]
            {
                "重新运行 OfficeClaw 安装包，选择相同安装目录完成修复安装。",
                "如果安全软件提示拦截或隔离 OfficeClaw 文件，请恢复文件并加入信任。",
                "修复后重新打开 OfficeClaw；如果仍失败，请把日志文件发给支持人员。",
            };
        }

        if (combinedMessage.Contains("webview2 initialization failed"))
        {
            return new[]
            {
                "重新运行 OfficeClaw 安装包，让安装程序检查并修复 WebView2 Runtime。",
                "如果安装包提示需要管理员权限，请选择允许并等待安装完成。",
                "安装完成后重新打开 OfficeClaw；如果仍失败，请重启 Windows 后再试。",
            };
        }

        if (
            combinedMessage.Contains("dll load failed") ||
            combinedMessage.Contains("vcruntime") ||
            combinedMessage.Contains("msvcp") ||
            combinedMessage.Contains("greenlet")
        )
        {
            return new[]
            {
                "重新运行 OfficeClaw 安装包，让安装程序检查并修复 VC++ 运行时库。",
                "如果安装过程中提示需要重启，请重启 Windows 后再打开 OfficeClaw。",
                "如果重启后仍失败，请把日志文件发给支持人员。",
            };
        }

        if (
            combinedMessage.Contains("err_module_not_found") ||
            combinedMessage.Contains("cannot find package") ||
            combinedMessage.Contains("cannot find module") ||
            combinedMessage.Contains("api build artifact not found")
        )
        {
            return new[]
            {
                "重新运行 OfficeClaw 安装包，选择相同安装目录完成修复安装。",
                "如果安全软件提示隔离或删除 OfficeClaw 文件，请恢复文件并加入信任。",
                "如果仍失败，请把启动日志目录发给支持人员。启动日志目录：" + startupLogDir,
            };
        }

        if (combinedMessage.Contains("eaddrinuse") || (combinedMessage.Contains("port") && combinedMessage.Contains("in use")))
        {
            return new[]
            {
                "先关闭 OfficeClaw，再重新打开一次。",
                "如果仍失败，请重启 Windows 后再打开，排除残留进程或端口占用。",
                "如果配置过自定义端口，请检查 .env 中的 API_SERVER_PORT、FRONTEND_PORT、REDIS_PORT。",
            };
        }

        if (
            combinedMessage.Contains("redis start failed") ||
            combinedMessage.Contains("redis port") ||
            combinedMessage.Contains("wrongpass") ||
            combinedMessage.Contains("noauth")
        )
        {
            return new[]
            {
                "先关闭 OfficeClaw，再重新打开一次。",
                "如果仍失败，请重启 Windows 后再打开，排除 Redis 残留进程或端口占用。",
                "如果配置过 REDIS_URL，请检查 .env 中的 Redis 地址和密码是否正确。",
            };
        }

        if (
            combinedMessage.Contains("frontend failed to become ready") ||
            combinedMessage.Contains("web dist not found") ||
            combinedMessage.Contains("web build not found") ||
            combinedMessage.Contains("vite not found")
        )
        {
            return new[]
            {
                "先关闭 OfficeClaw，再重新打开一次。",
                "如果仍失败，请重新运行 OfficeClaw 安装包修复前端运行文件。",
                "如果问题持续存在，请把启动日志目录发给支持人员。启动日志目录：" + startupLogDir,
            };
        }

        if (combinedMessage.Contains("api failed to become ready"))
        {
            return new[]
            {
                "先关闭 OfficeClaw，再重新打开一次。",
                "如果仍失败，请重新运行 OfficeClaw 安装包修复 API 运行文件和运行时依赖。",
                "如果问题持续存在，请把启动日志和 API 日志发给支持人员。启动日志目录：" + startupLogDir + "；API 日志位置：" + apiLogPath,
            };
        }

        if (
            combinedMessage.Contains("local services exited before the ui became ready") ||
            combinedMessage.Contains("timed out waiting for the frontend") ||
            combinedMessage.Contains("failed to start local services")
        )
        {
            return new[]
            {
                "先关闭 OfficeClaw，再重新打开一次。",
                "如果仍然失败，请重启 Windows 后再打开，排除端口占用或残留进程影响。",
                "如果重启后仍失败，请把启动器日志、启动日志和 API 日志发给支持人员。启动日志目录：" + startupLogDir + "；API 日志位置：" + apiLogPath,
            };
        }

        return new[]
        {
            "先关闭 OfficeClaw，再重新打开一次。",
            "如果仍然失败，请重新运行 OfficeClaw 安装包修复程序文件和运行时依赖。",
            "如果修复后仍失败，请重启 Windows；问题持续存在时，把启动器日志、启动日志和 API 日志发给支持人员。启动日志目录：" + startupLogDir + "；API 日志位置：" + apiLogPath,
        };
    }

    private string BuildStartupDiagnosticText(Exception exception)
    {
        var builder = new StringBuilder();
        builder.Append(FlattenExceptionMessages(exception));
        var startupLogs = ReadRecentStartupLogs(80);
        if (!string.IsNullOrWhiteSpace(startupLogs))
        {
            builder.Append(" | ");
            builder.Append(startupLogs);
        }
        return builder.ToString();
    }

    private string ReadRecentStartupLogs(int maxLinesPerFile)
    {
        var startupLogDir = Path.Combine(_projectRoot, "logs", "startup");
        var files = new[]
        {
            _logFilePath,
            Path.Combine(startupLogDir, "api.stderr.log"),
            Path.Combine(startupLogDir, "api.stdout.log"),
            Path.Combine(startupLogDir, "frontend.stderr.log"),
            Path.Combine(startupLogDir, "frontend.stdout.log"),
        };

        var builder = new StringBuilder();
        foreach (var file in files)
        {
            AppendRecentFileLines(builder, file, maxLinesPerFile);
        }
        return builder.ToString();
    }

    private static void AppendRecentFileLines(StringBuilder builder, string path, int maxLines)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
            {
                return;
            }

            var lines = File.ReadAllLines(path);
            var start = Math.Max(0, lines.Length - Math.Max(1, maxLines));
            if (builder.Length > 0)
            {
                builder.Append(" | ");
            }
            builder.Append(Path.GetFileName(path));
            builder.Append(": ");
            for (var index = start; index < lines.Length; index++)
            {
                if (index > start)
                {
                    builder.Append(" ");
                }
                builder.Append(lines[index]);
            }
        }
        catch
        {
        }
    }

    private bool WasFileUpdatedDuringCurrentLaunch(string path)
    {
        try
        {
            if (!File.Exists(path))
            {
                return false;
            }

            return File.GetLastWriteTimeUtc(path) >= _startupStartedAtUtc.AddSeconds(-1);
        }
        catch
        {
            return false;
        }
    }

    private static string FlattenExceptionMessages(Exception exception)
    {
        if (exception == null)
        {
            return string.Empty;
        }

        var builder = new StringBuilder();
        var current = exception;
        while (current != null)
        {
            if (builder.Length > 0)
            {
                builder.Append(" | ");
            }
            builder.Append(current.Message);
            current = current.InnerException;
        }

        return builder.ToString();
    }

    private static string GetInnermostExceptionMessage(Exception exception)
    {
        if (exception == null)
        {
            return "未知错误";
        }

        var current = exception;
        while (current.InnerException != null)
        {
            current = current.InnerException;
        }

        return current.Message;
    }

    private static string TruncateForDialog(string value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length <= maxLength)
        {
            return string.IsNullOrWhiteSpace(value) ? "未知错误" : value;
        }

        return value.Substring(0, maxLength) + "...";
    }

    private void AppendLog(string message)
    {
        _crashLogger.AppendLog(message);
    }

    private void AddServiceOutputLine(string line)
    {
        lock (_serviceOutputTail)
        {
            if (_serviceOutputTail.Count >= MaxServiceOutputTailLines)
            {
                _serviceOutputTail.RemoveAt(0);
            }
            _serviceOutputTail.Add(line);
        }
    }
}

internal sealed class CloseConfirmationDialog : IDisposable
{
    private const int RadioMinimize = 1000;
    private const int RadioExit = 1001;
    private const int IDOK = 1;
    private const uint TDCBF_OK_BUTTON = 0x0001;
    private const uint TDCBF_CANCEL_BUTTON = 0x0008;
    private const uint TDF_ALLOW_DIALOG_CANCELLATION = 0x0008;

    private bool _shouldMinimize = true;
    private bool _dontAskAgain;
    public bool ShouldMinimize { get { return _shouldMinimize; } }
    public bool DontAskAgain { get { return _dontAskAgain; } }

    public DialogResult ShowDialog(IWin32Window owner)
    {
        var radioButtons = new[]
        {
            new TASKDIALOG_BUTTON { nButtonID = RadioMinimize, pszButtonText = "最小化到托盘（继续运行）" },
            new TASKDIALOG_BUTTON { nButtonID = RadioExit, pszButtonText = "直接退出（关闭应用）" },
        };

        int buttonSize = Marshal.SizeOf<TASKDIALOG_BUTTON>();
        IntPtr pRadioButtons = Marshal.AllocHGlobal(buttonSize * radioButtons.Length);
        try
        {
            for (int i = 0; i < radioButtons.Length; i++)
                Marshal.StructureToPtr(radioButtons[i], pRadioButtons + i * buttonSize, false);

            var config = new TASKDIALOGCONFIG
            {
                cbSize = (uint)Marshal.SizeOf<TASKDIALOGCONFIG>(),
                hwndParent = owner != null ? owner.Handle : IntPtr.Zero,
                dwFlags = TDF_ALLOW_DIALOG_CANCELLATION,
                dwCommonButtons = TDCBF_OK_BUTTON | TDCBF_CANCEL_BUTTON,
                pszWindowTitle = "OfficeClaw",
                hMainIcon = new IntPtr(0xFFFD),
                pszMainInstruction = "关闭窗口时，您希望如何处理？",
                pszVerificationText = "不再提示",
                cRadioButtons = (uint)radioButtons.Length,
                pRadioButtons = pRadioButtons,
                nDefaultRadioButton = RadioMinimize,
            };

            int buttonId;
            int radioId;
            bool verificationFlag;
            int hr = TaskDialogIndirect(ref config, out buttonId, out radioId, out verificationFlag);
            if (hr < 0) Marshal.ThrowExceptionForHR(hr);

            _shouldMinimize = (radioId == RadioMinimize);
            _dontAskAgain = verificationFlag;
            return (buttonId == IDOK) ? DialogResult.OK : DialogResult.Cancel;
        }
        finally
        {
            for (int i = 0; i < radioButtons.Length; i++)
                Marshal.DestroyStructure<TASKDIALOG_BUTTON>(pRadioButtons + i * buttonSize);
            Marshal.FreeHGlobal(pRadioButtons);
        }
    }

    public void Dispose() { }

    [DllImport("comctl32.dll", CharSet = CharSet.Unicode)]
    private static extern int TaskDialogIndirect(
        ref TASKDIALOGCONFIG pTaskConfig,
        out int pnButton,
        out int pnRadioButton,
        [MarshalAs(UnmanagedType.Bool)] out bool pfVerificationFlagChecked);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode, Pack = 1)]
    private struct TASKDIALOG_BUTTON
    {
        public int nButtonID;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pszButtonText;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode, Pack = 1)]
    private struct TASKDIALOGCONFIG
    {
        public uint cbSize;
        public IntPtr hwndParent;
        public IntPtr hInstance;
        public uint dwFlags;
        public uint dwCommonButtons;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pszWindowTitle;
        public IntPtr hMainIcon;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pszMainInstruction;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pszContent;
        public uint cButtons;
        public IntPtr pButtons;
        public int nDefaultButton;
        public uint cRadioButtons;
        public IntPtr pRadioButtons;
        public int nDefaultRadioButton;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pszVerificationText;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pszExpandedInformation;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pszExpandedControlText;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pszCollapsedControlText;
        public IntPtr hFooterIcon;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pszFooter;
        public IntPtr pfCallback;
        public IntPtr lpCallbackData;
        public uint cxWidth;
    }
}
