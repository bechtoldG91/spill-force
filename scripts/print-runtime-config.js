const { config } = require('../config');

const key = process.argv[2];

if (key === 'logDir') {
  console.log(config.logDir);
  process.exit(0);
}

if (key === 'port') {
  console.log(config.port);
  process.exit(0);
}

console.log(
  JSON.stringify({
    port: config.port,
    logDir: config.logDir
  })
);
