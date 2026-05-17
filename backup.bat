@echo off
echo ========================================
echo   STELAR - Backup Database
echo ========================================
echo.

REM Настройки
set PGUSER=postgres
set PGHOST=localhost
set PGPORT=5432
set PGDATABASE=stelar
set BACKUP_DIR=backups
set TIMESTAMP=%date:~-4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set TIMESTAMP=%TIMESTAMP: =0%

REM Создать папку для бэкапов
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

echo [1/4] Creating database dump...
pg_dump -U %PGUSER% -h %PGHOST% -p %PGPORT% -d %PGDATABASE% -F c -b -v -f "%BACKUP_DIR%\stelar_%TIMESTAMP%.dump"

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to create database dump!
    pause
    exit /b 1
)

echo [2/4] Creating SQL dump...
pg_dump -U %PGUSER% -h %PGHOST% -p %PGPORT% -d %PGDATABASE% --clean --if-exists -f "%BACKUP_DIR%\stelar_%TIMESTAMP%.sql"

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to create SQL dump!
    pause
    exit /b 1
)

echo [3/4] Backing up uploads folder...
if exist "uploads" (
    tar -czf "%BACKUP_DIR%\uploads_%TIMESTAMP%.tar.gz" uploads
    if %ERRORLEVEL% NEQ 0 (
        echo WARNING: Failed to create uploads archive. Trying alternative method...
        xcopy /E /I /Y uploads "%BACKUP_DIR%\uploads_%TIMESTAMP%"
    )
) else (
    echo WARNING: uploads folder not found!
)

echo [4/4] Copying configuration files...
copy .env "%BACKUP_DIR%\.env_%TIMESTAMP%.backup" >nul 2>&1
copy prisma\schema.prisma "%BACKUP_DIR%\schema_%TIMESTAMP%.prisma" >nul 2>&1

echo.
echo ========================================
echo   Backup completed successfully!
echo ========================================
echo.
echo Backup files saved to: %BACKUP_DIR%\
echo - stelar_%TIMESTAMP%.dump (binary format)
echo - stelar_%TIMESTAMP%.sql (SQL format)
echo - uploads_%TIMESTAMP%.tar.gz (or folder)
echo - .env_%TIMESTAMP%.backup
echo - schema_%TIMESTAMP%.prisma
echo.
echo To restore on another computer:
echo 1. Install PostgreSQL
echo 2. Create database: CREATE DATABASE stelar;
echo 3. Run: pg_restore -U postgres -d stelar stelar_%TIMESTAMP%.dump
echo 4. Extract uploads archive
echo 5. Copy .env file and update credentials
echo 6. Run: npm install
echo 7. Run: npx prisma generate
echo 8. Run: npm run start:dev
echo.
pause
