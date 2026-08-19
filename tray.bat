@echo off
chcp 65001 >nul 2>&1
set "HESI_ROOT=%~dp0"
if "%HESI_ROOT:~-1%"=="\" set "HESI_ROOT=%HESI_ROOT:~0,-1%"

REM === 便携 Node（主目录必须带 node\node.exe；缺失则回退系统 node）===
set "NODE=%HESI_ROOT%\node\node.exe"
if not exist "%NODE%" (
  echo [tray] 未找到便携 Node：%NODE%
  echo [tray] 回退使用系统 PATH 中的 node（不保证可用）
  set "NODE=node"
)

REM === 依赖自检：缺失则分别自动 npm install（主目录 + tray 目录）===
if not exist "%HESI_ROOT%\node_modules" (
  echo [tray] 主目录依赖缺失，正在 npm install ...
  pushd "%HESI_ROOT%"
  if exist "%HESI_ROOT%\node\npm.cmd" (call "%HESI_ROOT%\node\npm.cmd" install) else (call npm install)
  popd
)
if not exist "%HESI_ROOT%\tray\node_modules\systray2" (
  echo [tray] tray 依赖缺失，正在 npm install ...
  pushd "%HESI_ROOT%\tray"
  if exist "%HESI_ROOT%\node\npm.cmd" (call "%HESI_ROOT%\node\npm.cmd" install) else (call npm install)
  popd
)

REM === 环境变量：便携 Node 注入 PATH，QCLI_PORTABLE 指向主目录 ===
set "QCLI_PORTABLE=%HESI_ROOT%"
set "PATH=%HESI_ROOT%\node;%PATH%"
set "PORT=4264"

cd /d "%HESI_ROOT%"
echo [tray] 启动 Hesi 托盘（端口 %PORT%）...
"%NODE%" "%HESI_ROOT%\tray\tray.js"

if errorlevel 1 (
  echo.
  echo [tray] 启动失败（退出码 %errorlevel%）。详见 tray\tray_debug.log
  echo [tray] 按任意键关闭...
  pause >nul
)
