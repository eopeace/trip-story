@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist ".git\index.lock" del ".git\index.lock"
git add -A
git commit -F "%~dp0commit-msg.txt"
git push
echo.
echo Done - Netlify will rebuild in about a minute.
pause
