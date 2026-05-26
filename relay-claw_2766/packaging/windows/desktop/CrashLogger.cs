using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;

/// <summary>
/// 崩溃日志管理器
///
/// 功能：
/// - 日志轮转：单文件超过 5MB 自动归档，保留最近 10 个归档
/// - 崩溃报告：生成 JSON 元数据 + 日志快照
/// - 自动清理：崩溃报告保留最新 100 个
/// - UTF-8 编码：避免中文乱码
///
/// 使用场景：
/// - 仅用于 C# Desktop Launcher 主进程
/// - 不捕获 WebView2、API、Agent 等子进程崩溃
///
/// 兼容性：
/// - .NET Framework 4.0+
/// - 手动 JSON 序列化（避免依赖 System.Text.Json）
/// </summary>
internal sealed class CrashLogger
    {
        private const long MaxLogFileSize = 5 * 1024 * 1024; // 5MB
        private const int MaxArchiveCount = 10; // 保留 10 个归档
        private const int MaxCrashReports = 100; // 保留 100 个崩溃报告
        private readonly string _logFilePath;
        private readonly string _crashReportDir;
        private readonly object _logLock = new object();

        /// <summary>
        /// 初始化崩溃日志管理器
        /// </summary>
        /// <param name="projectRoot">项目根目录</param>
        public CrashLogger(string projectRoot)
        {
            var logsDir = Path.Combine(projectRoot, "logs");
            _logFilePath = Path.Combine(logsDir, "desktop-launcher.log");
            _crashReportDir = Path.Combine(logsDir, "crash");
            Directory.CreateDirectory(logsDir);
            Directory.CreateDirectory(_crashReportDir);
        }

        /// <summary>
        /// 追加日志条目
        /// </summary>
        /// <param name="message">日志消息</param>
        public void AppendLog(string message)
        {
            lock (_logLock)
            {
                try
                {
                    var logEntry = DateTime.Now.ToString("u") + " " + message + Environment.NewLine;
                    File.AppendAllText(_logFilePath, logEntry, Encoding.UTF8);
                    CheckAndRotateLog();
                }
                catch
                {
                    // 日志写入失败时静默处理，避免二次崩溃
                }
            }
        }

        /// <summary>
        /// 检查并执行日志轮转
        /// </summary>
        private void CheckAndRotateLog()
        {
            try
            {
                var fileInfo = new FileInfo(_logFilePath);
                if (!fileInfo.Exists || fileInfo.Length < MaxLogFileSize)
                {
                    return;
                }

                // 轮转日志：desktop-launcher.log -> desktop-launcher.1.log -> ...
                for (int i = MaxArchiveCount - 1; i >= 1; i--)
                {
                    var oldPath = _logFilePath + "." + i;
                    var newPath = _logFilePath + "." + (i + 1);
                    if (File.Exists(oldPath))
                    {
                        File.Delete(newPath);
                        File.Move(oldPath, newPath);
                    }
                }

                var archivePath = _logFilePath + ".1";
                File.Delete(archivePath);
                File.Move(_logFilePath, archivePath);
            }
            catch
            {
                // 轮转失败时继续写入当前文件
            }
        }

        /// <summary>
        /// 生成崩溃报告
        ///
        /// 生成两个文件：
        /// 1. crash-{timestamp}.json - 结构化崩溃信息（异常、进程、系统）
        /// 2. crash-{timestamp}.log - 崩溃时刻的日志快照
        /// </summary>
        /// <param name="exception">异常对象</param>
        /// <param name="context">额外的上下文信息（可选）</param>
        public void WriteCrashReport(Exception exception, Dictionary<string, object> context = null)
        {
            lock (_logLock)
            {
                try
                {
                    var timestamp = DateTime.Now.ToString("yyyy-MM-ddTHH-mm-ss");
                    var reportBaseName = "crash-desktop-" + timestamp;
                    var jsonPath = Path.Combine(_crashReportDir, reportBaseName + ".json");
                    var logPath = Path.Combine(_crashReportDir, reportBaseName + ".log");

                    // 生成结构化崩溃报告
                    var exceptionDict = new Dictionary<string, object>();
                    exceptionDict.Add("type", exception.GetType().FullName);
                    exceptionDict.Add("message", exception.Message);
                    exceptionDict.Add("stackTrace", exception.StackTrace);
                    exceptionDict.Add("innerException", exception.InnerException != null ? exception.InnerException.Message : null);

                    var processDict = new Dictionary<string, object>();
                    processDict.Add("id", Process.GetCurrentProcess().Id);
                    processDict.Add("name", Process.GetCurrentProcess().ProcessName);
                    processDict.Add("workingSet", Process.GetCurrentProcess().WorkingSet64);
                    processDict.Add("threads", Process.GetCurrentProcess().Threads.Count);

                    var systemDict = new Dictionary<string, object>();
                    systemDict.Add("os", Environment.OSVersion.ToString());
                    systemDict.Add("clr", Environment.Version.ToString());
                    systemDict.Add("machineName", Environment.MachineName);
                    systemDict.Add("processorCount", Environment.ProcessorCount);

                    var report = new Dictionary<string, object>();
                    report.Add("timestamp", DateTime.UtcNow.ToString("o"));
                    report.Add("service", "desktop");
                    report.Add("exception", exceptionDict);
                    report.Add("process", processDict);
                    report.Add("system", systemDict);

                    if (context != null)
                    {
                        report.Add("context", context);
                    }

                    var json = SerializeToJson(report);
                    File.WriteAllText(jsonPath, json, Encoding.UTF8);

                    // 复制当前日志到崩溃报告（日志快照）
                    if (File.Exists(_logFilePath))
                    {
                        File.Copy(_logFilePath, logPath, true);
                    }

                    CleanupOldCrashReports();
                }
                catch
                {
                    // 崩溃报告写入失败时静默处理
                }
            }
        }

        /// <summary>
        /// 清理旧的崩溃报告，保留最新 100 个
        /// </summary>
        private void CleanupOldCrashReports()
        {
            try
            {
                var files = Directory.GetFiles(_crashReportDir, "crash-*.json");
                if (files.Length <= MaxCrashReports)
                {
                    return;
                }

                Array.Sort(files);
                for (int i = 0; i < files.Length - MaxCrashReports; i++)
                {
                    var baseName = Path.GetFileNameWithoutExtension(files[i]);
                    File.Delete(files[i]);
                    var logFile = Path.Combine(_crashReportDir, baseName + ".log");
                    if (File.Exists(logFile))
                    {
                        File.Delete(logFile);
                    }
                }
            }
            catch
            {
                // 清理失败时忽略
            }
        }

        /// <summary>
        /// 手动 JSON 序列化（兼容 .NET Framework 4.0）
        ///
        /// 避免依赖 System.Text.Json 或 Newtonsoft.Json
        /// 支持嵌套字典、字符串转义、基本类型
        /// </summary>
        private string SerializeToJson(Dictionary<string, object> data, int indent = 0)
        {
            var sb = new StringBuilder();
            var indentStr = new string(' ', indent * 2);
            var nextIndentStr = new string(' ', (indent + 1) * 2);

            sb.Append(indentStr).AppendLine("{");

            var first = true;
            foreach (var kvp in data)
            {
                if (!first)
                {
                    sb.AppendLine(",");
                }
                first = false;

                sb.Append(nextIndentStr).Append("\"").Append(kvp.Key).Append("\": ");

                if (kvp.Value == null)
                {
                    sb.Append("null");
                }
                else if (kvp.Value is string)
                {
                    sb.Append("\"").Append(EscapeJsonString(kvp.Value.ToString())).Append("\"");
                }
                else if (kvp.Value is bool)
                {
                    sb.Append(kvp.Value.ToString().ToLower());
                }
                else if (kvp.Value is int || kvp.Value is long || kvp.Value is double || kvp.Value is float)
                {
                    sb.Append(kvp.Value);
                }
                else if (kvp.Value is Dictionary<string, object>)
                {
                    sb.AppendLine();
                    sb.Append(SerializeToJson((Dictionary<string, object>)kvp.Value, indent + 1));
                }
                else
                {
                    sb.Append("\"").Append(EscapeJsonString(kvp.Value.ToString())).Append("\"");
                }
            }

            sb.AppendLine();
            sb.Append(indentStr).Append("}");

            return sb.ToString();
        }

        /// <summary>
        /// 转义 JSON 字符串中的特殊字符
        /// </summary>
        private string EscapeJsonString(string str)
        {
            if (string.IsNullOrEmpty(str))
            {
                return str;
            }

            return str
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\n", "\\n")
                .Replace("\r", "\\r")
                .Replace("\t", "\\t");
        }
    }
