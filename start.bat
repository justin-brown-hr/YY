@echo off
cd /d %~dp0
echo YodoFast - uses YodoTool handle.jsc engine
if not exist "AutoBuy\handle.jsc" (
  if exist "..\YodoTool\AutoBuy\handle.jsc" (
    echo Using engine from ..\YodoTool\AutoBuy
  ) else (
    echo ERROR: Copy AutoBuy folder from YodoTool into yodo-fast\AutoBuy
    pause
    exit /b 1
  )
)
npm start
