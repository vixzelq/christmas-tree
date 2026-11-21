' 启动本地预览（无窗口）。双击或由开机启动项调用。
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
shell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Environment("PROCESS")("PORT") = "8756"
shell.Run """C:\Program Files\nodejs\node.exe"" serve.mjs", 0, False
