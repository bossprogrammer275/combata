@echo off
setlocal
echo The legacy civilian generator is deprecated.
echo Open World now uses npc_core_001 as its only humanoid model.
echo Starting the npc_core_001 generation launcher...
call "%~dp0generate-npc-core.bat" %*
exit /b %ERRORLEVEL%
