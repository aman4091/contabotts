#!/bin/bash
# Run live monitoring check every 3 hours
# This script is called by systemd timer or cron

CRON_SECRET="${CRON_SECRET:-monitor-secret-2024}"
WEBAPP_URL="${WEBAPP_URL:-http://localhost:3000}"

echo "$(date) - Running live monitoring check..."

curl -s "${WEBAPP_URL}/api/channels/monitor?secret=${CRON_SECRET}" | jq '.'

echo "$(date) - Done"
