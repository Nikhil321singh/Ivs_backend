// PM2 process definition for the EC2 deployment.
//
//   pm2 start ecosystem.config.js --env production
//   pm2 save && pm2 startup      # survive reboots
//
// Env vars come from the .env file on the server (loaded by src/config/env.js),
// not from here — keep secrets out of version control.
module.exports = {
  apps: [
    {
      name: 'ivs-backend',
      script: 'src/server.js',
      // dotenv resolves .env relative to the process cwd, so pin cwd to the
      // repo root instead of inheriting whatever directory pm2 was invoked from.
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      // The app exits on a missing required env var. Cap restarts so a bad
      // .env fails loudly instead of looping forever.
      max_restarts: 5,
      min_uptime: '10s',
      max_memory_restart: '400M',
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      time: true,
    },
  ],
};
