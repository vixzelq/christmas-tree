@echo off
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8756 ^| findstr LISTENING') do taskkill /f /pid %%a
