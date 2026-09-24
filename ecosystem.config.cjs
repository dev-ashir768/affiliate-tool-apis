/**
 * PM2 ecosystem — affiliate-tool-apis
 *
 * Usage (on the server, inside this repo):
 *   npm ci
 *   npm run build
 *   npx prisma migrate deploy
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup
 */
module.exports = {
  apps: [
    {
      name: "tiksly-api",
      cwd: __dirname,
      script: "dist/server.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 4000,
      },
      max_memory_restart: "512M",
      time: true,
      error_file: "logs/api-error.log",
      out_file: "logs/api-out.log",
      merge_logs: true,
    },
    {
      name: "tiksly-worker",
      cwd: __dirname,
      script: "dist/worker.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "512M",
      time: true,
      error_file: "logs/worker-error.log",
      out_file: "logs/worker-out.log",
      merge_logs: true,
    },
  ],
};
