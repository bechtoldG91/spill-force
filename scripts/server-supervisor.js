const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.join(ROOT_DIR, 'storage', '.runtime');
const SUPERVISOR_PID_FILE = path.join(RUNTIME_DIR, 'supervisor.pid');
const SERVER_PID_FILE = path.join(RUNTIME_DIR, 'server.pid');
const SUPERVISOR_LOG_FILE = path.join(RUNTIME_DIR, 'supervisor.log');
const SERVER_OUT_FILE = path.join(RUNTIME_DIR, 'server.out.log');
const SERVER_ERR_FILE = path.join(RUNTIME_DIR, 'server.err.log');
const RESTART_DELAY_MS = 1500;

let child = null;
let restartTimer = null;
let shuttingDown = false;
let finalizeCalled = false;

async function ensureRuntimeDir() {
  await fsp.mkdir(RUNTIME_DIR, { recursive: true });
}

function timestamp() {
  return new Date().toISOString();
}

function appendSupervisorLog(message) {
  try {
    fs.appendFileSync(SUPERVISOR_LOG_FILE, `[${timestamp()}] ${message}\n`, 'utf8');
  } catch (error) {
    console.error(message);
  }
}

async function writePidFile(filePath, pid) {
  await fsp.writeFile(filePath, `${pid}\n`, 'utf8');
}

async function removeFileIfExists(filePath) {
  try {
    await fsp.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function closeStream(stream) {
  if (stream && !stream.destroyed) {
    stream.end();
  }
}

async function finalize(reason) {
  if (finalizeCalled) {
    return;
  }

  finalizeCalled = true;
  clearTimeout(restartTimer);
  appendSupervisorLog(`supervisor finalizado: ${reason}`);

  await Promise.all([removeFileIfExists(SUPERVISOR_PID_FILE), removeFileIfExists(SERVER_PID_FILE)]).catch(() => {});
  process.exit(0);
}

function scheduleRestart() {
  if (shuttingDown) {
    return;
  }

  clearTimeout(restartTimer);
  appendSupervisorLog(`server.js caiu; reiniciando em ${RESTART_DELAY_MS} ms`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startServer().catch((error) => {
      appendSupervisorLog(`falha ao reiniciar server.js: ${error.stack || error.message}`);
      scheduleRestart();
    });
  }, RESTART_DELAY_MS);
}

async function startServer() {
  await ensureRuntimeDir();

  const stdoutStream = fs.createWriteStream(SERVER_OUT_FILE, { flags: 'a' });
  const stderrStream = fs.createWriteStream(SERVER_ERR_FILE, { flags: 'a' });

  const nextChild = spawn(process.execPath, ['server.js'], {
    cwd: ROOT_DIR,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child = nextChild;
  nextChild.stdout.pipe(stdoutStream);
  nextChild.stderr.pipe(stderrStream);

  await writePidFile(SERVER_PID_FILE, nextChild.pid);
  appendSupervisorLog(`server.js iniciado com PID ${nextChild.pid}`);

  nextChild.once('error', async (error) => {
    appendSupervisorLog(`erro ao iniciar server.js: ${error.stack || error.message}`);
    closeStream(stdoutStream);
    closeStream(stderrStream);
    child = null;
    await removeFileIfExists(SERVER_PID_FILE).catch(() => {});
    scheduleRestart();
  });

  nextChild.once('exit', async (code, signal) => {
    appendSupervisorLog(`server.js encerrado (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
    closeStream(stdoutStream);
    closeStream(stderrStream);
    child = null;
    await removeFileIfExists(SERVER_PID_FILE).catch(() => {});

    if (!shuttingDown) {
      scheduleRestart();
      return;
    }

    await finalize('child exit after shutdown');
  });
}

async function stopChild() {
  if (!child) {
    await finalize('no child to stop');
    return;
  }

  const currentChild = child;
  const forceKillTimer = setTimeout(() => {
    try {
      currentChild.kill('SIGKILL');
    } catch (error) {
      appendSupervisorLog(`falha ao forcar encerramento do server.js: ${error.message}`);
    }
  }, 4000);

  forceKillTimer.unref?.();

  try {
    currentChild.kill('SIGTERM');
  } catch (error) {
    appendSupervisorLog(`falha ao encerrar server.js: ${error.message}`);
    clearTimeout(forceKillTimer);
    await finalize('child kill failed');
  }
}

async function shutdown(reason) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearTimeout(restartTimer);
  appendSupervisorLog(`solicitado encerramento do supervisor: ${reason}`);
  await stopChild();
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((error) => {
    appendSupervisorLog(`erro no shutdown SIGINT: ${error.stack || error.message}`);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((error) => {
    appendSupervisorLog(`erro no shutdown SIGTERM: ${error.stack || error.message}`);
    process.exit(1);
  });
});

process.on('uncaughtException', (error) => {
  appendSupervisorLog(`uncaughtException no supervisor: ${error.stack || error.message}`);
  shutdown('uncaughtException').catch(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  appendSupervisorLog(`unhandledRejection no supervisor: ${reason?.stack || reason?.message || String(reason)}`);
  shutdown('unhandledRejection').catch(() => process.exit(1));
});

async function main() {
  await ensureRuntimeDir();
  await writePidFile(SUPERVISOR_PID_FILE, process.pid);
  appendSupervisorLog(`supervisor iniciado com PID ${process.pid}`);
  await startServer();
}

main().catch((error) => {
  appendSupervisorLog(`falha fatal ao iniciar supervisor: ${error.stack || error.message}`);
  process.exit(1);
});
