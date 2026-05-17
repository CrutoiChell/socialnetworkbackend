@echo off
echo ========================================
echo   STELAR - Restore Database
echo ========================================
echo.

REM Настройки
set PGUSER=postgres
set PGHOST=localhost
set PGPORT=5432
set PGDATABASE=stelar

echo WARNING: This will overwrite the existing database!
echo.
set /p CONFIRM="Are you sure you want to continue? (yes/no): "
if /i not "%CONFIRM%"=="yes" (
    echo Restore cancelled.
    pause
    exit /b 0
)

echo.
echo Available backup files:
echo.
dir /b backups\*.dump 2>nul
echo.

set /p BACKUP_FILE="Enter backup filename (e.g., stelar_20250421_123456.dump): "

if not exist "backups\%BACKUP_FILE%" (
    echo ERROR: Backup file not found: backups\%BACKUP_FILE%
    pause
    exit /b 1
)

echo.
echo [1/4] Dropping existing database (if exists)...
psql -U %PGUSER% -h %PGHOST% -p %PGPORT% -c "DROP DATABASE IF EXISTS %PGDATABASE%;" postgres

echo [2/4] Creating new database...
psql -U %PGUSER% -h %PGHOST% -p %PGPORT% -c "CREATE DATABASE %PGDATABASE%;" postgres

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to create database!
    pause
    exit /b 1
)

echo [3/4] Restoring database from backup...
pg_restore -U %PGUSER% -h %PGHOST% -p %PGPORT% -d %PGDATABASE% -v "backups\%BACKUP_FILE%"

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to restore database!
    pause
    exit /b 1
)

echo [4/4] Restoring uploads folder...
set UPLOADS_ARCHIVE=%BACKUP_FILE:.dump=.tar.gz%
set UPLOADS_ARCHIVE=%UPLOADS_ARCHIVE:stelar_=uploads_%

if exist "backups\%UPLOADS_ARCHIVE%" (
    echo Extracting uploads archive...
    tar -xzf "backups\%UPLOADS_ARCHIVE%"
    echo Uploads restored successfully!
) else (
    echo WARNING: Uploads archive not found: backups\%UPLOADS_ARCHIVE%
    echo Looking for uploads folder...
    set UPLOADS_FOLDER=%BACKUP_FILE:.dump=%
    set UPLOADS_FOLDER=%UPLOADS_FOLDER:stelar_=uploads_%
    if exist "backups\%UPLOADS_FOLDER%" (
        echo Copying uploads folder...
        xcopy /E /I /Y "backups\%UPLOADS_FOLDER%" uploads
        echo Uploads restored successfully!
    ) else (
        echo WARNING: Uploads folder not found!
    )
)

echo.
echo ========================================
echo   Restore completed successfully!
echo ========================================
echo.
echo Next steps:
echo 1. Update .env file with your database credentials
echo 2. Run: npm install
echo 3. Run: npx prisma generate
echo 4. Run: npm run start:dev
echo.
pause
