param(
  [Parameter(Mandatory = $true)]
  [string]$AppUserModelId,

  [Parameter(Mandatory = $true)]
  [string[]]$ShortcutPath
)

$ErrorActionPreference = 'Stop'

$source = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace OfficeClaw.Toast
{
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct PROPERTYKEY
    {
        public Guid fmtid;
        public uint pid;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROPVARIANT
    {
        public ushort vt;
        public ushort wReserved1;
        public ushort wReserved2;
        public ushort wReserved3;
        public IntPtr p;
    }

    [ComImport]
    [Guid("00021401-0000-0000-C000-000000000046")]
    public class CShellLink
    {
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("000214F9-0000-0000-C000-000000000046")]
    public interface IShellLinkW
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
    public interface IPropertyStore
    {
        void GetCount(out uint cProps);
        void GetAt(uint iProp, out PROPERTYKEY pkey);
        void GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
        void SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
        void Commit();
    }

    public static class ShortcutToastIdentity
    {
        private const ushort VT_LPWSTR = 31;
        private const int STGM_READWRITE = 0x00000002;

        [DllImport("ole32.dll")]
        private static extern int PropVariantClear(ref PROPVARIANT pvar);

        public static void SetAppUserModelId(string shortcutPath, string appUserModelId)
        {
            var shellLink = (IShellLinkW)new CShellLink();
            var persistFile = (System.Runtime.InteropServices.ComTypes.IPersistFile)shellLink;
            persistFile.Load(shortcutPath, STGM_READWRITE);

            var propertyStore = (IPropertyStore)shellLink;
            var key = new PROPERTYKEY
            {
                fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
                pid = 5
            };

            var propVariant = new PROPVARIANT
            {
                vt = VT_LPWSTR,
                p = Marshal.StringToCoTaskMemUni(appUserModelId)
            };

            try
            {
                propertyStore.SetValue(ref key, ref propVariant);
                propertyStore.Commit();
                persistFile.Save(shortcutPath, true);
            }
            finally
            {
                PropVariantClear(ref propVariant);
            }
        }
    }
}
"@

if (-not ('OfficeClaw.Toast.ShortcutToastIdentity' -as [type])) {
  Add-Type -TypeDefinition $source
}

foreach ($path in $ShortcutPath) {
  if (-not (Test-Path -LiteralPath $path)) {
    Write-Output "Skipped missing shortcut: $path"
    continue
  }

  [OfficeClaw.Toast.ShortcutToastIdentity]::SetAppUserModelId($path, $AppUserModelId)
  Write-Output "Set AppUserModelID '$AppUserModelId' on shortcut: $path"
}
