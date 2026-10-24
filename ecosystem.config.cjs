module.exports = {
  apps: [{
    name: 'whatsapp-status-bot',
    script: 'index.js',
    cwd: '/root/whatsapp-status-bot',
    node_args: '--max-old-space-size=512',
    max_memory_restart: '600M',
    autorestart: true,
    watch: false,
    kill_timeout: 10000,
    env: {
      NODE_ENV: 'production',
      TZ: 'Africa/Maputo'
    }
  }]
};
