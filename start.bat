@echo off
chcp 65001 >nul
title 抖音订单看板服务
echo 启动服务...
cd /d "%~dp0"
node server.js
pause
