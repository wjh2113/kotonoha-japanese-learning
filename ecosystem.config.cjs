module.exports = {
  apps: [
    {
      name: 'kotonoha-japanese-learning',
      script: 'server.mjs',
      cwd: '/opt/kotonoha-japanese-learning',
      instances: 1,
      exec_mode: 'fork',
      node_args: '--env-file-if-exists=.env',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
