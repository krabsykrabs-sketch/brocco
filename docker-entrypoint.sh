#!/bin/sh
set -e

echo "Running database migrations..."
node node_modules/prisma/build/index.js migrate deploy

echo "Running database seed (idempotent)..."
node node_modules/tsx/dist/cli.mjs prisma/seed.ts

echo "Starting Next.js server..."
exec node server.js
