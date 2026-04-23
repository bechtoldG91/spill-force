const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const PORT = Number(process.env.PORT || 3000);
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 1024);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const STORAGE_DIR = path.join(ROOT_DIR, 'storage');
const VIDEO_DIR = path.join(STORAGE_DIR, 'videos');
const DATA_FILE = path.join(STORAGE_DIR, 'videos.json');
const ANNOTATIONS_FILE = path.join(STORAGE_DIR, 'annotations.json');
const PLAYLISTS_FILE = path.join(STORAGE_DIR, 'playlists.json');
const MAX_JSON_BODY_BYTES = 5 * 1024 * 1024;
const DEFAULT_PLAYLIST_ID = 'geral';
const DEFAULT_PLAYLIST = {
  id: DEFAULT_PLAYLIST_ID,
  name: 'Geral',
  description: 'Videos sem playlist especifica.',
  createdAt: '2026-04-22T00:00:00.000Z',
  updatedAt: '2026-04-22T00:00:00.000Z'
};

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

const VIDEO_MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska'
};

let metadataWriteQueue = Promise.resolve();

function queueMetadataMutation(task) {
  const next = metadataWriteQueue.then(task, task);
  metadataWriteQueue = next.catch(() => {});
  return next;
}

async function ensureStorage() {
  await fsp.mkdir(VIDEO_DIR, { recursive: true });
}

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function methodNotAllowed(res) {
  jsonResponse(res, 405, { error: 'Metodo nao permitido.' });
}

function safeText(value, maxLength = 160) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function safeBaseName(fileName) {
  const fallback = 'video.mp4';
  const base = path.basename(String(fileName || fallback));
  const cleaned = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

function isInside(base, target) {
  const relative = path.relative(base, target);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function getMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return STATIC_MIME[ext] || VIDEO_MIME[ext] || 'application/octet-stream';
}

function getVideoExtension(originalName, contentType) {
  const ext = path.extname(originalName).toLowerCase();
  if (VIDEO_MIME[ext]) {
    return ext;
  }

  const normalized = String(contentType || '').split(';')[0].toLowerCase();
  const match = Object.entries(VIDEO_MIME).find(([, mime]) => mime === normalized);
  return match ? match[0] : '.mp4';
}

function isVideoLike(contentType, extension) {
  const normalized = String(contentType || '').split(';')[0].toLowerCase();
  return normalized.startsWith('video/') || Boolean(VIDEO_MIME[extension]);
}

async function readCatalog() {
  await ensureStorage();

  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeCatalog(videos) {
  await ensureStorage();
  const tempFile = `${DATA_FILE}.tmp`;
  await fsp.writeFile(tempFile, `${JSON.stringify(videos, null, 2)}\n`, 'utf8');
  await fsp.rename(tempFile, DATA_FILE);
}

async function readAnnotationsStore() {
  await ensureStorage();

  try {
    const raw = await fsp.readFile(ANNOTATIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function readPlaylists() {
  await ensureStorage();

  try {
    const raw = await fsp.readFile(PLAYLISTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const playlists = Array.isArray(parsed) ? parsed : [];
    return ensureDefaultPlaylist(playlists);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [DEFAULT_PLAYLIST];
    }
    throw error;
  }
}

async function writePlaylists(playlists) {
  await ensureStorage();
  const tempFile = `${PLAYLISTS_FILE}.tmp`;
  await fsp.writeFile(tempFile, `${JSON.stringify(ensureDefaultPlaylist(playlists), null, 2)}\n`, 'utf8');
  await fsp.rename(tempFile, PLAYLISTS_FILE);
}

function ensureDefaultPlaylist(playlists) {
  const cleaned = playlists
    .filter((playlist) => playlist && typeof playlist === 'object')
    .map((playlist) => ({
      id: safeText(playlist.id, 80) || randomUUID(),
      name: safeText(playlist.name, 120) || 'Playlist',
      description: safeText(playlist.description, 260),
      createdAt: safeText(playlist.createdAt, 40) || new Date().toISOString(),
      updatedAt: safeText(playlist.updatedAt, 40) || new Date().toISOString()
    }));

  const withoutDefault = cleaned.filter((playlist) => playlist.id !== DEFAULT_PLAYLIST_ID);
  return [DEFAULT_PLAYLIST, ...withoutDefault];
}

async function writeAnnotationsStore(store) {
  await ensureStorage();
  const tempFile = `${ANNOTATIONS_FILE}.tmp`;
  await fsp.writeFile(tempFile, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await fsp.rename(tempFile, ANNOTATIONS_FILE);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw new Error('JSON_BODY_LIMIT_EXCEEDED');
    }
    chunks.push(chunk);
  }

  if (size === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function parseTags(raw) {
  return safeText(raw, 240)
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function playlistSummary(playlist, videos = []) {
  const count = videos.filter((video) => (video.playlistId || DEFAULT_PLAYLIST_ID) === playlist.id).length;
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    count,
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt
  };
}

function resolvePlaylist(video, playlists) {
  return playlists.find((playlist) => playlist.id === video.playlistId) || playlists[0] || DEFAULT_PLAYLIST;
}

function videoSummary(video, playlists = [DEFAULT_PLAYLIST]) {
  const playlist = resolvePlaylist(video, playlists);
  return {
    id: video.id,
    title: video.title,
    team: video.team,
    athlete: video.athlete,
    kind: video.kind,
    uploader: video.uploader,
    tags: video.tags,
    notes: video.notes,
    visibility: video.visibility,
    playlistId: playlist.id,
    playlistName: playlist.name,
    originalName: video.originalName,
    url: video.url,
    contentType: video.contentType,
    size: video.size,
    duration: video.duration,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt
  };
}

async function handleListVideos(res) {
  const videos = await readCatalog();
  const playlists = await readPlaylists();
  jsonResponse(res, 200, { videos: videos.map((video) => videoSummary(video, playlists)) });
}

async function handleListPlaylists(res) {
  const videos = await readCatalog();
  const playlists = await readPlaylists();
  jsonResponse(res, 200, { playlists: playlists.map((playlist) => playlistSummary(playlist, videos)) });
}

async function handleCreatePlaylist(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error.message === 'JSON_BODY_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: 'Playlist maior que o limite permitido.' });
      return;
    }
    if (error instanceof SyntaxError) {
      jsonResponse(res, 400, { error: 'JSON invalido.' });
      return;
    }
    throw error;
  }

  const name = safeText(payload.name, 120);
  if (!name) {
    jsonResponse(res, 400, { error: 'Informe o nome da playlist.' });
    return;
  }

  const result = await queueMetadataMutation(async () => {
    const playlists = await readPlaylists();
    const existing = playlists.find((playlist) => playlist.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      return {
        status: 200,
        playlist: playlistSummary(existing, await readCatalog())
      };
    }

    const now = new Date().toISOString();
    const playlist = {
      id: randomUUID(),
      name,
      description: safeText(payload.description, 260),
      createdAt: now,
      updatedAt: now
    };

    playlists.push(playlist);
    await writePlaylists(playlists);
    return {
      status: 201,
      playlist: playlistSummary(playlist, await readCatalog())
    };
  });

  jsonResponse(res, result.status, { playlist: result.playlist });
}

async function handleDeletePlaylist(res, rawId) {
  const id = safeText(decodeURIComponent(rawId), 80);

  if (!id) {
    jsonResponse(res, 404, { error: 'Playlist nao encontrada.' });
    return;
  }

  if (id === DEFAULT_PLAYLIST_ID) {
    jsonResponse(res, 400, { error: 'A playlist Geral nao pode ser removida.' });
    return;
  }

  const result = await queueMetadataMutation(async () => {
    const playlists = await readPlaylists();
    const playlist = playlists.find((item) => item.id === id);

    if (!playlist) {
      return { found: false };
    }

    const now = new Date().toISOString();
    let movedCount = 0;
    const videos = await readCatalog();
    const nextVideos = videos.map((video) => {
      if ((video.playlistId || DEFAULT_PLAYLIST_ID) !== id) {
        return video;
      }

      movedCount += 1;
      return {
        ...video,
        playlistId: DEFAULT_PLAYLIST_ID,
        updatedAt: now
      };
    });

    const nextPlaylists = playlists.filter((item) => item.id !== id);
    await writeCatalog(nextVideos);
    await writePlaylists(nextPlaylists);

    return {
      found: true,
      movedCount
    };
  });

  if (!result.found) {
    jsonResponse(res, 404, { error: 'Playlist nao encontrada.' });
    return;
  }

  jsonResponse(res, 200, { ok: true, movedCount: result.movedCount });
}

async function handleCreateVideo(req, res, requestUrl) {
  await ensureStorage();

  const params = requestUrl.searchParams;
  const originalName = safeBaseName(params.get('fileName'));
  const contentType = safeText(req.headers['content-type'] || 'application/octet-stream', 120);
  const extension = getVideoExtension(originalName, contentType);

  if (!isVideoLike(contentType, extension)) {
    jsonResponse(res, 415, { error: 'Envie um arquivo de video valido.' });
    return;
  }

  const id = randomUUID();
  const storageName = `${id}${extension}`;
  const finalPath = path.join(VIDEO_DIR, storageName);
  const tempPath = path.join(VIDEO_DIR, `${storageName}.tmp`);
  let size = 0;

  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        callback(new Error('UPLOAD_LIMIT_EXCEEDED'));
        return;
      }
      callback(null, chunk);
    }
  });

  try {
    await pipeline(req, limiter, fs.createWriteStream(tempPath, { flags: 'wx' }));
  } catch (error) {
    await fsp.rm(tempPath, { force: true });
    if (error.message === 'UPLOAD_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: `Video maior que o limite de ${MAX_UPLOAD_MB} MB.` });
      return;
    }
    throw error;
  }

  if (size === 0) {
    await fsp.rm(tempPath, { force: true });
    jsonResponse(res, 400, { error: 'O arquivo enviado esta vazio.' });
    return;
  }

  await fsp.rename(tempPath, finalPath);

  const result = await queueMetadataMutation(async () => {
    const now = new Date().toISOString();
    const duration = Number(params.get('duration'));
    const playlists = await readPlaylists();
    const requestedPlaylistId = safeText(params.get('playlistId'), 80);
    const playlist = playlists.find((item) => item.id === requestedPlaylistId) || playlists[0] || DEFAULT_PLAYLIST;
    const video = {
      id,
      title: safeText(params.get('title'), 160) || path.basename(originalName, extension),
      team: safeText(params.get('team'), 120) || 'Sem equipe',
      athlete: safeText(params.get('athlete'), 120),
      kind: safeText(params.get('kind'), 40) || 'jogo',
      uploader: safeText(params.get('uploader'), 120) || 'Equipe tecnica',
      tags: parseTags(params.get('tags')),
      notes: safeText(params.get('notes'), 500),
      visibility: safeText(params.get('visibility'), 40) || 'equipe',
      playlistId: playlist.id,
      originalName,
      storageName,
      url: `/videos/${encodeURIComponent(storageName)}`,
      contentType: contentType.split(';')[0],
      size,
      duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
      createdAt: now,
      updatedAt: now
    };

    const videos = await readCatalog();
    videos.unshift(video);
    await writeCatalog(videos);

    return {
      status: 201,
      video: videoSummary(video, playlists)
    };
  });

  jsonResponse(res, result.status, { video: result.video });
}

async function handleDeleteVideo(res, id) {
  const result = await queueMetadataMutation(async () => {
    const videos = await readCatalog();
    const index = videos.findIndex((video) => video.id === id);

    if (index === -1) {
      return { found: false };
    }

    const [video] = videos.splice(index, 1);
    await writeCatalog(videos);

    const annotations = await readAnnotationsStore();
    if (annotations[id]) {
      delete annotations[id];
      await writeAnnotationsStore(annotations);
    }

    return {
      found: true,
      storageName: video.storageName
    };
  });

  if (!result.found) {
    jsonResponse(res, 404, { error: 'Video nao encontrado.' });
    return;
  }

  await fsp.rm(path.join(VIDEO_DIR, result.storageName), { force: true });

  jsonResponse(res, 200, { ok: true });
}

function normalizePoint(point) {
  const x = Number(point?.x);
  const y = Number(point?.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x: Math.max(0, Math.min(1, Number(x.toFixed(5)))),
    y: Math.max(0, Math.min(1, Number(y.toFixed(5))))
  };
}

function normalizeStroke(stroke) {
  const points = Array.isArray(stroke?.points)
    ? stroke.points.map(normalizePoint).filter(Boolean).slice(0, 1200)
    : [];

  if (points.length < 2) {
    return null;
  }

  const width = Number(stroke?.width);
  const color = /^#[0-9a-f]{6}$/i.test(String(stroke?.color || '')) ? stroke.color : '#caff42';

  return {
    color,
    width: Number.isFinite(width) ? Math.max(2, Math.min(18, Math.round(width))) : 5,
    points
  };
}

function normalizeBox(box) {
  const x = Number(box?.x);
  const y = Number(box?.y);
  const width = Number(box?.width);
  const text = safeText(box?.text, 240);
  const color = /^#[0-9a-f]{6}$/i.test(String(box?.color || '')) ? box.color : '#caff42';

  if (!text || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    id: safeText(box?.id, 80) || randomUUID(),
    x: Math.max(0, Math.min(1, Number(x.toFixed(5)))),
    y: Math.max(0, Math.min(1, Number(y.toFixed(5)))),
    width: Number.isFinite(width) ? Math.max(0.12, Math.min(0.55, Number(width.toFixed(5)))) : 0.24,
    text,
    color
  };
}

function normalizeAnnotation(annotation) {
  const time = Number(annotation?.time);
  if (!Number.isFinite(time) || time < 0) {
    return null;
  }

  const strokes = Array.isArray(annotation?.strokes)
    ? annotation.strokes.map(normalizeStroke).filter(Boolean).slice(0, 40)
    : [];
  const boxes = Array.isArray(annotation?.boxes)
    ? annotation.boxes.map(normalizeBox).filter(Boolean).slice(0, 20)
    : [];
  const text = safeText(annotation?.text, 900);

  if (!text && strokes.length === 0 && boxes.length === 0) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    id: safeText(annotation?.id, 80) || randomUUID(),
    time: Number(time.toFixed(2)),
    text,
    color: /^#[0-9a-f]{6}$/i.test(String(annotation?.color || '')) ? annotation.color : '#caff42',
    strokes,
    boxes,
    createdAt: safeText(annotation?.createdAt, 40) || now,
    updatedAt: now
  };
}

async function ensureVideoExists(id) {
  const videos = await readCatalog();
  return videos.some((video) => video.id === id);
}

async function handleGetAnnotations(res, id) {
  if (!(await ensureVideoExists(id))) {
    jsonResponse(res, 404, { error: 'Video nao encontrado.' });
    return;
  }

  const store = await readAnnotationsStore();
  jsonResponse(res, 200, { annotations: Array.isArray(store[id]) ? store[id] : [] });
}

async function handlePutAnnotations(req, res, id) {
  if (!(await ensureVideoExists(id))) {
    jsonResponse(res, 404, { error: 'Video nao encontrado.' });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error.message === 'JSON_BODY_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: 'Anotacoes maiores que o limite permitido.' });
      return;
    }
    if (error instanceof SyntaxError) {
      jsonResponse(res, 400, { error: 'JSON invalido.' });
      return;
    }
    throw error;
  }

  const annotations = Array.isArray(payload.annotations)
    ? payload.annotations.map(normalizeAnnotation).filter(Boolean).slice(0, 100)
    : [];

  annotations.sort((a, b) => a.time - b.time);

  await queueMetadataMutation(async () => {
    const store = await readAnnotationsStore();
    store[id] = annotations;
    await writeAnnotationsStore(store);
  });

  jsonResponse(res, 200, { annotations });
}

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

async function serveVideo(req, res, pathname) {
  const storageName = safeBaseName(decodeURIComponent(pathname.replace('/videos/', '')));
  const filePath = path.join(VIDEO_DIR, storageName);

  if (!isInside(VIDEO_DIR, filePath)) {
    jsonResponse(res, 400, { error: 'Caminho invalido.' });
    return;
  }

  const stat = await fsp.stat(filePath);
  const videos = await readCatalog();
  const metadata = videos.find((video) => video.storageName === storageName);
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

async function route(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = requestUrl;

  if (pathname === '/api/playlists') {
    if (req.method === 'GET') {
      await handleListPlaylists(res);
      return;
    }
    if (req.method === 'POST') {
      await handleCreatePlaylist(req, res);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const playlistDeleteMatch = /^\/api\/playlists\/([^/]+)$/.exec(pathname);
  if (playlistDeleteMatch) {
    if (req.method === 'DELETE') {
      await handleDeletePlaylist(res, playlistDeleteMatch[1]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  if (pathname === '/api/videos') {
    if (req.method === 'GET') {
      await handleListVideos(res);
      return;
    }
    if (req.method === 'POST') {
      await handleCreateVideo(req, res, requestUrl);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const videoDeleteMatch = /^\/api\/videos\/([a-f0-9-]{36})$/.exec(pathname);
  if (videoDeleteMatch) {
    if (req.method === 'DELETE') {
      await handleDeleteVideo(res, videoDeleteMatch[1]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const annotationsMatch = /^\/api\/videos\/([a-f0-9-]{36})\/annotations$/.exec(pathname);
  if (annotationsMatch) {
    if (req.method === 'GET') {
      await handleGetAnnotations(res, annotationsMatch[1]);
      return;
    }
    if (req.method === 'PUT') {
      await handlePutAnnotations(req, res, annotationsMatch[1]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  if (pathname.startsWith('/api/')) {
    jsonResponse(res, 404, { error: 'Rota nao encontrada.' });
    return;
  }

  if (pathname.startsWith('/videos/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      methodNotAllowed(res);
      return;
    }
    await serveVideo(req, res, pathname);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    methodNotAllowed(res);
    return;
  }

  await serveStatic(req, res, pathname);
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    if (error.code === 'ENOENT') {
      jsonResponse(res, 404, { error: 'Nao encontrado.' });
      return;
    }

    console.error(error);
    if (!res.headersSent) {
      jsonResponse(res, 500, { error: 'Erro interno do servidor.' });
    } else {
      res.end();
    }
  });
});

function listen(port, remainingAttempts = 10) {
  const onListening = () => {
    server.off('error', onError);
    console.log(`Spill&Force rodando em http://localhost:${port}`);
  };

  const onError = (error) => {
    server.off('listening', onListening);

    if (error.code === 'EADDRINUSE' && remainingAttempts > 0) {
      listen(port + 1, remainingAttempts - 1);
      return;
    }

    console.error(error);
    process.exit(1);
  };

  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port);
}

listen(PORT);
