@echo off
chcp 65001 >nul
title 学生门户 · 学习画布 + 复习与检测

echo.
echo ============================================================
echo    学生门户（独立版）· 启动中...
echo    无需 MySQL，无需原项目，自带演示数据
echo ============================================================
echo.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 node 命令，请先安装 Node.js 并加入 PATH
  pause
  exit /b 1
)

node "学习画布_独立版\server\server.js" --open

pause
