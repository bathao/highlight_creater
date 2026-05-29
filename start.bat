@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

REM ====================================================================
REM  Highlight Creator - One-click launcher
REM  Auto: create venv -> install deps -> start FastAPI server
REM ====================================================================

REM Use the directory this .bat lives in as the project root (handles spaces)
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

cd /d "%ROOT%"

REM ---- Configurable port (8770 â€” different from video_studio's 8765) ----
set "PORT=8770"

echo ====================================================================
echo  HIGHLIGHT CREATOR
echo  Project root: %ROOT%
echo  Port:         %PORT%
echo ====================================================================

REM ---- Locate Python ----
where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python is not installed or not on PATH.
    echo Please install Python 3.10+ from https://www.python.org/downloads/
    pause
    exit /b 1
)

REM ---- Create venv if missing ----
if not exist "%ROOT%\venv\Scripts\python.exe" (
    echo [SETUP] Creating virtual environment...
    python -m venv "%ROOT%\venv"
    if errorlevel 1 (
        echo [ERROR] Failed to create venv.
        pause
        exit /b 1
    )
)

REM ---- Activate venv ----
call "%ROOT%\venv\Scripts\activate.bat"
if errorlevel 1 (
    echo [ERROR] Failed to activate venv.
    pause
    exit /b 1
)

REM ---- Install dependencies (idempotent) ----
if not exist "%ROOT%\venv\Lib\site-packages\fastapi" (
    echo [SETUP] Installing dependencies...
    python -m pip install --upgrade pip
    python -m pip install -r "%ROOT%\requirements.txt"
    if errorlevel 1 (
        echo [ERROR] Dependency install failed.
        pause
        exit /b 1
    )
)

REM ---- Check ffmpeg ----
where ffmpeg >nul 2>nul
if errorlevel 1 (
    echo [WARN] ffmpeg is not on PATH. Render will fail until you install it.
    echo        Recommend: winget install Gyan.FFmpeg
    echo.
)

REM ---- Free our port if a stale instance is holding it ----
call :free_port %PORT%

REM ---- Launch server (auto-restart loop with cache cleanup) ----
echo.
echo ====================================================================
echo  Server starting at http://127.0.0.1:%PORT%
echo  Auto-restart: ON   Auto-clear cache: ON
echo  Press Ctrl+C twice (or close window) to stop completely.
echo ====================================================================
echo.

set "RESTART_COUNT=0"
set "MAX_RESTARTS=50"
set "FIRST_RUN=1"

:server_loop
    REM ---- Clear caches before each (re)start ----
    call :clear_caches

    REM ---- Open browser only on the very first launch ----
    if "!FIRST_RUN!"=="1" (
        start "" http://127.0.0.1:!PORT!
        set "FIRST_RUN=0"
    )

    echo.
    echo [RUN #!RESTART_COUNT!] Starting uvicorn on port !PORT! at %TIME% ...
    python -m uvicorn backend.main:app --host 127.0.0.1 --port !PORT! --reload
    set "EXIT_CODE=!errorlevel!"
    echo [RUN #!RESTART_COUNT!] Server exited with code !EXIT_CODE! at %TIME%

    set /a RESTART_COUNT+=1
    if !RESTART_COUNT! GEQ !MAX_RESTARTS! (
        echo [STOP] Reached MAX_RESTARTS=!MAX_RESTARTS!. Giving up.
        goto :end
    )

    REM ---- Make sure port is freed before relaunching ----
    call :free_port !PORT!

    echo.
    echo ====================================================================
    echo  Server stopped. Restarting in 3 seconds...
    echo  Press Ctrl+C now to abort the restart.
    echo ====================================================================
    timeout /t 3 /nobreak >nul
    goto server_loop

:end
echo.
echo Goodbye.
endlocal
exit /b 0


REM ====================================================================
REM  Subroutines
REM ====================================================================

:clear_caches
    echo [CACHE] Cleaning workspace\temp ...
    if exist "%ROOT%\workspace\temp" (
        del /q /f "%ROOT%\workspace\temp\*" >nul 2>nul
        for /d %%d in ("%ROOT%\workspace\temp\*") do rd /s /q "%%d" >nul 2>nul
    )
    echo [CACHE] Cleaning Python __pycache__ ...
    for /d /r "%ROOT%\backend" %%d in (__pycache__) do (
        if exist "%%d" rd /s /q "%%d" >nul 2>nul
    )
    if exist "%ROOT%\backend\__pycache__" rd /s /q "%ROOT%\backend\__pycache__" >nul 2>nul
    goto :eof

:free_port
    REM Kills any process still bound to TCP port %1 (lingering uvicorn after a hard-kill).
    REM Also walks the parent->child tree to catch multiprocessing.spawn workers
    REM that uvicorn --reload leaves behind when its supervisor dies.
    setlocal
    set "_TARGET_PORT=%~1"
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%_TARGET_PORT% .*LISTENING"') do (
        if not "%%p"=="0" (
            echo [PORT] Releasing PID %%p on :%_TARGET_PORT% ...
            taskkill /PID %%p /T /F >nul 2>nul
        )
    )
    REM Second pass: any python child whose parent is no longer alive but still holds the socket
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%_TARGET_PORT% .*LISTENING"') do (
        if not "%%p"=="0" (
            echo [PORT] Force-killing zombie PID %%p on :%_TARGET_PORT% ...
            taskkill /PID %%p /F >nul 2>nul
        )
    )
    endlocal
    goto :eof
