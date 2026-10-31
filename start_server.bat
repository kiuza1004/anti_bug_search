@echo off
chcp 65001 > nul
title BugFinder AI Server
echo ===================================================
echo  BugFinder AI - 벌레 탐지기 서버 실행 중...
echo ===================================================
python "%~dp0server.py"
pause
