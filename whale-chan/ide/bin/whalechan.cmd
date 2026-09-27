@echo off
rem Wake whale-chan from the terminal of any IDE.
rem Add this folder to PATH, then just type: whalechan
rem (ASCII-only comments on purpose: cmd.exe reads .cmd files in the OEM code page.)
setlocal
set "HERE=%~dp0"
node "%HERE%..\..\bin\whalechan.mjs" %*
