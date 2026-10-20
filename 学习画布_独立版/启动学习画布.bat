@echo off
chcp 65001 >nul
title 学习路径画布

echo.
echo ============================================================
echo    学习路径画布 · 启动中...
echo ============================================================
echo.

cd /d "%~dp0"
"D:\自媒体模型库\抠透明\.venv\Scripts\python.exe" 启动学习画布.py

if errorlevel 1 (
    echo.
    echo 启动失败，请检查错误信息
    pause
)
