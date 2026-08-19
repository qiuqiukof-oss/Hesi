@echo off
REM ============================================================
REM Hesi USB Agent Packager (Windows)
REM Build a portable, offline-capable USB edition ONCE on a machine
REM with internet access. The resulting 'hesi' folder can then be copied
REM to a USB stick and run on air-gapped / GFW-affected machines.
REM
REM Usage:
REM   package-usb.bat            [默认：捆绑便携 Node]
REM   package-usb.bat --no-node  [不下载/不捆绑 Node；仅生成 README 节点说明 + get-node.bat]
REM
REM S1 依赖审计（server.js / mcp-server.js / routes 的 require）：
REM   运行必需目录 = routes public lib scripts ws mcp plugins cli-presets
REM                  workflows agents-src packaging vendor
REM   （vendor/connectors 为离线连接器市场主源，routes/workbuddy-hub.js 直接 require）
REM ============================================================
setlocal EnableDelayedExpansion
set "NODE_VER=22.14.0"
set "NODE_ZIP=node-v%NODE_VER%-win-x64.zip"
set "NODE_URL=https://nodejs.org/dist/v%NODE_VER%/%NODE_ZIP%"
set "ROOT=%~dp0.."
set "OUT=%ROOT%\hesi"
set "NODE_DIR=%OUT%\node"
set "CACHE=%OUT%\offline-cache"

REM --no-node 开关
set "NO_NODE=0"
if "%~1"=="--no-node" set "NO_NODE=1"

echo [1/8] Preparing output directory: %OUT%
if exist "%OUT%" (
  echo   - existing hesi detected, removing stale build...
  rmdir /S /Q "%OUT%" 2>nul
)
if not exist "%OUT%" mkdir "%OUT%"
if not exist "%NODE_DIR%" mkdir "%NODE_DIR%"
if not exist "%CACHE%" mkdir "%CACHE%"

echo [2/8] Copying app source into %OUT% ...
REM S2 补齐运行必需目录（旧脚本漏 ws/mcp/plugins/cli-presets/workflows/vendor → 包起不来）
for %%D in (routes public lib scripts ws mcp plugins cli-presets workflows agents-src packaging vendor) do (
  if exist "%ROOT%\%%D" xcopy /E /I /Y "%ROOT%\%%D" "%OUT%\%%D" >nul
)
for %%F in (server.js package.json package-lock.json .env.example README.md) do (
  if exist "%ROOT%\%%F" copy /Y "%ROOT%\%%F" "%OUT%\%%F" >nul
)
REM get-node 脚本放到产物根目录（README 引用 get-node.bat）
if exist "%ROOT%\scripts\get-node.sh" copy /Y "%ROOT%\scripts\get-node.sh" "%OUT%\get-node.sh" >nul
if exist "%ROOT%\scripts\get-node.bat" copy /Y "%ROOT%\scripts\get-node.bat" "%OUT%\get-node.bat" >nul
REM 排除项（防御性清理）
rmdir /S /Q "%OUT%\.workbuddy" 2>nul
rmdir /S /Q "%OUT%\data" 2>nul
rmdir /S /Q "%OUT%\uploads" 2>nul
rmdir /S /Q "%OUT%\backups" 2>nul
del /Q "%OUT%\.env" 2>nul
del /Q "%OUT%\.mcp.json" 2>nul

echo [3/8] Portable Node.js (%NODE_VER%) ...
if "%NO_NODE%"=="1" (
  echo   - --no-node 模式：跳过 Node 下载（请运行 get-node.bat 或见 README 节点节）
) else (
  if exist "%NODE_DIR%\node.exe" (
    echo   - already present, skip download
  ) else (
    echo   - downloading %NODE_URL%
    powershell -Command "Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%TEMP%\%NODE_ZIP%'"
    echo   - extracting to %NODE_DIR%
    powershell -Command "Expand-Archive -Force '%TEMP%\%NODE_ZIP%' '%TEMP%\node-extract'"
    xcopy /E /I /Y "%TEMP%\node-extract\node-v%NODE_VER%-win-x64\*" "%NODE_DIR%\" >nul
    del /Q "%TEMP%\%NODE_ZIP%" 2>nul
    rmdir /S /Q "%TEMP%\node-extract" 2>nul
  )
)

REM 选择可用 npm（捆绑 Node 优先，否则本机 node）
set "NPM="
if exist "%NODE_DIR%\npm.cmd" (
  set "NPM=%NODE_DIR%\npm.cmd"
) else (
  where npm >nul 2>nul && set "NPM=npm.cmd"
)

if "%NO_NODE%"=="1" if "%NPM%"=="" (
  echo [4-5/8] 跳过依赖安装与前端构建（--no-node 且本机无 Node）。
  echo         放置 Node 后请执行：cd hesi ^&^& get-node.bat ^&^& npm ci ^&^& npm run build
) else (
  echo [4/8] Installing Hesi dependencies (portable npm) ...
  if exist "%OUT%\package-lock.json" (
    call %NPM% ci --prefix "%OUT%" || call %NPM% install --prefix "%OUT%"
  ) else (
    call %NPM% install --prefix "%OUT%"
  )

  echo [5/8] Building frontend bundle (public/bundle.js) ...
  call %NPM% --prefix "%OUT%" run build || echo   - build 失败，请检查 esbuild 是否安装
)

echo [6/8] Pre-installing agents into offline-cache (offline one-click later) ...
if not "%NPM%"=="" (
  if exist "%NODE_DIR%\node.exe" (
    call "%NODE_DIR%\node.exe" "%OUT%\scripts\build-offline-cache.js" --out "%CACHE%" --npm "%NPM%"
  ) else (
    where node >nul 2>nul && node "%OUT%\scripts\build-offline-cache.js" --out "%CACHE%" --npm "%NPM%"
  )
) else (
  echo   - 跳过（无 Node）
)

echo [7/8] Generating launcher scripts ...
REM S5 启动器缺 Node 检测
(
  echo @echo off
  echo REM Start Hesi using the bundled portable Node.js
  echo set "DIR=%%~dp0"
  echo if not exist "%%DIR%%node\node.exe" ^(
  echo   if not defined NODE_HOME ^(
  echo     where node ^>nul 2^>nul
  echo     if errorlevel 1 ^(
  echo       echo 错误：未找到 Node（hesi\node\node.exe 不存在）。
  echo       echo 请先运行 get-node.bat 获取便携 Node，或见 README.md 节点节手动放置 Node 到 hesi\node\。
  echo       exit /b 1
  echo     ^)
  echo   ^)
  echo ^)
  echo set "QCLI_PORTABLE=%%DIR%%"
  echo if exist "%%DIR%%node\node.exe" ^( set "PATH=%%DIR%%node;%%PATH%%" ^)
  echo if exist "%%DIR%%node\node.exe" ^( "%%DIR%%node\node.exe" "%%DIR%%server.js" ^) else ^( node "%%DIR%%server.js" ^)
) > "%OUT%\start.bat"

(
  echo @echo off
  echo set "DIR=%%~dp0"
  echo set "QCLI_PORTABLE=%%DIR%%"
  echo set "PATH=%%DIR%%node;%%PATH%%"
  echo "%%DIR%%offline-cache\opencode\bin\opencode.cmd" %%*
) > "%OUT%\opencode.bat"

(
  echo @echo off
  echo set "DIR=%%~dp0"
  echo set "QCLI_PORTABLE=%%DIR%%"
  echo set "PATH=%%DIR%%node;%%PATH%%"
  echo "%%DIR%%offline-cache\ohmyopenagent\bin\oma.cmd" %%*
) > "%OUT%\oma.bat"

(
  echo @echo off
  echo set "DIR=%%~dp0"
  echo set "QCLI_PORTABLE=%%DIR%%"
  echo set "PATH=%%DIR%%node;%%PATH%%"
  echo "%%DIR%%offline-cache\codex\bin\codex.cmd" %%*
) > "%OUT%\codex.bat"

REM S4 README 节点节
(
  echo # Hesi 便携版（离线可用）
  echo.
  echo 本目录是可离线运行的 Hesi。把整个 `hesi/` 复制到 U 盘或目标机即可。
  echo.
  echo ## 启动
  echo ```bat
  echo start.bat
  echo ```
  echo 浏览器打开 http://127.0.0.1:4264 。
  echo.
  echo ## 便携 Node 说明
  if "%NO_NODE%"=="1" (
    echo 本包为 **--no-node** 构建，**未捆绑 Node**。请二选一：
    echo 1. 运行 `get-node.bat` 自动下载便携 Node 到 `hesi/node/`；
    echo 2. 或自行下载 Node v%NODE_VER% 解压到 `hesi/node/`。
  ) else (
    echo 本包已捆绑便携 Node v%NODE_VER%，开箱即用。如需重装 Node，可运行 `get-node.bat`。
  )
  echo.
  echo ### 手动获取 Node
  echo - 下载地址：https://nodejs.org/dist/v%NODE_VER%/
  echo   - Windows: node-v%NODE_VER%-win-x64.zip
  echo - 解压后把内容放到 `hesi/node/`（使 `hesi/node/node.exe` 存在）。
  echo.
  echo ## 配置
  echo 复制 `.env.example` 为 `.env` 并填入密钥（可选）。
  echo.
  echo ## 离线连接器
  echo 连接器市场主源位于 `vendor/connectors/`，离线可直接导入，无需联网。
) > "%OUT%\README.md"

echo [8/8] Copying config template ...
if not exist "%OUT%\.env" (
  if exist "%ROOT%\.env.example" copy "%ROOT%\.env.example" "%OUT%\.env" >nul
)
echo.
echo Done. Copy the entire '%OUT%' folder to a USB stick.
echo On the target machine, double-click start.bat (no admin required).
echo Open http://127.0.0.1:4264 — the welcome page shows one-click install
echo that uses the offline-cache (no internet needed).
endlocal
