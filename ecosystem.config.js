module.exports = {
  apps: [
    {
      name: 'mobipium-worker',
      script: 'npm',
      args: 'run worker',
      interpreter: 'none',
      watch: false,
      autorestart: true,
      max_memory_restart: '500M',
    },
  ],
}
