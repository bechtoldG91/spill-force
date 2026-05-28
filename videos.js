const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  MAX_UPLOAD_MB,
  MAX_UPLOAD_BYTES,
  storageService,
  jsonResponse,
  safeText,
  safeBaseName,
  getVideoExtension,
  isVideoLike,
  readJsonBody
} = require('./storage');
const { ensurePlaylistForDate, loadLibraryState, videoSummary } = require('./playlists');
const { accessScope, authorizeRoles, getTeamIdFromRequest } = require('./auth');

function parseTags(raw) {
  return safeText(raw, 240)
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeTags(raw) {
  if (Array.isArray(raw)) {
    return raw.map((tag) => safeText(tag, 60)).filter(Boolean).slice(0, 12);
  }

  return parseTags(raw);
}

let videoProcessingQueue = Promise.resolve();

function enqueueVideoProcessing(task) {
  const next = videoProcessingQueue.then(task, task);
  videoProcessingQueue = next.catch((error) => {
    console.error('[video-processing] job falhou fora do fluxo esperado', error);
  });
  return next;
}

function processingOperationLabel(operation) {
  return operation === 'long-cut' ? 'corte longo' : 'corte';
}

function processingUser(user) {
  return {
    id: safeText(user?.id, 100),
    name: safeText(user?.name, 120) || safeText(user?.email, 160) || 'outro usuario',
    email: safeText(user?.email, 160).toLowerCase()
  };
}

function activeProcessing(video) {
  return video?.processing && typeof video.processing === 'object' && ['queued', 'processing'].includes(video.processing.status);
}

function processingLockedMessage(video) {
  const name = safeText(video?.processing?.requestedBy?.name, 120) || 'outro usuario';
  return `Video ja esta sendo editado por ${name}.`;
}

function processingLockResponse(res, video) {
  jsonResponse(res, 409, {
    error: processingLockedMessage(video),
    processing: video.processing || null
  });
}

function processingMetadata({ id, operation, user, status = 'queued' }) {
  const now = new Date().toISOString();
  const label = processingOperationLabel(operation);
  return {
    id,
    operation,
    status,
    message: `Processando ${label}.`,
    requestedBy: processingUser(user),
    startedAt: now,
    updatedAt: now
  };
}

function videoUrl(storageName, teamId = '') {
  return `/videos/${encodeURIComponent(storageName)}${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`;
}

async function cleanupVideoFiles(storageNames) {
  await Promise.all(
    [...new Set((Array.isArray(storageNames) ? storageNames : []).filter(Boolean))].map((storageName) =>
      storageService.removeVideoFile(storageName).catch((error) => {
        console.error('[video-processing] falha ao remover arquivo de processamento', {
          storageName,
          error: error.message
        });
      })
    )
  );
}

async function markProcessingRunning(job) {
  await storageService.transaction(async (repository) => {
    const videos = await repository.listVideos(job.scope);
    const index = videos.findIndex((video) => video.id === job.videoId);
    if (index === -1 || videos[index].processing?.id !== job.id) {
      return null;
    }

    videos[index] = {
      ...videos[index],
      processing: {
        ...videos[index].processing,
        status: 'processing',
        updatedAt: new Date().toISOString()
      }
    };
    await repository.saveVideos(videos, job.scope);
    return videos[index];
  });
}

async function markProcessingFailed(job, error, createdStorageNames = []) {
  console.error('[video-processing] falha no job de video', {
    jobId: job.id,
    videoId: job.videoId,
    operation: job.operation,
    error: error.message
  });

  await cleanupVideoFiles(createdStorageNames);

  await storageService.transaction(async (repository) => {
    const videos = await repository.listVideos(job.scope);
    const index = videos.findIndex((video) => video.id === job.videoId);
    if (index === -1 || videos[index].processing?.id !== job.id) {
      return null;
    }

    const nextVideo = {
      ...videos[index],
      processing: null,
      processingError: {
        operation: job.operation,
        message: 'Falha ao processar o video.',
        failedAt: new Date().toISOString(),
        requestedBy: job.requestedBy
      },
      updatedAt: new Date().toISOString()
    };

    delete nextVideo.processing;
    videos[index] = nextVideo;
    await repository.saveVideos(videos, job.scope);
    return nextVideo;
  });
}

async function runTrimProcessingJob(job) {
  const createdStorageNames = [];
  try {
    await markProcessingRunning(job);
    const extension = path.extname(job.sourceStorageName) || '.mp4';
    const outputStorageName = `${randomUUID()}${extension}`;
    createdStorageNames.push(outputStorageName);
    const trimmedFile = await storageService.extractVideoClipFile(job.sourceStorageName, outputStorageName, {
      start: job.start,
      end: job.end
    });

    const finalized = await storageService.transaction(async (repository) => {
      const videos = await repository.listVideos(job.scope);
      const index = videos.findIndex((video) => video.id === job.videoId);
      if (index === -1 || videos[index].processing?.id !== job.id || videos[index].storageName !== job.sourceStorageName) {
        return { committed: false };
      }

      const now = new Date().toISOString();
      const nextVideo = {
        ...videos[index],
        storageName: outputStorageName,
        url: `${videoUrl(outputStorageName, job.scope.teamId || '')}${job.scope.teamId ? '&' : '?'}v=${Date.now()}`,
        size: trimmedFile.size,
        duration: Math.max(1, Math.round(job.end - job.start)),
        processing: null,
        processingError: null,
        updatedAt: now
      };
      delete nextVideo.processing;
      delete nextVideo.processingError;
      videos[index] = nextVideo;
      await repository.saveVideos(videos, job.scope);
      return { committed: true };
    });

    if (!finalized.committed) {
      await cleanupVideoFiles(createdStorageNames);
      return;
    }

    await cleanupVideoFiles([job.sourceStorageName]);
  } catch (error) {
    await markProcessingFailed(job, error, createdStorageNames);
  }
}

async function runLongCutProcessingJob(job) {
  const createdStorageNames = [];
  try {
    await markProcessingRunning(job);
    const extension = path.extname(job.sourceStorageName) || path.extname(job.originalName) || '.mp4';
    const now = new Date().toISOString();
    const createdClips = [];

    for (const [clipIndex, clip] of job.clips.entries()) {
      const clipId = randomUUID();
      const storageName = `${clipId}${extension}`;
      const clipFile = await storageService.extractVideoClipFile(job.sourceStorageName, storageName, clip);
      const clipNumber = String(clipIndex + 1).padStart(2, '0');
      createdStorageNames.push(storageName);
      createdClips.push({
        ...job.sourceVideo,
        id: clipId,
        title: `${job.sourceVideo.title} - Clipe ${clipNumber}`,
        originalName: `${path.basename(job.originalName || job.sourceStorageName, extension)}-clipe-${clipNumber}${extension}`,
        storageName,
        url: videoUrl(storageName, job.scope.teamId || ''),
        size: clipFile.size,
        duration: Math.max(1, Math.round(clip.end - clip.start)),
        notes: safeText(`Corte ${formatRangeLabel(clip.start, clip.end)}`, 500),
        processing: null,
        processingError: null,
        createdAt: now,
        updatedAt: now
      });
    }

    let remainingStorageName = '';
    let remainingFile = null;
    if (job.remainingRanges.length) {
      remainingStorageName = `${randomUUID()}${extension}`;
      createdStorageNames.push(remainingStorageName);
      remainingFile = await storageService.buildRemainingVideoOutputFile(job.sourceStorageName, remainingStorageName, job.remainingRanges);
    }

    const finalized = await storageService.transaction(async (repository) => {
      const videos = await repository.listVideos(job.scope);
      const index = videos.findIndex((video) => video.id === job.videoId);
      if (index === -1 || videos[index].processing?.id !== job.id || videos[index].storageName !== job.sourceStorageName) {
        return { committed: false };
      }

      const currentVideo = videos[index];
      if (remainingFile && remainingStorageName) {
        const nextVideo = {
          ...currentVideo,
          title: `${currentVideo.title} - Restante`,
          storageName: remainingStorageName,
          url: `${videoUrl(remainingStorageName, job.scope.teamId || '')}${job.scope.teamId ? '&' : '?'}v=${Date.now()}`,
          size: remainingFile.size,
          duration: Math.max(1, Math.round(job.remainingDuration)),
          processing: null,
          processingError: null,
          updatedAt: now
        };
        delete nextVideo.processing;
        delete nextVideo.processingError;
        videos.splice(index, 1, nextVideo, ...createdClips.map((clip) => {
          const nextClip = {
            ...clip,
            playlistId: currentVideo.playlistId,
            playlistName: currentVideo.playlistName
          };
          delete nextClip.processing;
          delete nextClip.processingError;
          return nextClip;
        }));
      } else {
        videos.splice(index, 1, ...createdClips.map((clip) => {
          const nextClip = {
            ...clip,
            playlistId: currentVideo.playlistId,
            playlistName: currentVideo.playlistName
          };
          delete nextClip.processing;
          delete nextClip.processingError;
          return nextClip;
        }));
        await repository.deleteAnnotations(job.videoId);
      }

      await repository.saveVideos(videos, job.scope);
      return { committed: true };
    });

    if (!finalized.committed) {
      await cleanupVideoFiles(createdStorageNames);
      return;
    }

    await cleanupVideoFiles([job.sourceStorageName]);
  } catch (error) {
    await markProcessingFailed(job, error, createdStorageNames);
  }
}

async function recoverInterruptedVideoProcessing() {
  await storageService.transaction(async (repository) => {
    const videos = await repository.listVideos();
    let changed = false;
    const nextVideos = videos.map((video) => {
      if (!activeProcessing(video)) {
        return video;
      }

      changed = true;
      const nextVideo = {
        ...video,
        processing: null,
        processingError: {
          operation: safeText(video.processing?.operation, 40),
          message: 'Processamento interrompido antes de concluir.',
          failedAt: new Date().toISOString(),
          requestedBy: video.processing?.requestedBy || {}
        },
        updatedAt: new Date().toISOString()
      };
      delete nextVideo.processing;
      return nextVideo;
    });

    if (changed) {
      await repository.saveVideos(nextVideos);
    }
  });
}

async function handleListVideos(req, res) {
  const teamId = getTeamIdFromRequest(req);
  const access = await authorizeRoles(req, res, teamId, ['admin', 'treinador', 'atleta']);
  if (!access) {
    return;
  }
  const scope = accessScope(access);
  const { videos, playlists } = await storageService.transaction((repository) => loadLibraryState({ persist: true, repository, ...scope }));
  jsonResponse(res, 200, { videos: videos.map((video) => videoSummary(video, playlists)) });
}

async function handleCreateVideo(req, res, requestUrl) {
  const params = requestUrl.searchParams;
  const originalName = safeBaseName(params.get('fileName'));
  const contentType = safeText(req.headers['content-type'] || 'application/octet-stream', 120);
  const extension = getVideoExtension(originalName, contentType);

  if (!isVideoLike(contentType, extension)) {
    jsonResponse(res, 415, { error: 'Use um arquivo AVI, MOV, MP4, MPEG, MPG ou WMV.' });
    return;
  }

  const id = randomUUID();
  const storageName = `${id}${extension}`;
  const teamId = getTeamIdFromRequest(req, requestUrl);
  const access = await authorizeRoles(req, res, teamId, ['admin', 'treinador']);
  if (!access) {
    return;
  }
  const user = access.user;
  const scope = accessScope(access);
  const ownerId = scope.ownerId;
  let savedFile;

  try {
    savedFile = await storageService.saveVideoFile(req, storageName, { maxBytes: MAX_UPLOAD_BYTES });
  } catch (error) {
    if (error.message === 'UPLOAD_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: `Video maior que o limite de ${MAX_UPLOAD_MB} MB.` });
      return;
    }
    if (error.message === 'EMPTY_VIDEO_UPLOAD') {
      jsonResponse(res, 400, { error: 'O arquivo enviado esta vazio.' });
      return;
    }
    if (error.code === 'INVALID_VIDEO_FORMAT') {
      jsonResponse(res, 415, { error: error.publicMessage || 'O formato de video e invalido.' });
      return;
    }
    if (
      error.code === 'FFMPEG_AUDIO_STRIP_FAILED' ||
      error.code === 'FFMPEG_PROCESS_START_FAILED' ||
      error.code === 'FFMPEG_NOT_AVAILABLE' ||
      error.code === 'FFMPEG_OUTPUT_MISSING'
    ) {
      jsonResponse(res, error.code === 'FFMPEG_NOT_AVAILABLE' ? 500 : 422, {
        error: error.publicMessage || 'Falha ao processar o video.'
      });
      return;
    }
    throw error;
  }

  let result;
  try {
    result = await storageService.transaction(async (repository) => {
      const now = new Date().toISOString();
      const duration = Number(params.get('duration'));
      const { videos, playlists } = await loadLibraryState({ persist: false, repository, ...scope });
      const requestedPlaylistId = safeText(params.get('playlistId'), 80);
      const playlist = playlists.find((item) => item.id === requestedPlaylistId) || ensurePlaylistForDate(playlists, now, ownerId, scope.teamId || '');
      const video = {
        id,
        ownerId,
        teamId: scope.teamId || '',
        title: safeText(params.get('title'), 160) || path.basename(originalName, extension),
        team: safeText(params.get('team'), 120) || 'Sem equipe',
        athlete: safeText(params.get('athlete'), 120),
        kind: safeText(params.get('kind'), 40) || 'jogo',
        uploader: user.name,
        tags: parseTags(params.get('tags')),
        notes: safeText(params.get('notes'), 500),
        visibility: safeText(params.get('visibility'), 40) || 'equipe',
        playlistId: playlist.id,
        originalName,
        storageName,
        url: `/videos/${encodeURIComponent(storageName)}${scope.teamId ? `?teamId=${encodeURIComponent(scope.teamId)}` : ''}`,
        contentType: contentType.split(';')[0],
        size: savedFile.size,
        duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
        createdAt: now,
        updatedAt: now
      };

      videos.unshift(video);
      await repository.saveVideos(videos, scope);
      await repository.savePlaylists(playlists, scope);

      return {
        status: 201,
        video: videoSummary(video, playlists)
      };
    });
  } catch (error) {
    console.error('[video-processing] falha ao salvar metadados apos upload; removendo arquivo processado', {
      storageName,
      error: error.message
    });
    await storageService.removeVideoFile(storageName).catch((cleanupError) => {
      console.error('[video-processing] falha ao remover arquivo processado apos erro de metadados', {
        storageName,
        error: cleanupError.message
      });
    });
    throw error;
  }

  jsonResponse(res, result.status, { video: result.video });
}

async function handleDeleteVideo(req, res, id) {
  const teamId = getTeamIdFromRequest(req);
  const access = await authorizeRoles(req, res, teamId, ['admin', 'treinador']);
  if (!access) {
    return;
  }
  const scope = accessScope(access);
  const result = await storageService.transaction(async (repository) => {
    const videos = await repository.listVideos(scope);
    const index = videos.findIndex((video) => video.id === id);

    if (index === -1) {
      return { found: false };
    }

    const video = videos[index];
    if (activeProcessing(video)) {
      return { found: true, locked: true, video };
    }

    videos.splice(index, 1);
    await repository.saveVideos(videos, scope);
    await repository.deleteAnnotations(id);

    return {
      found: true,
      storageName: video.storageName
    };
  });

  if (!result.found) {
    jsonResponse(res, 404, { error: 'Video nao encontrado.' });
    return;
  }

  if (result.locked) {
    processingLockResponse(res, result.video);
    return;
  }

  await storageService.removeVideoFile(result.storageName);

  jsonResponse(res, 200, { ok: true });
}

async function handleUpdateVideo(req, res, id) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error.message === 'JSON_BODY_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: 'Dados maiores que o limite permitido.' });
      return;
    }
    if (error instanceof SyntaxError) {
      jsonResponse(res, 400, { error: 'JSON invalido.' });
      return;
    }
    throw error;
  }

  const result = await storageService.transaction(async (repository) => {
    const teamId = getTeamIdFromRequest(req, null, payload);
    const access = await authorizeRoles(req, res, teamId, ['admin', 'treinador']);
    if (!access) {
      return { unauthorized: true };
    }
    const scope = accessScope(access);
    const videos = await repository.listVideos(scope);
    const index = videos.findIndex((video) => video.id === id);

    if (index === -1) {
      return { found: false };
    }

    if (activeProcessing(videos[index])) {
      return { found: true, locked: true, video: videos[index] };
    }

    const playlists = await repository.listPlaylists(scope);
    const nextPlaylistId = Object.prototype.hasOwnProperty.call(payload, 'playlistId')
      ? safeText(payload.playlistId, 80)
      : videos[index].playlistId;
    const playlist = playlists.find((item) => item.id === nextPlaylistId);
    if (!playlist) {
      return { found: true, playlistFound: false };
    }

    const textField = (field, maxLength, fallback = '') =>
      Object.prototype.hasOwnProperty.call(payload, field)
        ? safeText(payload[field], maxLength)
        : videos[index][field] || fallback;

    const nextVideo = {
      ...videos[index],
      title: textField('title', 160, videos[index].title),
      team: textField('team', 120),
      athlete: textField('athlete', 120),
      kind: textField('kind', 40, videos[index].kind || 'video') || videos[index].kind || 'video',
      uploader: textField('uploader', 120),
      tags: Object.prototype.hasOwnProperty.call(payload, 'tags') ? normalizeTags(payload.tags) : videos[index].tags,
      notes: textField('notes', 500),
      visibility: textField('visibility', 40, videos[index].visibility || 'equipe') || videos[index].visibility || 'equipe',
      playlistId: playlist.id,
      updatedAt: new Date().toISOString()
    };

    videos[index] = nextVideo;
    await repository.saveVideos(videos, scope);

    return {
      found: true,
      playlistFound: true,
      video: videoSummary(nextVideo, playlists)
    };
  });

  if (result.unauthorized) {
    return;
  }

  if (!result.found) {
    jsonResponse(res, 404, { error: 'Video nao encontrado.' });
    return;
  }

  if (result.locked) {
    processingLockResponse(res, result.video);
    return;
  }

  if (!result.playlistFound) {
    jsonResponse(res, 404, { error: 'Playlist nao encontrada.' });
    return;
  }

  jsonResponse(res, 200, { video: result.video });
}

async function handleTrimVideo(req, res, id) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error.message === 'JSON_BODY_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: 'Dados maiores que o limite permitido.' });
      return;
    }
    if (error instanceof SyntaxError) {
      jsonResponse(res, 400, { error: 'JSON invalido.' });
      return;
    }
    throw error;
  }

  const start = Number(payload.start);
  const end = Number(payload.end);

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start < 0.5) {
    jsonResponse(res, 400, { error: 'Informe inicio e fim validos para o corte.' });
    return;
  }

  const result = await storageService.transaction(async (repository) => {
    const teamId = getTeamIdFromRequest(req, null, payload);
    const access = await authorizeRoles(req, res, teamId, ['admin', 'treinador']);
    if (!access) {
      return { unauthorized: true };
    }
    const scope = accessScope(access);
    const { videos, playlists } = await loadLibraryState({ persist: false, repository, ...scope });
    const index = videos.findIndex((video) => video.id === id);

    if (index === -1) {
      return { found: false };
    }

    const video = videos[index];
    if (activeProcessing(video)) {
      return { found: true, locked: true, video };
    }

    const metadataDuration = Number(video.duration);
    const payloadDuration = Number(payload.duration);
    const currentDuration =
      Number.isFinite(payloadDuration) && payloadDuration > 0
        ? Math.max(Number.isFinite(metadataDuration) ? metadataDuration : 0, payloadDuration)
        : metadataDuration;
    const safeEnd = Number.isFinite(currentDuration) && currentDuration > 0 ? Math.min(end, currentDuration) : end;

    if (safeEnd <= start || safeEnd - start < 0.5) {
      return { found: true, invalidRange: true };
    }

    const jobId = randomUUID();
    const processing = processingMetadata({
      id: jobId,
      operation: 'trim',
      user: access.user
    });
    const nextVideo = {
      ...video,
      processing,
      processingError: null,
      updatedAt: new Date().toISOString()
    };
    delete nextVideo.processingError;
    videos[index] = nextVideo;
    await repository.saveVideos(videos, scope);

    return {
      found: true,
      invalidRange: false,
      job: {
        id: jobId,
        operation: 'trim',
        videoId: video.id,
        sourceStorageName: video.storageName,
        originalName: video.originalName,
        sourceUpdatedAt: video.updatedAt,
        start,
        end: safeEnd,
        scope,
        requestedBy: processing.requestedBy
      },
      video: videoSummary(nextVideo, playlists)
    };
  });

  if (result.unauthorized) {
    return;
  }

  if (!result.found) {
    jsonResponse(res, 404, { error: 'Video nao encontrado.' });
    return;
  }

  if (result.locked) {
    processingLockResponse(res, result.video);
    return;
  }

  if (result.invalidRange) {
    jsonResponse(res, 400, { error: 'Intervalo de corte invalido.' });
    return;
  }

  enqueueVideoProcessing(() => runTrimProcessingJob(result.job));

  jsonResponse(res, 202, {
    job: {
      id: result.job.id,
      operation: result.job.operation,
      videoId: result.job.videoId,
      status: 'queued'
    },
    video: result.video
  });
}

function formatSecondsLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }

  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remainingSeconds = total % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function formatRangeLabel(start, end) {
  return `${formatSecondsLabel(start)}-${formatSecondsLabel(end)}`;
}

function normalizeLongCutClips(rawClips, duration) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
  const clips = Array.isArray(rawClips)
    ? rawClips
        .map((clip) => ({
          start: Math.max(0, Number(clip?.start)),
          end: Math.min(safeDuration, Number(clip?.end))
        }))
        .filter((clip) => Number.isFinite(clip.start) && Number.isFinite(clip.end))
        .sort((left, right) => left.start - right.start)
    : [];

  const normalized = [];
  let previousEnd = 0;

  for (const clip of clips) {
    let start = Number(clip.start.toFixed(2));
    const end = Number(clip.end.toFixed(2));

    if (start < previousEnd - 0.05 || end <= start) {
      return null;
    }

    start = Math.max(start, previousEnd);
    if (end - start < 0.5) {
      return null;
    }

    normalized.push({ start, end });
    previousEnd = end;
  }

  return normalized.slice(0, 200);
}

function getRemainingRangesAfterClips(clips, duration) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return [];
  }

  const ranges = [];
  let previousEnd = 0;

  for (const clip of clips) {
    if (clip.start - previousEnd >= 0.05) {
      ranges.push({
        start: Number(previousEnd.toFixed(2)),
        end: Number(clip.start.toFixed(2))
      });
    }
    previousEnd = Math.max(previousEnd, clip.end);
  }

  if (duration - previousEnd >= 0.05) {
    ranges.push({
      start: Number(previousEnd.toFixed(2)),
      end: Number(duration.toFixed(2))
    });
  }

  return ranges.filter((range) => range.end > range.start);
}

function rangesDuration(ranges) {
  return ranges.reduce((total, range) => total + Math.max(0, range.end - range.start), 0);
}

async function handleLongCutVideo(req, res, id) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error.message === 'JSON_BODY_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: 'Dados maiores que o limite permitido.' });
      return;
    }
    if (error instanceof SyntaxError) {
      jsonResponse(res, 400, { error: 'JSON invalido.' });
      return;
    }
    throw error;
  }

  const result = await storageService.transaction(async (repository) => {
    const teamId = getTeamIdFromRequest(req, null, payload);
    const access = await authorizeRoles(req, res, teamId, ['admin', 'treinador']);
    if (!access) {
      return { unauthorized: true };
    }
    const scope = accessScope(access);
    const { videos, playlists } = await loadLibraryState({ persist: false, repository, ...scope });
    const index = videos.findIndex((video) => video.id === id);

    if (index === -1) {
      return { found: false };
    }

    const video = videos[index];
    if (activeProcessing(video)) {
      return { found: true, locked: true, video };
    }

    const metadataDuration = Number(video.duration);
    const payloadDuration = Number(payload.duration);
    const currentDuration =
      Number.isFinite(payloadDuration) && payloadDuration > 0
        ? Math.max(Number.isFinite(metadataDuration) ? metadataDuration : 0, payloadDuration)
        : metadataDuration;
    const clips = normalizeLongCutClips(payload.clips, currentDuration);

    if (!clips || clips.length === 0) {
      return { found: true, invalidClips: true };
    }

    const remainingRanges = getRemainingRangesAfterClips(clips, currentDuration);
    const remainingDuration = rangesDuration(remainingRanges);
    const jobId = randomUUID();
    const processing = processingMetadata({
      id: jobId,
      operation: 'long-cut',
      user: access.user
    });
    const nextVideo = {
      ...video,
      processing,
      processingError: null,
      updatedAt: new Date().toISOString()
    };
    delete nextVideo.processingError;
    videos[index] = nextVideo;
    await repository.saveVideos(videos, scope);

    return {
      found: true,
      invalidClips: false,
      playlistId: video.playlistId,
      job: {
        id: jobId,
        operation: 'long-cut',
        videoId: video.id,
        sourceStorageName: video.storageName,
        originalName: video.originalName,
        sourceVideo: video,
        clips,
        remainingRanges,
        remainingDuration,
        scope,
        requestedBy: processing.requestedBy
      },
      video: videoSummary(nextVideo, playlists)
    };
  });

  if (result.unauthorized) {
    return;
  }

  if (!result.found) {
    jsonResponse(res, 404, { error: 'Video nao encontrado.' });
    return;
  }

  if (result.locked) {
    processingLockResponse(res, result.video);
    return;
  }

  if (result.invalidClips) {
    jsonResponse(res, 400, { error: 'Informe pelo menos um clipe valido para salvar.' });
    return;
  }

  enqueueVideoProcessing(() => runLongCutProcessingJob(result.job));

  jsonResponse(res, 202, {
    playlistId: result.playlistId,
    job: {
      id: result.job.id,
      operation: result.job.operation,
      videoId: result.job.videoId,
      status: 'queued'
    },
    video: result.video,
    clips: []
  });
}

module.exports = {
  handleListVideos,
  handleCreateVideo,
  handleDeleteVideo,
  handleUpdateVideo,
  handleTrimVideo,
  handleLongCutVideo,
  recoverInterruptedVideoProcessing
};
