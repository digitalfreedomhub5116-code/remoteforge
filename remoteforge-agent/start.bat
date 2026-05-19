@echo off
:: RemoteForge Agent Launcher
:: Starts the agent as an independent process (survives IDE/terminal closure)
start "" /B "node_modules\.bin\electron.cmd" .
echo RemoteForge Agent started independently.
echo You can close this window safely.
timeout /t 3 /nobreak >nul
