module.exports = {
  apps: [
    {
      name: "rekrooot-server",
      script: "server.js",
      env: {
        NODE_ENV: "production",
        PORT: 5015
      }
    }
  ]
};
