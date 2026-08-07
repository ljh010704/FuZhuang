@echo off
chcp 65001 >nul
title 抖音订单看板 - 数据更新
echo ========================================
echo    抖音订单看板 - 数据更新
echo ========================================
echo.
echo   1. 浏览器将自动打开ERP网站
echo   2. 请手动登录
echo   3. 登录后脚本自动提取数据
echo.
echo 按任意键开始...
pause >nul

cd /d "%~dp0"
node extract_data.js

echo.
echo 正在将数据嵌入看板...
node embed_data.js

echo.
echo ========================================
echo 更新完成！按任意键退出...
pause >nul
