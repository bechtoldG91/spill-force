const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  PUBLIC_DIR,
  VIDEO_DIR,
  storageService,
  jsonResponse,
  safeBaseName,
  isInside,
  getMime
} = require('./storage');
const { accessScope, authorizeRoles, getTeamIdFromRequest } = require('./auth');

function parseRange(rangeHeader, size) {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return false;
  }

  let start;
  let end;

  if (match[1] === '' && match[2] === '') {
    return false;
  }

  if (match[1] === '') {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return false;
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return false;
  }

  return {
    start,
    end: Math.min(end, size - 1)
  };
}

async function serveVideo(req, res, requestUrlOrPathname) {
  const requestUrl =
    typeof requestUrlOrPathname === 'string'
      ? new URL(requestUrlOrPathname, `http://${req.headers.host || 'localhost'}`)
      : requestUrlOrPathname;
  const { pathname } = requestUrl;
  const storageName = safeBaseName(decodeURIComponent(pathname.replace('/videos/', '')));
  const filePath = path.join(VIDEO_DIR, storageName);
  const teamId = getTeamIdFromRequest(req, requestUrl);
  const access = await authorizeRoles(req, res, teamId, ['admin', 'treinador', 'atleta']);
  if (!access) {
    return;
  }
  const scope = accessScope(access);

  if (!isInside(VIDEO_DIR, filePath)) {
    jsonResponse(res, 400, { error: 'Caminho invalido.' });
    return;
  }

  const stat = await fsp.stat(filePath);
  const metadata = await storageService.transaction((repository) => repository.findVideoByStorageName(storageName, scope));
  if (!metadata) {
    jsonResponse(res, 404, { error: 'Nao encontrado.' });
    return;
  }
  const contentType = metadata?.contentType || getMime(filePath);
  const range = parseRange(req.headers.range, stat.size);

  if (range === false) {
    res.writeHead(416, {
      'Content-Range': `bytes */${stat.size}`,
      'Accept-Ranges': 'bytes'
    });
    res.end();
    return;
  }

  if (range) {
    res.writeHead(206, {
      'Content-Type': contentType,
      'Content-Length': range.end - range.start + 1,
      'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600'
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    fs.createReadStream(filePath, range).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600'
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  let filePath = path.normalize(path.join(PUBLIC_DIR, relative));

  if (!isInside(PUBLIC_DIR, filePath)) {
    jsonResponse(res, 400, { error: 'Caminho invalido.' });
    return;
  }

  let stat;
  let requestedPath = pathname;

  try {
    stat = await fsp.stat(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    const extension = path.extname(filePath).toLowerCase();
    const shouldFallbackToSpa = extension === '' || extension === '.html';

    if (!shouldFallbackToSpa) {
      jsonResponse(res, 404, { error: 'Arquivo nao encontrado.' });
      return;
    }

    filePath = path.join(PUBLIC_DIR, 'index.html');
    stat = await fsp.stat(filePath);
    requestedPath = '/';
  }

  if (!stat.isFile()) {
    jsonResponse(res, 404, { error: 'Arquivo nao encontrado.' });
    return;
  }

  const extension = path.extname(filePath);

  res.writeHead(200, {
    'Content-Type': getMime(filePath),
    'Content-Length': stat.size,
    'Cache-Control': requestedPath === '/' || ['.html', '.css', '.js'].includes(extension) ? 'no-store' : 'public, max-age=3600'
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
}

module.exports = {
  serveVideo,
  serveStatic
};
