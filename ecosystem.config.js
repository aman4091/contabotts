module.exports = {
  apps: [{
    name: 'tts',
    script: 'npm',
    args: 'start',
    cwd: '/root/tts',
    kill_timeout: 10000,
    wait_ready: true,
    listen_timeout: 10000,
    restart_delay: 3000,
    max_restarts: 3,
    autorestart: true,
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
}
