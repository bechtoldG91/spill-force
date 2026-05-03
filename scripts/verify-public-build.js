const fs = require('node:fs');
const path = require('node:path');
const { config } = require('../config');

const indexPath = path.join(config.publicDir, 'index.html');
const assetsPath = path.join(config.publicDir, 'assets');

if (!fs.existsSync(indexPath)) {
  console.error(`Build invalido: ${indexPath} nao foi gerado.`);
  process.exit(1);
}

if (!fs.existsSync(assetsPath)) {
  console.error(`Build invalido: ${assetsPath} nao foi gerado.`);
  process.exit(1);
}

console.log(`Build do frontend pronto em ${config.publicDir}`);
