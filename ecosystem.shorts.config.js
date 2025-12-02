module.exports = {
  apps: [
    {
      name: "shorts-cron",
      script: "scripts/run-shorts-cron.js",
      cwd: "/root/tts",
      cron_restart: "30 18 * * *", // Run daily at 12:00 AM IST (18:30 UTC)
      autorestart: false,
      watch: false,
      env: {
        NODE_ENV: "production",
        SHORTS_CRON_SECRET: "shorts-auto-cron-2024",
        SHORTS_CRON_URL: "http://localhost:3000/api/shorts/process"
      }
    }
  ]
}
