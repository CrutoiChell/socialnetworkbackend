#!/bin/bash

echo "========================================"
echo "  STELAR - Backup Database"
echo "========================================"
echo ""

# Настройки
PGUSER="postgres"
PGHOST="localhost"
PGPORT="5432"
PGDATABASE="stelar"
BACKUP_DIR="backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Создать папку для бэкапов
mkdir -p "$BACKUP_DIR"

echo "[1/4] Creating database dump..."
pg_dump -U "$PGUSER" -h "$PGHOST" -p "$PGPORT" -d "$PGDATABASE" -F c -b -v -f "$BACKUP_DIR/stelar_$TIMESTAMP.dump"

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to create database dump!"
    exit 1
fi

echo "[2/4] Creating SQL dump..."
pg_dump -U "$PGUSER" -h "$PGHOST" -p "$PGPORT" -d "$PGDATABASE" --clean --if-exists -f "$BACKUP_DIR/stelar_$TIMESTAMP.sql"

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to create SQL dump!"
    exit 1
fi

echo "[3/4] Backing up uploads folder..."
if [ -d "uploads" ]; then
    tar -czf "$BACKUP_DIR/uploads_$TIMESTAMP.tar.gz" uploads
    if [ $? -ne 0 ]; then
        echo "WARNING: Failed to create uploads archive. Trying alternative method..."
        cp -r uploads "$BACKUP_DIR/uploads_$TIMESTAMP"
    fi
else
    echo "WARNING: uploads folder not found!"
fi

echo "[4/4] Copying configuration files..."
cp .env "$BACKUP_DIR/.env_$TIMESTAMP.backup" 2>/dev/null || true
cp prisma/schema.prisma "$BACKUP_DIR/schema_$TIMESTAMP.prisma" 2>/dev/null || true

echo ""
echo "========================================"
echo "  Backup completed successfully!"
echo "========================================"
echo ""
echo "Backup files saved to: $BACKUP_DIR/"
echo "- stelar_$TIMESTAMP.dump (binary format)"
echo "- stelar_$TIMESTAMP.sql (SQL format)"
echo "- uploads_$TIMESTAMP.tar.gz (or folder)"
echo "- .env_$TIMESTAMP.backup"
echo "- schema_$TIMESTAMP.prisma"
echo ""
echo "To restore on another computer:"
echo "1. Install PostgreSQL"
echo "2. Create database: CREATE DATABASE stelar;"
echo "3. Run: pg_restore -U postgres -d stelar stelar_$TIMESTAMP.dump"
echo "4. Extract uploads archive: tar -xzf uploads_$TIMESTAMP.tar.gz"
echo "5. Copy .env file and update credentials"
echo "6. Run: npm install"
echo "7. Run: npx prisma generate"
echo "8. Run: npm run start:dev"
echo ""
