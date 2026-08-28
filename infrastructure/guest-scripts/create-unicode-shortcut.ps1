param(
    [Parameter(Mandatory = $true)][string]$ShortcutPath,
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [Parameter(Mandatory = $true)][string]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$Description
)

$ErrorActionPreference = 'Stop'

# WScript.Shell сохраняет Arguments через ANSI code page и превращает
# кириллическое имя пользователя в '?'. Этот COM-интерфейс — Unicode-вариант
# Windows Shell Link.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

[ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int capacity, IntPtr findData, uint flags);
    void GetIDList(out IntPtr itemIdentifierList);
    void SetIDList(IntPtr itemIdentifierList);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder description, int capacity);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string description);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder directory, int capacity);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arguments, int capacity);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
    short GetHotkey();
    void SetHotkey(short hotkey);
    uint GetShowCmd();
    void SetShowCmd(uint showCommand);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder iconPath, int capacity, out int iconIndex);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string iconPath, int iconIndex);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string relativePath, uint reserved);
    void Resolve(IntPtr windowHandle, uint flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
}

[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
internal class ShellLink { }

[ComImport, Guid("0000010B-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPersistFile {
    void GetClassID(out Guid classIdentifier);
    void IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string filename, uint mode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string filename, bool remember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string filename);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string filename);
}

public static class AutoSetupShellLink {
    public static void CreateAndVerify(string shortcutPath, string targetPath, string arguments, string workingDirectory, string description) {
        IShellLinkW shortcut = (IShellLinkW)new ShellLink();
        shortcut.SetPath(targetPath);
        shortcut.SetArguments(arguments);
        shortcut.SetWorkingDirectory(workingDirectory);
        shortcut.SetDescription(description);
        IPersistFile persistedShortcut = (IPersistFile)shortcut;
        persistedShortcut.Save(shortcutPath, true);
        persistedShortcut.Load(shortcutPath, 0);
        StringBuilder savedArguments = new StringBuilder(32768);
        shortcut.GetArguments(savedArguments, savedArguments.Capacity);
        if (!String.Equals(savedArguments.ToString(), arguments, StringComparison.Ordinal)) {
            throw new InvalidOperationException("saved shell link arguments mismatch");
        }
    }
}
'@

$shortcutDirectory = Split-Path -Parent $ShortcutPath
New-Item -ItemType Directory -Path $shortcutDirectory -Force | Out-Null
[AutoSetupShellLink]::CreateAndVerify($ShortcutPath, $TargetPath, $Arguments, $WorkingDirectory, $Description)
if (-not (Test-Path -LiteralPath $ShortcutPath -PathType Leaf)) {
    throw 'create Unicode shortcut: shortcut was not created'
}
