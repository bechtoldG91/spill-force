const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');
const { config } = require('./config');
const { createJsonRepository } = require('./repository');

const MAX_UPLOAD_MB = config.maxUploadMb;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

const ROOT_DIR = config.rootDir;
const PUBLIC_DIR = config.publicDir;
const STORAGE_DIR = config.storageDir;
const VIDEO_DIR = path.join(STORAGE_DIR, 'videos');
const DATA_FILE = path.join(STORAGE_DIR, 'videos.json');
const ANNOTATIONS_FILE = path.join(STORAGE_DIR, 'annotations.json');
const PLAYLISTS_FILE = path.join(STORAGE_DIR, 'playlists.json');
const USERS_FILE = path.join(STORAGE_DIR, 'users.json');
const TEAMS_FILE = path.join(STORAGE_DIR, 'teams.json');
const MAX_JSON_BODY_BYTES = 5 * 1024 * 1024;
const LEGACY_DEFAULT_PLAYLIST_ID = 'geral';
const LEGACY_OWNER_ID = 'legacy:gbechtold91@gmail.com';
const FFMPEG_LOG_LIMIT = 12000;

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
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.wmv': 'video/x-ms-wmv'
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
  return match ? match[0] : '';
}

function isVideoLike(contentType, extension) {
  const normalized = String(contentType || '').split(';')[0].toLowerCase();
  return Boolean(VIDEO_MIME[extension]) && (!normalized || normalized.startsWith('video/'));
}

function isInvalidVideoFfmpegOutput(stderr) {
  const normalized = String(stderr || '').toLowerCase();
  return [
    'invalid data found when processing input',
    'moov atom not found',
    'format not detected',
    'could not find codec parameters',
    'stream map \'0:v:0\' matches no streams',
    'matches no streams',
    'output file does not contain any stream',
    'does not contain any stream',
    'no streams to mux were specified',
    'unknown decoder',
    'unsupported codec'
  ].some((pattern) => normalized.includes(pattern));
}

function createFfmpegError(code, message, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.publicMessage = message;
  error.details = details;
  return error;
}

function logVideoProcessingError(message, error, context = {}) {
  console.error(`[video-processing] ${message}`, {
    ...context,
    code: error.code || error.message,
    exitCode: error.details?.exitCode,
    operation: error.details?.operation,
    stderr: error.details?.stderr,
    cause: error.details?.cause || error.cause?.message
  });
}

async function cleanupFiles(filePaths, context = {}) {
  const results = await Promise.allSettled(filePaths.map((filePath) => fsp.rm(filePath, { force: true })));

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error('[video-processing] falha ao remover arquivo temporario', {
        ...context,
        filePath: filePaths[index],
        error: result.reason?.message || String(result.reason)
      });
    }
  });
}

function removeAudioTrack(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(
        createFfmpegError('FFMPEG_NOT_AVAILABLE', 'Falha ao processar o video.', {
          operation: 'remove-audio',
          inputPath,
          outputPath
        })
      );
      return;
    }

    let process;
    try {
      process = spawn(
        ffmpegPath,
        ['-y', '-i', inputPath, '-map', '0:v:0', '-an', '-c:v', 'copy', outputPath],
        {
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe']
        }
      );
    } catch (error) {
      reject(
        createFfmpegError('FFMPEG_PROCESS_START_FAILED', 'Falha ao processar o video.', {
          operation: 'remove-audio',
          inputPath,
          outputPath,
          cause: error.message
        })
      );
      return;
    }

    let stderr = '';
    process.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > FFMPEG_LOG_LIMIT) {
        stderr = stderr.slice(-FFMPEG_LOG_LIMIT);
      }
    });

    process.once('error', (error) => {
      reject(
        createFfmpegError('FFMPEG_PROCESS_START_FAILED', 'Falha ao processar o video.', {
          operation: 'remove-audio',
          inputPath,
          outputPath,
          stderr,
          cause: error.message
        })
      );
    });
    process.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const invalidVideo = isInvalidVideoFfmpegOutput(stderr);
      reject(
        createFfmpegError(
          invalidVideo ? 'INVALID_VIDEO_FORMAT' : 'FFMPEG_AUDIO_STRIP_FAILED',
          invalidVideo ? 'O formato de video e invalido.' : 'Falha ao processar o video.',
          {
            operation: 'remove-audio',
            inputPath,
            outputPath,
            exitCode: code,
            stderr: stderr || `exit ${code}`
          }
        )
      );
    });
  });
}

function trimVideoTrack(inputPath, outputPath, start, duration) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('FFMPEG_NOT_AVAILABLE'));
      return;
    }

    const process = spawn(
      ffmpegPath,
      [
        '-y',
        '-ss',
        String(start),
        '-i',
        inputPath,
        '-t',
        String(duration),
        '-map',
        '0:v:0',
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        outputPath
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      }
    );

    let stderr = '';
    process.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) {
        stderr = stderr.slice(-4000);
      }
    });

    process.once('error', reject);
    process.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`FFMPEG_TRIM_FAILED: ${stderr || `exit ${code}`}`));
    });
  });
}

function concatVideoTracks(listPath, outputPath) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('FFMPEG_NOT_AVAILABLE'));
      return;
    }

    const process = spawn(
      ffmpegPath,
      [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listPath,
        '-map',
        '0:v:0',
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        outputPath
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      }
    );

    let stderr = '';
    process.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) {
        stderr = stderr.slice(-4000);
      }
    });

    process.once('error', reject);
    process.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`FFMPEG_CONCAT_FAILED: ${stderr || `exit ${code}`}`));
    });
  });
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
    return sanitizePlaylists(Array.isArray(parsed) ? parsed : []);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writePlaylists(playlists) {
  await ensureStorage();
  const tempFile = `${PLAYLISTS_FILE}.tmp`;
  await fsp.writeFile(tempFile, `${JSON.stringify(sanitizePlaylists(playlists), null, 2)}\n`, 'utf8');
  await fsp.rename(tempFile, PLAYLISTS_FILE);
}

async function writeAnnotationsStore(store) {
  await ensureStorage();
  const tempFile = `${ANNOTATIONS_FILE}.tmp`;
  await fsp.writeFile(tempFile, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await fsp.rename(tempFile, ANNOTATIONS_FILE);
}

async function readUsersStore() {
  await ensureStorage();

  try {
    const raw = await fsp.readFile(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function sanitizeTeams(teams) {
  const sanitizeRequests = (requests, includeRole = false) =>
    (Array.isArray(requests) ? requests : [])
      .filter((request) => request && typeof request === 'object')
      .map((request) => ({
        id: safeText(request.id, 80) || randomUUID(),
        userId: safeText(request.userId, 100),
        requestedRole: includeRole ? safeText(request.requestedRole, 40) : '',
        requestedAt: safeText(request.requestedAt, 40) || new Date().toISOString(),
        status: safeText(request.status, 40) || 'pending'
      }))
      .filter((request) => request.userId && request.status === 'pending')
      .slice(0, 100);
  const sanitizeInvites = (invites) =>
    (Array.isArray(invites) ? invites : [])
      .filter((invite) => invite && typeof invite === 'object')
      .map((invite) => ({
        id: safeText(invite.id, 80) || randomUUID(),
        code: safeText(invite.code, 120) || randomUUID(),
        email: safeText(invite.email, 160).toLowerCase(),
        role: safeText(invite.role, 40),
        invitedBy: safeText(invite.invitedBy, 100),
        invitedAt: safeText(invite.invitedAt, 40) || new Date().toISOString(),
        expiresAt: safeText(invite.expiresAt, 40),
        status: safeText(invite.status, 40) || 'pending'
      }))
      .filter((invite) => invite.email && invite.role && invite.status === 'pending')
      .slice(0, 200);

  return (Array.isArray(teams) ? teams : [])
    .filter((team) => team && typeof team === 'object')
    .map((team) => ({
      id: safeText(team.id, 80) || randomUUID(),
      name: safeText(team.name, 120) || 'Time',
      city: safeText(team.city, 120),
      logoDataUrl: safeText(team.logoDataUrl, 900000),
      coverDataUrl: safeText(team.coverDataUrl, 3000000),
      upcomingEvents: (Array.isArray(team.upcomingEvents) ? team.upcomingEvents : [])
        .filter((event) => event && typeof event === 'object')
        .map((event) => ({
          id: safeText(event.id, 80) || randomUUID(),
          title: safeText(event.title, 120),
          startsAt: safeText(event.startsAt, 40),
          location: safeText(event.location, 120)
        }))
        .filter((event) => event.title)
        .slice(0, 20),
      socialLinks: {
        instagram: safeText(team.socialLinks?.instagram, 300),
        website: safeText(team.socialLinks?.website, 300),
        facebook: safeText(team.socialLinks?.facebook, 300),
        x: safeText(team.socialLinks?.x, 300)
      },
      ownerIds: Array.isArray(team.ownerIds)
        ? [...new Set(team.ownerIds.map((ownerId) => safeText(ownerId, 100)).filter(Boolean))].slice(0, 50)
        : [],
      invites: sanitizeInvites(team.invites),
      roleChangeRequests: sanitizeRequests(team.roleChangeRequests, true)
    }))
    .filter((team) => team.name);
}

async function readTeamsStore() {
  await ensureStorage();

  try {
    const raw = await fsp.readFile(TEAMS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return sanitizeTeams(parsed);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeTeamsStore(teams) {
  await ensureStorage();
  const tempFile = `${TEAMS_FILE}.tmp`;
  await fsp.writeFile(tempFile, `${JSON.stringify(sanitizeTeams(teams), null, 2)}\n`, 'utf8');
  await fsp.rename(tempFile, TEAMS_FILE);
}

async function writeUsersStore(users) {
  await ensureStorage();
  const tempFile = `${USERS_FILE}.tmp`;
  await fsp.writeFile(tempFile, `${JSON.stringify(Array.isArray(users) ? users : [], null, 2)}\n`, 'utf8');
  await fsp.rename(tempFile, USERS_FILE);
}

async function saveVideoFile(readable, storageName, { maxBytes = MAX_UPLOAD_BYTES } = {}) {
  await ensureStorage();

  const safeStorageName = safeBaseName(storageName);
  const finalPath = path.join(VIDEO_DIR, safeStorageName);
  const tempPath = path.join(VIDEO_DIR, `${safeStorageName}.tmp`);
  let receivedSize = 0;

  if (!isInside(VIDEO_DIR, finalPath) || !isInside(VIDEO_DIR, tempPath)) {
    throw new Error('INVALID_VIDEO_STORAGE_PATH');
  }

  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      receivedSize += chunk.length;
      if (receivedSize > maxBytes) {
        callback(new Error('UPLOAD_LIMIT_EXCEEDED'));
        return;
      }
      callback(null, chunk);
    }
  });

  try {
    await pipeline(readable, limiter, fs.createWriteStream(tempPath, { flags: 'wx' }));
  } catch (error) {
    await cleanupFiles([tempPath], {
      operation: 'upload-write',
      storageName: safeStorageName
    });
    throw error;
  }

  if (receivedSize === 0) {
    await cleanupFiles([tempPath], {
      operation: 'empty-upload',
      storageName: safeStorageName
    });
    throw new Error('EMPTY_VIDEO_UPLOAD');
  }

  try {
    await removeAudioTrack(tempPath, finalPath);
    let stat;
    try {
      stat = await fsp.stat(finalPath);
    } catch (error) {
      throw createFfmpegError('FFMPEG_OUTPUT_MISSING', 'Falha ao processar o video.', {
        operation: 'remove-audio',
        inputPath: tempPath,
        outputPath: finalPath,
        cause: error.message
      });
    }
    await cleanupFiles([tempPath], {
      operation: 'upload-success',
      storageName: safeStorageName
    });
    return {
      size: stat.size
    };
  } catch (error) {
    logVideoProcessingError('falha ao remover audio no upload', error, {
      storageName: safeStorageName,
      tempPath,
      finalPath
    });
    await cleanupFiles([tempPath, finalPath], {
      operation: 'upload-ffmpeg-failure',
      storageName: safeStorageName
    });
    throw error;
  }
}

async function removeVideoFile(storageName) {
  const safeStorageName = safeBaseName(storageName);
  const filePath = path.join(VIDEO_DIR, safeStorageName);

  if (!isInside(VIDEO_DIR, filePath)) {
    throw new Error('INVALID_VIDEO_STORAGE_PATH');
  }

  await fsp.rm(filePath, { force: true });
}

function ffmpegConcatPath(filePath) {
  return path.resolve(filePath).replace(/\\/g, '/').replace(/'/g, "'\\''");
}

async function buildRemainingVideoOutputFile(storageName, outputStorageName, ranges) {
  await ensureStorage();

  const safeStorageName = safeBaseName(storageName);
  const safeOutputStorageName = safeBaseName(outputStorageName);
  const filePath = path.join(VIDEO_DIR, safeStorageName);
  const outputPath = path.join(VIDEO_DIR, safeOutputStorageName);
  const extension = path.extname(safeOutputStorageName) || path.extname(safeStorageName) || '.mp4';
  const listPath = path.join(VIDEO_DIR, `${safeStorageName}.${randomUUID()}.concat.txt`);
  const segmentPaths = [];
  const safeRanges = (Array.isArray(ranges) ? ranges : [])
    .map((range) => ({
      start: Number(range.start),
      end: Number(range.end)
    }))
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.start >= 0 && range.end - range.start >= 0.05);

  if (!isInside(VIDEO_DIR, filePath) || !isInside(VIDEO_DIR, outputPath) || !isInside(VIDEO_DIR, listPath)) {
    throw new Error('INVALID_VIDEO_STORAGE_PATH');
  }

  if (!safeRanges.length) {
    throw new Error('INVALID_REMAINING_VIDEO_RANGES');
  }

  try {
    if (safeRanges.length === 1) {
      await trimVideoTrack(filePath, outputPath, safeRanges[0].start, safeRanges[0].end - safeRanges[0].start);
    } else {
      for (const [index, range] of safeRanges.entries()) {
        const segmentPath = path.join(VIDEO_DIR, `${safeStorageName}.${randomUUID()}.part-${index}${extension}`);
        if (!isInside(VIDEO_DIR, segmentPath)) {
          throw new Error('INVALID_VIDEO_STORAGE_PATH');
        }

        await trimVideoTrack(filePath, segmentPath, range.start, range.end - range.start);
        segmentPaths.push(segmentPath);
      }

      const concatList = segmentPaths.map((segmentPath) => `file '${ffmpegConcatPath(segmentPath)}'`).join('\n');
      await fsp.writeFile(listPath, `${concatList}\n`, 'utf8');
      await concatVideoTracks(listPath, outputPath);
    }

    const stat = await fsp.stat(outputPath);

    return {
      size: stat.size
    };
  } finally {
    await Promise.all([
      fsp.rm(listPath, { force: true }).catch(() => {}),
      ...segmentPaths.map((segmentPath) => fsp.rm(segmentPath, { force: true }).catch(() => {}))
    ]);
  }
}

async function extractVideoClipFile(storageName, outputStorageName, { start, end }) {
  await ensureStorage();

  const safeStorageName = safeBaseName(storageName);
  const safeOutputStorageName = safeBaseName(outputStorageName);
  const inputPath = path.join(VIDEO_DIR, safeStorageName);
  const outputPath = path.join(VIDEO_DIR, safeOutputStorageName);

  if (!isInside(VIDEO_DIR, inputPath) || !isInside(VIDEO_DIR, outputPath)) {
    throw new Error('INVALID_VIDEO_STORAGE_PATH');
  }

  await trimVideoTrack(inputPath, outputPath, start, end - start);
  const stat = await fsp.stat(outputPath);

  return {
    size: stat.size
  };
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

function sanitizePlaylists(playlists) {
  return playlists
    .filter((playlist) => playlist && typeof playlist === 'object')
    .map((playlist) => ({
      id: safeText(playlist.id, 80) || randomUUID(),
      ownerId: safeText(playlist.ownerId, 100),
      teamId: safeText(playlist.teamId, 80),
      name: safeText(playlist.name, 120) || 'Playlist',
      description: safeText(playlist.description, 260),
      createdAt: safeText(playlist.createdAt, 40) || new Date().toISOString(),
      updatedAt: safeText(playlist.updatedAt, 40) || new Date().toISOString()
    }))
    .filter((playlist) => playlist.id !== LEGACY_DEFAULT_PLAYLIST_ID && playlist.name.toLowerCase() !== 'geral');
}

const metadataRepository = createJsonRepository({
  readVideos: readCatalog,
  writeVideos: writeCatalog,
  readPlaylists,
  writePlaylists,
  readAnnotations: readAnnotationsStore,
  writeAnnotations: writeAnnotationsStore,
  readUsers: readUsersStore,
  writeUsers: writeUsersStore,
  readTeams: readTeamsStore,
  writeTeams: writeTeamsStore,
  legacyOwnerId: LEGACY_OWNER_ID
});

function metadataTransaction(task) {
  return queueMetadataMutation(() => task(metadataRepository));
}

const storageService = {
  transaction: metadataTransaction,
  listVideos: (options) => metadataRepository.listVideos(options),
  findVideoById: (id, options) => metadataRepository.findVideoById(id, options),
  findVideoByStorageName: (storageName, options) => metadataRepository.findVideoByStorageName(storageName, options),
  createVideo: (video) => metadataTransaction((repository) => repository.createVideo(video)),
  saveVideos: (videos, options) => metadataTransaction((repository) => repository.saveVideos(videos, options)),
  updateVideo: (id, updater, options) => metadataTransaction((repository) => repository.updateVideo(id, updater, options)),
  deleteVideo: (id, options) => metadataTransaction((repository) => repository.deleteVideo(id, options)),
  listPlaylists: (options) => metadataRepository.listPlaylists(options),
  findPlaylistById: (id, options) => metadataRepository.findPlaylistById(id, options),
  createPlaylist: (playlist) => metadataTransaction((repository) => repository.createPlaylist(playlist)),
  savePlaylists: (playlists, options) => metadataTransaction((repository) => repository.savePlaylists(playlists, options)),
  deletePlaylist: (id, options) => metadataTransaction((repository) => repository.deletePlaylist(id, options)),
  getAnnotations: (videoId) => metadataRepository.getAnnotations(videoId),
  saveAnnotations: (videoId, annotations) => metadataTransaction((repository) => repository.saveAnnotations(videoId, annotations)),
  deleteAnnotations: (videoId) => metadataTransaction((repository) => repository.deleteAnnotations(videoId)),
  deleteAnnotationsForVideos: (videoIds) => metadataTransaction((repository) => repository.deleteAnnotationsForVideos(videoIds)),
  listUsers: () => metadataRepository.listUsers(),
  findUserByEmail: (email) => metadataRepository.findUserByEmail(email),
  findUserById: (id) => metadataRepository.findUserById(id),
  createUser: (user) => metadataTransaction((repository) => repository.createUser(user)),
  updateUser: (id, updater) => metadataTransaction((repository) => repository.updateUser(id, updater)),
  deleteUser: (id) => metadataTransaction((repository) => repository.deleteUser(id)),
  listTeams: () => metadataRepository.listTeams(),
  findTeamById: (id) => metadataRepository.findTeamById(id),
  createTeam: (team) => metadataTransaction((repository) => repository.createTeam(team)),
  saveTeams: (teams) => metadataTransaction((repository) => repository.saveTeams(teams)),
  listTeamMembers: (teamId) => metadataRepository.listTeamMembers(teamId),
  removeVideoFile,
  saveVideoFile,
  buildRemainingVideoOutputFile,
  extractVideoClipFile
};

module.exports = {
  MAX_UPLOAD_MB,
  MAX_UPLOAD_BYTES,
  PUBLIC_DIR,
  VIDEO_DIR,
  LEGACY_DEFAULT_PLAYLIST_ID,
  LEGACY_OWNER_ID,
  storageService,
  queueMetadataMutation,
  jsonResponse,
  methodNotAllowed,
  safeText,
  sanitizePlaylists,
  sanitizeTeams,
  safeBaseName,
  isInside,
  getMime,
  getVideoExtension,
  isVideoLike,
  readJsonBody
};
