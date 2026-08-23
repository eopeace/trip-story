@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem stale locks left behind by anything that touched the repo
del /f /q ".git\HEAD.lock" 2>nul
del /f /q ".git\index.lock" 2>nul
del /f /q ".git\config.lock" 2>nul
del /f /q ".git\refs\heads\*.lock" 2>nul

git remote set-url origin https://github.com/eopeace/trip-story.git 2>nul
if errorlevel 1 git remote add origin https://github.com/eopeace/trip-story.git

git add -A
git commit -F "%~dp0commit-msg.txt"
git branch -M main
git push -u origin main
echo.
echo If you see "Repository not found" - create an EMPTY repo named trip-story
echo on github.com first (no README, no .gitignore), then run this again.
pause
