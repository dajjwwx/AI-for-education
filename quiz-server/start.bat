@echo off
chcp 65001 >nul 2>&1
title AI教育讲座扫码答题系统
cd /d "%~dp0"

echo.
echo  ========================================
echo   AI教育讲座扫码答题系统 启动中...
echo  ========================================
echo.

:: 检查node_modules是否存在
if not exist "node_modules" (
  echo  首次运行，正在安装依赖...
  call npm install
  echo.
)

:: 获取脚本所在目录的Node路径
set NODE_PATH=%~dp0node_modules

:: 启动服务器并打开浏览器
echo  正在启动服务器...
echo.
start /b node server.js

:: 等待服务器启动
timeout /t 2 /nobreak >nul

:: 打开浏览器
echo  正在打开讲座课件...
start "" "http://localhost:3000/slides.html"

echo.
echo  ========================================
echo   服务器已启动！
echo   讲座课件已自动打开
echo.
echo   数据看板地址（请在另一个浏览器标签打开）：
echo   http://localhost:3000/dashboard
echo  ========================================
echo.
echo  按 Ctrl+C 或关闭此窗口停止服务器
echo.

:: 保持窗口不关闭
cmd /k
