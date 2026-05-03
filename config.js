const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const ROOT_DIR = __dirname;
const DEFAULT_STORAGE_DIR = path.join(ROOT_DIR, 'storage');
const DEFAULT_PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DEFAULT_LOG_DIR = path.join(DEFAULT_STORAGE_DIR, '.runtime');
const ENV_FILE = path.join(ROOT_DIR, '.env');
const ALLOWED_NODE_ENVS = new Set(['development', 'production', 'test']);

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed[trimmed.length - 1] === quote) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(filePath = ENV_FILE) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key) || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = unquoteEnvValue(trimmed.slice(separatorIndex + 1));
  }
}

loadEnvFile();

const validationErrors = [];
const validationWarnings = [];

function readString(name, defaultValue = '') {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  return String(raw);
}

function readInteger(name, defaultValue, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    validationErrors.push(`${name} deve ser um inteiro entre ${min} e ${max}.`);
    return defaultValue;
  }

  return value;
}

function resolvePath(value, fallback) {
  const raw = value || fallback;
  return path.isAbsolute(raw) ? raw : path.resolve(ROOT_DIR, raw);
}

function validateDatabaseUrl(value) {
  if (!value) {
    return;
  }

  const supported = /^(json:\/\/|sqlite:|file:|postgres:\/\/|postgresql:\/\/|mysql:\/\/)/i.test(value);
  if (!supported) {
    validationErrors.push('DATABASE_URL deve usar json://, sqlite:, file:, postgres://, postgresql:// ou mysql://.');
  }
}

function validateSecret(name, value, { required }) {
  if (!value) {
    if (required) {
      validationErrors.push(`${name} e obrigatorio em producao.`);
    }
    return;
  }

  if (value.length < 32) {
    validationErrors.push(`${name} deve ter pelo menos 32 caracteres.`);
  }

  if (/(change[-_ ]?me|replace[-_ ]?with|placeholder|example|dev[-_ ]?secret|jwt[-_ ]?secret)/i.test(value)) {
    validationErrors.push(`${name} nao pode usar um valor de exemplo.`);
  }
}

function readCsv(name, defaultValue = []) {
  const values = readString(name, '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return values.length ? values : defaultValue;
}

function readOrCreateDevelopmentSecret() {
  const secretFile = path.join(DEFAULT_LOG_DIR, 'jwt-secret');

  try {
    if (fs.existsSync(secretFile)) {
      const existingSecret = fs.readFileSync(secretFile, 'utf8').trim();
      if (existingSecret.length >= 32) {
        return existingSecret;
      }
    }

    fs.mkdirSync(DEFAULT_LOG_DIR, { recursive: true });
    const nextSecret = randomBytes(32).toString('hex');
    fs.writeFileSync(secretFile, `${nextSecret}\n`, { encoding: 'utf8', mode: 0o600 });
    return nextSecret;
  } catch (error) {
    validationWarnings.push(`Nao foi possivel persistir JWT_SECRET de desenvolvimento: ${error.message}`);
    return randomBytes(32).toString('hex');
  }
}

const nodeEnv = readString('NODE_ENV', 'development');
if (!ALLOWED_NODE_ENVS.has(nodeEnv)) {
  validationErrors.push('NODE_ENV deve ser development, production ou test.');
}

const isProduction = nodeEnv === 'production';
const configuredJwtSecret = readString('JWT_SECRET', '');
const jwtSecret = configuredJwtSecret || (!isProduction ? readOrCreateDevelopmentSecret() : randomBytes(32).toString('hex'));
const databaseUrl = readString('DATABASE_URL', 'json://storage');

validateSecret('JWT_SECRET', configuredJwtSecret, { required: isProduction });
validateDatabaseUrl(databaseUrl);

if (!isProduction && !configuredJwtSecret) {
  validationWarnings.push('JWT_SECRET nao definido; usando segredo local persistido em storage/.runtime.');
}

const config = {
  rootDir: ROOT_DIR,
  nodeEnv,
  isProduction,
  host: readString('HOST', ''),
  port: readInteger('PORT', 3000, { min: 1, max: 65535 }),
  databaseUrl,
  jwtSecret,
  jwtTtlSeconds: readInteger('JWT_TTL_SECONDS', 7 * 24 * 60 * 60, { min: 60, max: 60 * 60 * 24 * 365 }),
  passwordHashRounds: readInteger('PASSWORD_HASH_ROUNDS', 12, { min: 8, max: 15 }),
  globalAdminEmails: readCsv('GLOBAL_ADMIN_EMAILS', ['gbechtold91@gmail.com']),
  maxUploadMb: readInteger('MAX_UPLOAD_MB', 1024, { min: 1, max: 102400 }),
  storageDir: resolvePath(readString('STORAGE_DIR', ''), DEFAULT_STORAGE_DIR),
  publicDir: resolvePath(readString('PUBLIC_DIR', ''), DEFAULT_PUBLIC_DIR),
  logDir: resolvePath(readString('LOG_DIR', ''), DEFAULT_LOG_DIR)
};

function validateConfig() {
  if (validationWarnings.length) {
    for (const warning of validationWarnings) {
      console.warn(`[config] ${warning}`);
    }
  }

  if (!validationErrors.length) {
    return config;
  }

  console.error('Configuracao invalida:');
  for (const error of validationErrors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

module.exports = {
  config,
  validateConfig,
  loadEnvFile
};
