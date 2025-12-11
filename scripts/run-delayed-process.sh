#!/bin/bash
# Process delayed videos that are due
# This script is called by systemd timer or cron

CRON_SECRET="${CRON_SECRET:-monitor-secret-2024}"
WEBAPP_URL="${WEBAPP_URL:-http://localhost:3000}"

echo "$(date) - Processing delayed videos..."

curl -s "${WEBAPP_URL}/api/channels/process-delayed?secret=${CRON_SECRET}" | jq '.'

echo "$(date) - Done"
