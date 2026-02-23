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
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: process.env.DATABASE_URL,
        REDIS_URL: process.env.REDIS_URL,
        MOBIPIUM_API_TOKEN: process.env.MOBIPIUM_API_TOKEN,
        ALERT_THRESHOLD_MINUTES: process.env.ALERT_THRESHOLD_MINUTES,
        ALERT_MULTIPLE_THRESHOLD: process.env.ALERT_MULTIPLE_THRESHOLD,
        ALERT_EMAIL: process.env.ALERT_EMAIL,
        RESEND_API_KEY: process.env.RESEND_API_KEY,
      },
    },
  ],
}
