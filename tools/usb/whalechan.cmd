@echo off
rem ===================================================================
rem  Whale Chan - portable launcher (USB stick / external drive)
rem
rem  KEY POINT: no drive letter is hard-coded anywhere. Everything is
rem  derived from %~dp0 (the folder this file lives in), so a stick
rem  that is E: today and G: tomorrow still works.
rem
rem  This file is deliberately 100%% ASCII. A .cmd with UTF-8 Chinese
rem  comments gets read by cmd.exe in the OEM codepage, the multi-byte
rem  sequences corrupt the line parsing, and the whole script explodes
rem  with "'ODE_EXE' is not recognized as an internal or external
rem  command". Chinese user-facing text lives in the .txt next to it.
rem ===================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

rem ---- 1. use the node that travels with us, not the host machine's ----
set "PATH=%ROOT%\node;%PATH%"
set "NODE_EXE=%ROOT%\node\node.exe"

rem ---- 2. credentials / sessions / logs / memory all stay on the stick ----
rem      DSH_HOME            -> where dsh keeps its own stuff (default ~/.dsh)
rem      WHALE_MEMORY_DIR    -> where the persona card, memory and favor live
set "DSH_HOME=%ROOT%\data"
set "WHALE_MEMORY_DIR=%ROOT%\data\whale-chan"

rem ---- 3. use the dsh that travels with us ----
rem      Point straight at lib\bin.js and run it with node, which dodges
rem      the Windows .cmd quoting problems.
set "DSH_BIN=%ROOT%\app\node_modules\@deepseek-ai\dsh\lib\bin.js"

rem ---- 4. permissions ----
rem      headless has no approval channel; without danger-full-access the
rem      approval policy fails closed and every write/exec tool dies.
set "DSH_PERMISSION_MODE=danger-full-access"

rem ---- 5. optional API key ----
rem      If data\key.txt exists, its single line becomes DEEPSEEK_API_KEY.
if exist "%ROOT%\data\key.txt" set /p DEEPSEEK_API_KEY=<"%ROOT%\data\key.txt"

rem ---- sanity: the whole folder must have been copied, not just this file ----
if not exist "%NODE_EXE%" (
  echo.
  echo   [x] Portable node not found: %NODE_EXE%
  echo       Copy the WHOLE folder to the stick, not just this launcher.
  echo.
  pause
  exit /b 1
)
if not exist "%DSH_BIN%" (
  echo.
  echo   [x] Portable dsh not found: %DSH_BIN%
  echo       Copy the WHOLE folder to the stick, not just this launcher.
  echo.
  pause
  exit /b 1
)

"%NODE_EXE%" "%ROOT%\whale-chan\bin\whalechan.mjs" %*
set "CODE=%ERRORLEVEL%"
exit /b %CODE%
