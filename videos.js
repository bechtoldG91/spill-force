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
    const video = await repository.deleteVideo(id, scope);

    if (!video) {
      return { found: false };
    }

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

    const trimmedFile = await storageService.trimVideoFile(video.storageName, { start, end: safeEnd });
    const now = new Date().toISOString();
    const nextVideo = {
      ...video,
      size: trimmedFile.size,
      duration: Math.max(1, Math.round(safeEnd - start)),
      url: `/videos/${encodeURIComponent(video.storageName)}?${scope.teamId ? `teamId=${encodeURIComponent(scope.teamId)}&` : ''}v=${Date.now()}`,
      updatedAt: now
    };

    videos[index] = nextVideo;
    await repository.saveVideos(videos, scope);

    return {
      found: true,
      invalidRange: false,
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

  if (result.invalidRange) {
    jsonResponse(res, 400, { error: 'Intervalo de corte invalido.' });
    return;
  }

  jsonResponse(res, 200, { video: result.video });
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

    const extension = path.extname(video.storageName) || path.extname(video.originalName) || '.mp4';
    const now = new Date().toISOString();
    const createdClips = [];
    const createdStorageNames = [];

    try {
      for (const [clipIndex, clip] of clips.entries()) {
        const clipId = randomUUID();
        const storageName = `${clipId}${extension}`;
        const clipFile = await storageService.extractVideoClipFile(video.storageName, storageName, clip);
        const clipNumber = String(clipIndex + 1).padStart(2, '0');
        const clipVideo = {
          ...video,
          id: clipId,
          title: `${video.title} - Clipe ${clipNumber}`,
          originalName: `${path.basename(video.originalName || video.storageName, extension)}-clipe-${clipNumber}${extension}`,
          storageName,
          url: `/videos/${encodeURIComponent(storageName)}${scope.teamId ? `?teamId=${encodeURIComponent(scope.teamId)}` : ''}`,
          size: clipFile.size,
          duration: Math.max(1, Math.round(clip.end - clip.start)),
          notes: safeText(`Corte ${formatRangeLabel(clip.start, clip.end)}`, 500),
          createdAt: now,
          updatedAt: now
        };

        createdStorageNames.push(storageName);
        createdClips.push(clipVideo);
      }

      const remainingRanges = getRemainingRangesAfterClips(clips, currentDuration);
      const remainingDuration = rangesDuration(remainingRanges);
      let nextVideo = null;

      if (remainingRanges.length) {
        const remainingFile = await storageService.buildRemainingVideoFile(video.storageName, remainingRanges);
        nextVideo = {
          ...video,
          title: `${video.title} - Restante`,
          size: remainingFile.size,
          duration: Math.max(1, Math.round(remainingDuration)),
          url: `/videos/${encodeURIComponent(video.storageName)}?${scope.teamId ? `teamId=${encodeURIComponent(scope.teamId)}&` : ''}v=${Date.now()}`,
          updatedAt: now
        };
        videos.splice(index, 1, nextVideo, ...createdClips);
      } else {
        videos.splice(index, 1, ...createdClips);
        await repository.deleteAnnotations(video.id);
        await storageService.removeVideoFile(video.storageName);
      }

      await repository.saveVideos(videos, scope);

      return {
        found: true,
        invalidClips: false,
        playlistId: video.playlistId,
        video: nextVideo ? videoSummary(nextVideo, playlists) : null,
        clips: createdClips.map((clip) => videoSummary(clip, playlists))
      };
    } catch (error) {
      await Promise.all(createdStorageNames.map((storageName) => storageService.removeVideoFile(storageName)));
      throw error;
    }
  });

  if (result.unauthorized) {
    return;
  }

  if (!result.found) {
    jsonResponse(res, 404, { error: 'Video nao encontrado.' });
    return;
  }

  if (result.invalidClips) {
    jsonResponse(res, 400, { error: 'Informe pelo menos um clipe valido para salvar.' });
    return;
  }

  jsonResponse(res, 200, {
    playlistId: result.playlistId,
    video: result.video,
    clips: result.clips
  });
}

module.exports = {
  handleListVideos,
  handleCreateVideo,
  handleDeleteVideo,
  handleUpdateVideo,
  handleTrimVideo,
  handleLongCutVideo
};
