#!/bin/bash

echo "========================================"
echo "  STELAR - Restore Database"
echo "========================================"
echo ""

# Настройки
PGUSER="postgres"
PGHOST="localhost"
PGPORT="5432"
PGDATABASE="stelar"

echo "WARNING: This will overwrite the existing database!"
echo ""
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Restore cancelled."
    exit 0
fi

echo ""
echo "Available backup files:"
echo ""
ls -1 backups/*.dump 2>/dev/null || echo "No backup files found!"
echo ""

read -p "Enter backup filename (e.g., stelar_20250421_123456.dump): " BACKUP_FILE

if [ ! -f "backups/$BACKUP_FILE" ]; then
    echo "ERROR: Backup file not found: backups/$BACKUP_FILE"
    exit 1
fi

echo ""
echo "[1/4] Dropping existing database (if exists)..."
psql -U "$PGUSER" -h "$PGHOST" -p "$PGPORT" -c "DROP DATABASE IF EXISTS $PGDATABASE;" postgres

echo "[2/4] Creating new database..."
psql -U "$PGUSER" -h "$PGHOST" -p "$PGPORT" -c "CREATE DATABASE $PGDATABASE;" postgres

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to create database!"
    exit 1
fi

echo "[3/4] Restoring database from backup..."
pg_restore -U "$PGUSER" -h "$PGHOST" -p "$PGPORT" -d "$PGDATABASE" -v "backups/$BACKUP_FILE"

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to restore database!"
    exit 1
fi

echo "[4/4] Restoring uploads folder..."
UPLOADS_ARCHIVE="${BACKUP_FILE/.dump/.tar.gz}"
UPLOADS_ARCHIVE="${UPLOADS_ARCHIVE/stelar_/uploads_}"

if [ -f "backups/$UPLOADS_ARCHIVE" ]; then
    echo "Extracting uploads archive..."
    tar -xzf "backups/$UPLOADS_ARCHIVE"
    echo "Uploads restored successfully!"
else
    echo "WARNING: Uploads archive not found: backups/$UPLOADS_ARCHIVE"
    echo "Looking for uploads folder..."
    UPLOADS_FOLDER="${BACKUP_FILE/.dump/}"
    UPLOADS_FOLDER="${UPLOADS_FOLDER/stelar_/uploads_}"
    if [ -d "backups/$UPLOADS_FOLDER" ]; then
        echo "Copying uploads folder..."
        cp -r "backups/$UPLOADS_FOLDER" uploads
        echo "Uploads restored successfully!"
    else
        echo "WARNING: Uploads folder not found!"
    fi
fi

echo ""
echo "========================================"
echo "  Restore completed successfully!"
echo "========================================"
echo ""
echo "Next steps:"
echo "1. Update .env file with your database credentials"
echo "2. Run: npm install"
echo "3. Run: npx prisma generate"
echo "4. Run: npm run start:dev"
echo ""
