@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Tines Romantasy Liste

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js er ikke installeret.
  echo Download fra https://nodejs.org og proev igen.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installerer afhaengigheder foerste gang...
  call npm install
  if errorlevel 1 (
    echo Kunne ikke installere afhaengigheder.
    pause
    exit /b 1
  )
)

REM Hvis serveren allerede koerer: aabn bare browseren
curl.exe -s -o nul -m 2 http://127.0.0.1:3847/api/health >nul 2>&1
if %errorlevel%==0 (
  echo Appen koerer allerede - aabner browseren...
  start "" "http://127.0.0.1:3847/"
  exit /b 0
)

REM Frigoer port 3847 hvis noget haenger
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3847 ^| findstr LISTENING') do (
  echo Lukker gammel proces paa port 3847 ^(PID %%a^)...
  taskkill /PID %%a /F >nul 2>&1
)

echo Starter Tines Romantasy Liste...
start "Tines Romantasy Server" /min "%~dp0run-server.bat"

echo Venter paa at serveren bliver klar...
set /a tries=0
:waitloop
set /a tries+=1
if %tries% gtr 40 (
  echo.
  echo Serveren startede ikke inden for 20 sekunder.
  echo Tjek vinduet "Tines Romantasy Server" for fejl.
  pause
  exit /b 1
)
ping 127.0.0.1 -n 2 >nul
curl.exe -s -o nul -m 2 http://127.0.0.1:3847/api/health >nul 2>&1
if not %errorlevel%==0 goto waitloop

echo Server klar - aabner browseren...
start "" "http://127.0.0.1:3847/"
echo.
echo Appen koerer. Du kan lukke dette vindue.
echo For at stoppe serveren: luk det lille "Tines Romantasy Server"-vindue.
ping 127.0.0.1 -n 4 >nul
exit /b 0
