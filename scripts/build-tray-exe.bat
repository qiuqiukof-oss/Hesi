@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion
REM ============================================================
REM 把 tray/tray.js 编译为单文件 tray.exe（Node Single Executable App）
REM 纯 Node 注入（scripts/inject-sea.js），无需 postject、无需联网
REM 产物：tray/tray.exe + tray/traybin/（需随 exe 一起分发）
REM ============================================================
set "ROOT=%~dp0.."
set "NODE=%ROOT%\node\node.exe"
set "SEA_CONFIG=%ROOT%\sea-config.json"
set "BLOB=%ROOT%\tray\sea-prep.blob"
set "OUT=%ROOT%\tray\tray.exe"
set "INJECT=%ROOT%\scripts\inject-sea.js"

if not exist "%NODE%" (
  echo [错误] 未找到 %NODE%，请确认 Hesi 自带便携 Node 存在。
  exit /b 1
)

echo [1/4] 生成 SEA blob（tray/tray.js）...
"%NODE%" --experimental-sea-config "%SEA_CONFIG%" || exit /b 1

echo [2/4] 复制便携 Node 作为基底可执行文件...
copy /Y "%NODE%" "%OUT%" >nul || exit /b 1

echo [3/4] 纯 Node 注入 blob（无需 postject）...
"%NODE%" "%INJECT%" "%OUT%" "%BLOB%" || exit /b 1

echo [4/4] 复制 systray2 原生二进制 traybin 到 exe 旁...
if not exist "%ROOT%\tray\traybin" mkdir "%ROOT%\tray\traybin"
copy /Y "%ROOT%\tray\node_modules\systray2\traybin\*" "%ROOT%\tray\traybin\" >nul

del /Q "%BLOB%" 2>nul
echo.
echo 完成：%OUT% 已就绪。双击即可启动 Hesi（托盘 + 后台服务）。
echo 注意：分发时 tray/tray.exe 需与 tray/traybin/（systray2 原生二进制）放在一起。
endlocal
