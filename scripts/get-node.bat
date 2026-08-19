@echo off
REM ============================================================
REM get-node.bat — 下载便携 Node.js 到 hesi/node/（供 --no-node 打包使用）
REM 用法：在 hesi/ 目录内运行 get-node.bat
REM ============================================================
setlocal EnableDelayedExpansion
set "NODE_VER=22.14.0"
set "NODE_ZIP=node-v%NODE_VER%-win-x64.zip"
set "NODE_URL=https://nodejs.org/dist/v%NODE_VER%/%NODE_ZIP%"
set "DIR=%~dp0"
set "NODE_DIR=%DIR%node"
if not exist "%NODE_DIR%" mkdir "%NODE_DIR%"

if exist "%NODE_DIR%\node.exe" (
  echo Node 已存在于 %NODE_DIR%，跳过下载
  goto :done
)

echo 下载 %NODE_URL% ...
powershell -Command "Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%TEMP%\%NODE_ZIP%'"
echo 解压到 %NODE_DIR% ...
powershell -Command "Expand-Archive -Force '%TEMP%\%NODE_ZIP%' '%TEMP%\node-extract'"
xcopy /E /I /Y "%TEMP%\node-extract\node-v%NODE_VER%-win-x64\*" "%NODE_DIR%\" >nul
del /Q "%TEMP%\%NODE_ZIP%" 2>nul
rmdir /S /Q "%TEMP%\node-extract" 2>nul
echo Node v%NODE_VER% 已安装到 %NODE_DIR%

:done
endlocal
