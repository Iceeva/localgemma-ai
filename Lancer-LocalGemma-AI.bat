@echo off
cd /d "%~dp0"
title LocalGemma AI
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start.ps1"
pause
