@echo off
cd /d "%~dp0"
echo Climato se actualiza automaticamente mientras esta ventana siga abierta.
call npm run dev
pause
