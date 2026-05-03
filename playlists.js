const { randomUUID } = require('node:crypto');
const {
  LEGACY_DEFAULT_PLAYLIST_ID,
  LEGACY_OWNER_ID,
  storageService,
  jsonResponse,
  safeText,
  sanitizePlaylists,
  readJsonBody
} = require('./storage');
const { accessScope, authorizeRoles, getTeamIdFromRequest } = require('./auth');

const PLAYLIST_DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric'
});

function formatUploadPlaylistName(dateInput) {
  const date = new Date(dateInput || Date.now());
  return PLAYLIST_DATE_FORMATTER.format(Number.isNaN(date.getTime()) ? new Date() : date);
}

function findPlaylistByName(playlists, name) {
  const normalizedName = safeText(name, 120).toLowerCase();
  if (!normalizedName) {
    return null;
  }

  return playlists.find((playlist) => playlist.name.toLowerCase() === normalizedName) || null;
}

function ensurePlaylistForDate(playlists, dateInput, ownerId = LEGACY_OWNER_ID, teamId = '') {
  const name = formatUploadPlaylistName(dateInput);
  const existing = findPlaylistByName(playlists, name);

  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const playlist = {
    id: randomUUID(),
    ownerId,
    teamId,
    name,
    description: '',
    createdAt: now,
    updatedAt: now
  };

  playlists.push(playlist);
  return playlist;
}

function normalizeLibraryState(playlists, videos, ownerId = LEGACY_OWNER_ID, teamId = '') {
  const nextPlaylists = sanitizePlaylists(playlists);
  const knownPlaylistIds = new Set(nextPlaylists.map((playlist) => playlist.id));
  let changed = nextPlaylists.length !== playlists.length;

  const nextVideos = videos.map((video) => {
    const playlistId = safeText(video.playlistId, 80);
    const hasValidPlaylist = playlistId && playlistId !== LEGACY_DEFAULT_PLAYLIST_ID && knownPlaylistIds.has(playlistId);

    if (hasValidPlaylist && video.ownerId && (!teamId || video.teamId)) {
      return video;
    }

    const autoPlaylist = hasValidPlaylist
      ? nextPlaylists.find((playlist) => playlist.id === playlistId)
      : ensurePlaylistForDate(nextPlaylists, video.createdAt || video.updatedAt || new Date().toISOString(), ownerId, teamId);
    knownPlaylistIds.add(autoPlaylist.id);
    changed = true;

    return {
      ...video,
      ownerId: safeText(video.ownerId, 100) || ownerId,
      teamId: safeText(video.teamId, 80) || teamId,
      playlistId: autoPlaylist.id,
      updatedAt: safeText(video.updatedAt, 40) || new Date().toISOString()
    };
  });

  nextPlaylists.forEach((playlist) => {
    if (!playlist.ownerId) {
      playlist.ownerId = ownerId;
      changed = true;
    }
    if (teamId && !playlist.teamId) {
      playlist.teamId = teamId;
      changed = true;
    }
  });

  return {
    playlists: nextPlaylists,
    videos: nextVideos,
    changed
  };
}

async function loadLibraryState({ persist = false, repository, ownerId = LEGACY_OWNER_ID, teamId = '' } = {}) {
  if (!repository) {
    return storageService.transaction((transactionRepository) => loadLibraryState({ persist, repository: transactionRepository, ownerId, teamId }));
  }

  const scope = { ownerId, teamId };
  const [videos, playlists] = await Promise.all([repository.listVideos(scope), repository.listPlaylists(scope)]);
  const normalized = normalizeLibraryState(playlists, videos, ownerId, teamId);

  if (persist && normalized.changed) {
    await repository.saveVideos(normalized.videos, scope);
    await repository.savePlaylists(normalized.playlists, scope);
  }

  return normalized;
}

function playlistSummary(playlist, videos = []) {
  const count = videos.filter((video) => video.playlistId === playlist.id).length;
  return {
    id: playlist.id,
    teamId: playlist.teamId || '',
    name: playlist.name,
    description: playlist.description,
    count,
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt
  };
}

function resolvePlaylist(video, playlists) {
  return (
    playlists.find((playlist) => playlist.id === video.playlistId) || {
      id: safeText(video.playlistId, 80) || randomUUID(),
      teamId: video.teamId || '',
      name: formatUploadPlaylistName(video.createdAt || video.updatedAt || new Date().toISOString()),
      description: '',
      createdAt: safeText(video.createdAt, 40) || new Date().toISOString(),
      updatedAt: safeText(video.updatedAt, 40) || new Date().toISOString()
    }
  );
}

function videoSummary(video, playlists = []) {
  const playlist = resolvePlaylist(video, playlists);
  return {
    id: video.id,
    teamId: video.teamId || '',
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

async function handleListPlaylists(req, res) {
  const teamId = getTeamIdFromRequest(req);
  const access = await authorizeRoles(req, res, teamId, ['admin', 'treinador', 'atleta']);
  if (!access) {
    return;
  }
  const scope = accessScope(access);
  const { videos, playlists } = await storageService.transaction((repository) => loadLibraryState({ persist: true, repository, ...scope }));
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

  const teamId = getTeamIdFromRequest(req, null, payload);
  const access = await authorizeRoles(req, res, teamId, ['admin', 'treinador']);
  if (!access) {
    return;
  }
  const scope = accessScope(access);

  const name = safeText(payload.name, 120);
  if (!name) {
    jsonResponse(res, 400, { error: 'Informe o nome da playlist.' });
    return;
  }

  const result = await storageService.transaction(async (repository) => {
    const { ownerId } = scope;
    const { videos, playlists } = await loadLibraryState({ persist: false, repository, ...scope });
    const existing = playlists.find((playlist) => playlist.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      return {
        status: 200,
        playlist: playlistSummary(existing, videos)
      };
    }

    const now = new Date().toISOString();
    const playlist = {
      id: randomUUID(),
      ownerId,
      teamId: scope.teamId || '',
      name,
      description: safeText(payload.description, 260),
      createdAt: now,
      updatedAt: now
    };

    playlists.push(playlist);
    await repository.savePlaylists(playlists, scope);
    return {
      status: 201,
      playlist: playlistSummary(playlist, videos)
    };
  });

  jsonResponse(res, result.status, { playlist: result.playlist });
}

async function handleDeletePlaylist(req, res, rawId) {
  const id = safeText(decodeURIComponent(rawId), 80);

  if (!id) {
    jsonResponse(res, 404, { error: 'Playlist nao encontrada.' });
    return;
  }

  const teamId = getTeamIdFromRequest(req);
  const access = await authorizeRoles(req, res, teamId, ['admin', 'treinador']);
  if (!access) {
    return;
  }
  const scope = accessScope(access);
  const result = await storageService.transaction(async (repository) => {
    const { videos, playlists } = await loadLibraryState({ persist: false, repository, ...scope });
    const playlist = playlists.find((item) => item.id === id);

    if (!playlist) {
      return { found: false };
    }

    const nextPlaylists = playlists.filter((item) => item.id !== id);
    const deletedVideos = videos.filter((video) => video.playlistId === id);
    const deletedVideoIds = deletedVideos.map((video) => video.id);
    const nextVideos = videos.filter((video) => video.playlistId !== id);

    await repository.saveVideos(nextVideos, scope);
    await repository.savePlaylists(nextPlaylists, scope);
    await repository.deleteAnnotationsForVideos(deletedVideoIds);

    return {
      found: true,
      deletedCount: deletedVideos.length,
      storageNames: deletedVideos.map((video) => video.storageName).filter(Boolean)
    };
  });

  if (!result.found) {
    jsonResponse(res, 404, { error: 'Playlist nao encontrada.' });
    return;
  }

  await Promise.all(result.storageNames.map((storageName) => storageService.removeVideoFile(storageName)));

  jsonResponse(res, 200, { ok: true, deletedCount: result.deletedCount });
}

module.exports = {
  ensurePlaylistForDate,
  loadLibraryState,
  videoSummary,
  handleListPlaylists,
  handleCreatePlaylist,
  handleDeletePlaylist
};
