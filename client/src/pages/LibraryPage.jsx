import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icons';
import { cn, formatBytes, formatDate, formatDuration, kindLabel } from '../lib/utils';

function syncPlaylistCounts(playlists, videos) {
  const counts = videos.reduce((accumulator, video) => {
    const playlistId = video.playlistId;
    if (!playlistId) {
      return accumulator;
    }
    accumulator[playlistId] = (accumulator[playlistId] || 0) + 1;
    return accumulator;
  }, {});

  return playlists.map((playlist) => ({
    ...playlist,
    count: counts[playlist.id] || 0
  }));
}

export function LibraryPage({ showToast }) {
  const [searchParams] = useSearchParams();
  const queryVideoId = searchParams.get('video');
  const [videos, setVideos] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [expandedPlaylistIds, setExpandedPlaylistIds] = useState([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [selectedVideoIds, setSelectedVideoIds] = useState([]);
  const [lastSelectedVideoId, setLastSelectedVideoId] = useState(null);
  const [bulkPlaylistTargetId, setBulkPlaylistTargetId] = useState('');
  const [isDeletingSelectedVideos, setIsDeletingSelectedVideos] = useState(false);
  const [isMovingSelectedVideos, setIsMovingSelectedVideos] = useState(false);
  const [isDeletingPlaylist, setIsDeletingPlaylist] = useState(false);

  const selectedVideo = useMemo(
    () => videos.find((video) => video.id === selectedVideoId) || null,
    [videos, selectedVideoId]
  );

  const selectedPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === selectedPlaylistId) || null,
    [playlists, selectedPlaylistId]
  );

  const filteredVideos = useMemo(
    () => videos.filter((video) => !selectedPlaylistId || video.playlistId === selectedPlaylistId),
    [videos, selectedPlaylistId]
  );

  const videosByPlaylist = useMemo(
    () =>
      videos.reduce((accumulator, video) => {
        const playlistId = video.playlistId;
        if (!playlistId) {
          return accumulator;
        }
        if (!accumulator[playlistId]) {
          accumulator[playlistId] = [];
        }
        accumulator[playlistId].push(video);
        return accumulator;
      }, {}),
    [videos]
  );

  const selectedVisibleVideoIds = useMemo(
    () => filteredVideos.filter((video) => selectedVideoIds.includes(video.id)).map((video) => video.id),
    [filteredVideos, selectedVideoIds]
  );

  const allVisibleVideosSelected = filteredVideos.length > 0 && selectedVisibleVideoIds.length === filteredVideos.length;
  const availableMovePlaylists = useMemo(
    () => playlists.filter((playlist) => playlist.id !== selectedPlaylistId),
    [playlists, selectedPlaylistId]
  );

  useEffect(() => {
    let ignore = false;

    async function loadInitialData() {
      const [videosResponse, playlistsResponse] = await Promise.all([fetch('/api/videos'), fetch('/api/playlists')]);

      if (!videosResponse.ok || !playlistsResponse.ok) {
        throw new Error('Nao foi possivel carregar a biblioteca.');
      }

      const videosPayload = await videosResponse.json();
      const playlistsPayload = await playlistsResponse.json();
      const nextVideos = videosPayload.videos || [];
      const nextPlaylists = playlistsPayload.playlists || [];
      const byQuery = queryVideoId ? nextVideos.find((video) => video.id === queryVideoId) : null;
      const defaultPlaylist =
        byQuery?.playlistId || nextPlaylists.find((playlist) => playlist.count > 0)?.id || nextPlaylists[0]?.id || null;
      const initialVideo =
        byQuery || nextVideos.find((video) => video.playlistId === defaultPlaylist) || nextVideos[0] || null;

      if (!ignore) {
        setVideos(nextVideos);
        setPlaylists(nextPlaylists);
        setSelectedPlaylistId(defaultPlaylist);
        setSelectedVideoId(initialVideo?.id || null);
        setExpandedPlaylistIds(Array.from(new Set([defaultPlaylist, initialVideo?.playlistId].filter(Boolean))));
      }
    }

    loadInitialData().catch((error) => {
      if (!ignore) {
        showToast(error.message);
      }
    });

    return () => {
      ignore = true;
    };
  }, [queryVideoId, showToast]);

  useEffect(() => {
    setSelectedVideoIds((current) => current.filter((videoId) => videos.some((video) => video.id === videoId)));
    setLastSelectedVideoId((current) => (videos.some((video) => video.id === current) ? current : null));
  }, [videos]);

  useEffect(() => {
    setExpandedPlaylistIds((current) => {
      const validIds = current.filter((playlistId) => playlists.some((playlist) => playlist.id === playlistId));
      if (selectedPlaylistId && !validIds.includes(selectedPlaylistId)) {
        validIds.push(selectedPlaylistId);
      }
      return validIds;
    });
  }, [playlists, selectedPlaylistId]);

  useEffect(() => {
    setBulkPlaylistTargetId((current) => {
      if (availableMovePlaylists.some((playlist) => playlist.id === current)) {
        return current;
      }

      return availableMovePlaylists[0]?.id || '';
    });
  }, [availableMovePlaylists]);

  function handlePlaylistSelect(playlistId) {
    if (selectedPlaylistId !== playlistId) {
      setSelectedVideoIds([]);
      setLastSelectedVideoId(null);
    }

    setSelectedPlaylistId(playlistId);
    const firstVideo = videos.find((video) => video.playlistId === playlistId) || null;
    setSelectedVideoId(firstVideo?.id || null);
    setExpandedPlaylistIds((current) => (current.includes(playlistId) ? current : [...current, playlistId]));
  }

  function togglePlaylistExpanded(playlistId) {
    setExpandedPlaylistIds((current) =>
      current.includes(playlistId) ? current.filter((item) => item !== playlistId) : [...current, playlistId]
    );
  }

  function handleVideoSelectionToggle(videoId, { shiftKey = false, scopeVideos = filteredVideos, replaceExisting = false } = {}) {
    const visibleIds = scopeVideos.map((video) => video.id);

    if (shiftKey && lastSelectedVideoId && visibleIds.includes(lastSelectedVideoId) && visibleIds.includes(videoId)) {
      const startIndex = visibleIds.indexOf(lastSelectedVideoId);
      const endIndex = visibleIds.indexOf(videoId);
      const rangeIds = visibleIds.slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1);

      setSelectedVideoIds((current) => Array.from(new Set([...(replaceExisting ? [] : current), ...rangeIds])));
      setLastSelectedVideoId(videoId);
      return;
    }

    setSelectedVideoIds((current) => {
      const baseSelection = replaceExisting ? [] : current;
      return baseSelection.includes(videoId)
        ? baseSelection.filter((item) => item !== videoId)
        : [...baseSelection, videoId];
    });
    setLastSelectedVideoId(videoId);
  }

  function handleToggleVisibleVideoSelection() {
    if (!filteredVideos.length) {
      return;
    }

    const visibleIds = filteredVideos.map((video) => video.id);

    setSelectedVideoIds((current) => {
      if (visibleIds.every((videoId) => current.includes(videoId))) {
        return current.filter((videoId) => !visibleIds.includes(videoId));
      }

      return Array.from(new Set([...current, ...visibleIds]));
    });
  }

  async function handleDeletePlaylist(playlist) {
    if (!playlist || isDeletingPlaylist) {
      return;
    }

    const confirmed = window.confirm(`Excluir a playlist "${playlist.name}" e todos os videos dentro dela?`);
    if (!confirmed) {
      return;
    }

    setIsDeletingPlaylist(true);

    try {
      const response = await fetch(`/api/playlists/${encodeURIComponent(playlist.id)}`, {
        method: 'DELETE'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel excluir a playlist.');
      }

      const [videosResponse, playlistsResponse] = await Promise.all([fetch('/api/videos'), fetch('/api/playlists')]);
      if (!videosResponse.ok || !playlistsResponse.ok) {
        throw new Error('A playlist foi removida, mas nao foi possivel atualizar a biblioteca.');
      }

      const videosPayload = await videosResponse.json();
      const playlistsPayload = await playlistsResponse.json();
      const nextVideos = videosPayload.videos || [];
      const nextPlaylists = playlistsPayload.playlists || [];
      const preferredPlaylistId =
        selectedPlaylistId && selectedPlaylistId !== playlist.id && nextPlaylists.some((item) => item.id === selectedPlaylistId)
          ? selectedPlaylistId
          : nextPlaylists.find((item) => item.count > 0)?.id || nextPlaylists[0]?.id || null;
      const nextSelectedVideo =
        nextVideos.find((video) => video.id === selectedVideoId) ||
        nextVideos.find((video) => video.playlistId === preferredPlaylistId) ||
        nextVideos[0] ||
        null;
      const nextSelectedPlaylistId =
        nextSelectedVideo?.playlistId && nextPlaylists.some((item) => item.id === nextSelectedVideo.playlistId)
          ? nextSelectedVideo.playlistId
          : preferredPlaylistId;

      setVideos(nextVideos);
      setPlaylists(nextPlaylists);
      setSelectedPlaylistId(nextSelectedPlaylistId);
      setSelectedVideoId(nextSelectedVideo?.id || null);
      setSelectedVideoIds((current) => current.filter((videoId) => nextVideos.some((video) => video.id === videoId)));
      setExpandedPlaylistIds((current) =>
        Array.from(new Set([...current.filter((playlistId) => playlistId !== playlist.id), nextSelectedPlaylistId].filter(Boolean)))
      );

      const deletedCount = Number(payload.deletedCount) || 0;
      showToast(deletedCount ? `Playlist removida. ${deletedCount} videos excluidos.` : 'Playlist removida.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setIsDeletingPlaylist(false);
    }
  }

  async function handleDeleteSelectedVideos() {
    if (!selectedVisibleVideoIds.length || isDeletingSelectedVideos || isMovingSelectedVideos) {
      return;
    }

    setIsDeletingSelectedVideos(true);

    try {
      const deletedIds = [];

      for (const videoId of selectedVisibleVideoIds) {
        const response = await fetch(`/api/videos/${videoId}`, {
          method: 'DELETE'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || 'Nao foi possivel excluir os videos selecionados.');
        }

        deletedIds.push(videoId);
      }

      const nextVideos = videos.filter((video) => !deletedIds.includes(video.id));
      setVideos(nextVideos);
      setSelectedVideoIds((current) => current.filter((videoId) => !deletedIds.includes(videoId)));
      setLastSelectedVideoId((current) => (deletedIds.includes(current) ? null : current));
      setPlaylists((current) => syncPlaylistCounts(current, nextVideos));

      if (deletedIds.includes(selectedVideoId)) {
        const nextSelectedVideo = nextVideos.find((video) => video.playlistId === selectedPlaylistId) || null;
        setSelectedVideoId(nextSelectedVideo?.id || null);
      }

      showToast(deletedIds.length === 1 ? '1 video removido.' : `${deletedIds.length} videos removidos.`);
    } catch (error) {
      showToast(error.message);
    } finally {
      setIsDeletingSelectedVideos(false);
    }
  }

  async function handleMoveSelectedVideos() {
    if (!selectedVisibleVideoIds.length || !bulkPlaylistTargetId || isMovingSelectedVideos || isDeletingSelectedVideos) {
      return;
    }

    const destinationPlaylist = playlists.find((playlist) => playlist.id === bulkPlaylistTargetId);
    if (!destinationPlaylist) {
      showToast('Escolha a playlist de destino.');
      return;
    }

    setIsMovingSelectedVideos(true);

    try {
      const movedIds = [];

      for (const videoId of selectedVisibleVideoIds) {
        const response = await fetch(`/api/videos/${videoId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ playlistId: destinationPlaylist.id })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || 'Nao foi possivel mover os videos selecionados.');
        }

        movedIds.push(videoId);
      }

      const nextVideos = videos.map((video) =>
        movedIds.includes(video.id)
          ? {
              ...video,
              playlistId: destinationPlaylist.id,
              playlistName: destinationPlaylist.name,
              updatedAt: new Date().toISOString()
            }
          : video
      );

      setVideos(nextVideos);
      setSelectedVideoIds((current) => current.filter((videoId) => !movedIds.includes(videoId)));
      setLastSelectedVideoId((current) => (movedIds.includes(current) ? null : current));
      setPlaylists((current) => syncPlaylistCounts(current, nextVideos));

      if (movedIds.includes(selectedVideoId)) {
        const nextSelectedVideo = nextVideos.find((video) => video.playlistId === selectedPlaylistId) || null;
        setSelectedVideoId(nextSelectedVideo?.id || null);
      }

      showToast(
        movedIds.length === 1
          ? `1 video movido para ${destinationPlaylist.name}.`
          : `${movedIds.length} videos movidos para ${destinationPlaylist.name}.`
      );
    } catch (error) {
      showToast(error.message);
    } finally {
      setIsMovingSelectedVideos(false);
    }
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[390px_minmax(0,1fr)]">
      <aside className="tactical-dark-panel flex min-h-[calc(100vh-8.5rem)] flex-col gap-5 px-4 py-4">
        <div>
          {selectedPlaylist ? (
            <div className="mb-4 grid gap-2">
              <button
                type="button"
                onClick={handleToggleVisibleVideoSelection}
                disabled={!filteredVideos.length || isDeletingSelectedVideos || isMovingSelectedVideos}
                className="inline-flex h-9 w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 text-[0.62rem] font-black uppercase tracking-[0.16em] text-white transition hover:border-tactical-pitch/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {allVisibleVideosSelected ? 'Limpar selecao' : 'Selecionar todos'}
              </button>

              {availableMovePlaylists.length ? (
                <div className="grid grid-cols-[minmax(0,1fr)_84px_84px] gap-2">
                  <select
                    value={bulkPlaylistTargetId}
                    onChange={(event) => setBulkPlaylistTargetId(event.target.value)}
                    disabled={isDeletingSelectedVideos || isMovingSelectedVideos}
                    className="h-9 min-w-0 rounded-xl border border-white/10 bg-white/5 px-3 text-[0.62rem] font-black uppercase tracking-[0.14em] text-white outline-none transition hover:border-tactical-pitch/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {availableMovePlaylists.map((playlist) => (
                      <option key={playlist.id} value={playlist.id} className="text-tactical-ink">
                        {playlist.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleMoveSelectedVideos}
                    disabled={!selectedVisibleVideoIds.length || !bulkPlaylistTargetId || isDeletingSelectedVideos || isMovingSelectedVideos}
                    className="inline-flex h-9 min-w-0 items-center justify-center rounded-xl border border-tactical-pitch/20 bg-tactical-pitch/10 px-3 text-[0.62rem] font-black uppercase tracking-[0.16em] text-tactical-pitch transition hover:bg-tactical-pitch hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isMovingSelectedVideos ? 'Movendo' : 'Mover'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteSelectedVideos}
                    disabled={!selectedVisibleVideoIds.length || isDeletingSelectedVideos || isMovingSelectedVideos}
                    className="inline-flex h-9 min-w-0 items-center justify-center rounded-xl border border-tactical-pitch/20 bg-tactical-pitch/10 px-3 text-[0.62rem] font-black uppercase tracking-[0.16em] text-tactical-pitch transition hover:border-red-400 hover:bg-red-500/12 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isDeletingSelectedVideos ? 'Excluindo' : 'Excluir'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleDeleteSelectedVideos}
                  disabled={!selectedVisibleVideoIds.length || isDeletingSelectedVideos || isMovingSelectedVideos}
                  className="inline-flex h-9 w-full items-center justify-center rounded-xl border border-tactical-pitch/20 bg-tactical-pitch/10 px-3 text-[0.62rem] font-black uppercase tracking-[0.16em] text-tactical-pitch transition hover:border-red-400 hover:bg-red-500/12 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDeletingSelectedVideos ? 'Excluindo' : 'Excluir selecionados'}
                </button>
              )}

            </div>
          ) : null}

          <div className="grid gap-3">
            {!playlists.length ? (
              <div className="rounded-2xl border border-dashed border-white/12 px-4 py-8 text-center text-sm font-semibold uppercase tracking-[0.18em] text-white/55">
                Nenhuma playlist disponivel
              </div>
            ) : null}

            {playlists.map((playlist) => {
              const playlistVideos = videosByPlaylist[playlist.id] || [];
              const isExpanded = expandedPlaylistIds.includes(playlist.id);
              const isActivePlaylist = playlist.id === selectedPlaylistId;

              return (
                <div key={playlist.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => togglePlaylistExpanded(playlist.id)}
                      aria-label={isExpanded ? 'Recolher playlist' : 'Expandir playlist'}
                      className={cn(
                        'grid h-6 w-6 shrink-0 place-items-center rounded-md border text-xs font-black transition',
                        isActivePlaylist
                          ? 'border-tactical-pitch bg-tactical-pitch text-white'
                          : 'border-white/15 bg-white/5 text-white/80 hover:border-tactical-pitch/45'
                      )}
                    >
                      {isExpanded ? '−' : '+'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handlePlaylistSelect(playlist.id)}
                      className={cn(
                        'flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition',
                        isActivePlaylist ? 'bg-white/10 text-white' : 'text-white/80 hover:bg-white/8 hover:text-white'
                      )}
                    >
                      <span className="truncate text-[0.8rem] font-black uppercase tracking-[0.14em]">
                        {playlist.name}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-2 py-1 text-[0.58rem] font-black uppercase tracking-[0.14em]',
                          isActivePlaylist ? 'bg-white/15 text-white' : 'bg-white/10 text-white/70'
                        )}
                      >
                        {playlist.count || playlistVideos.length}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeletePlaylist(playlist)}
                      aria-label={`Excluir playlist ${playlist.name}`}
                      disabled={isDeletingPlaylist || isDeletingSelectedVideos || isMovingSelectedVideos}
                      className="group inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/70 transition hover:border-red-400 hover:bg-red-500/12 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Icon name="trash" className="h-4 w-4 transition-colors group-hover:text-red-400" />
                    </button>
                  </div>

                  {isExpanded ? (
                    <div className="ml-4 mt-2.5 border-l border-white/10 pl-3">
                      {!playlistVideos.length ? (
                        <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-white/45">
                          Nenhum video
                        </div>
                      ) : (
                        <div className="grid gap-1">
                          {playlistVideos.map((video) => {
                            const isSelectedForBulk = selectedVideoIds.includes(video.id);
                            const isActiveVideo = video.id === selectedVideoId;

                            return (
                              <div key={video.id} className="flex items-start gap-2">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    const shouldReplaceSelection = selectedPlaylistId !== playlist.id;
                                    if (selectedPlaylistId !== playlist.id) {
                                      setSelectedPlaylistId(playlist.id);
                                    }
                                    handleVideoSelectionToggle(video.id, {
                                      shiftKey: event.shiftKey,
                                      scopeVideos: playlistVideos,
                                      replaceExisting: shouldReplaceSelection
                                    });
                                  }}
                                  aria-label={isSelectedForBulk ? 'Remover selecao do video' : 'Selecionar video para acao em lote'}
                                  className={cn(
                                    'mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-lg border transition',
                                    isSelectedForBulk
                                      ? 'border-tactical-pitch bg-tactical-pitch text-white'
                                      : 'border-white/15 bg-white/5 text-transparent hover:border-tactical-pitch/45'
                                  )}
                                >
                                  <span className={cn('block h-2.5 w-2.5 rounded-[3px]', isSelectedForBulk ? 'bg-white' : 'bg-transparent')} />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    if (selectedPlaylistId !== playlist.id) {
                                      setSelectedVideoIds([]);
                                      setLastSelectedVideoId(null);
                                    }
                                    setSelectedPlaylistId(playlist.id);
                                    setSelectedVideoId(video.id);
                                  }}
                                  className={cn(
                                    'min-w-0 flex-1 rounded-xl px-2 py-1.5 text-left transition',
                                    isActiveVideo
                                      ? 'bg-tactical-pitch/12 text-white ring-1 ring-tactical-pitch/45'
                                      : 'text-white/80 hover:bg-white/8 hover:text-white'
                                  )}
                                >
                                  <div className="min-w-0">
                                    <div className="truncate text-[0.68rem] font-black tracking-[0.02em]">{video.title}</div>
                                    <div className="mt-0.5 flex flex-wrap gap-2 text-[0.52rem] font-bold uppercase tracking-[0.14em] text-white/45">
                                      <span>{formatDuration(video.duration)}</span>
                                      <span>{kindLabel(video.kind)}</span>
                                    </div>
                                  </div>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      <div className="space-y-6">
        <div className="tactical-panel overflow-hidden">
          <div className="space-y-5 px-5 py-5">
            <div className="relative aspect-video overflow-hidden rounded-[1.75rem] bg-black">
              {selectedVideo ? (
                <video src={selectedVideo.url} controls playsInline preload="metadata" className="absolute inset-0 h-full w-full object-contain" />
              ) : (
                <div className="absolute inset-0 grid place-items-center bg-tactical-ink text-center text-white">
                  <div>
                    <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/10 text-tactical-pitch">
                      <Icon name="film" className="h-7 w-7" />
                    </div>
                    <strong className="mt-4 block text-lg font-black uppercase tracking-[0.14em]">Selecione um video</strong>
                  </div>
                </div>
              )}
            </div>

            {selectedVideo ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-2xl border border-tactical-line/35 bg-tactical-bone/50 px-4 py-4">
                  <span className="block text-[0.68rem] font-black uppercase tracking-[0.24em] text-tactical-ash">Playlist</span>
                  <strong className="mt-2 block text-lg font-black text-tactical-ink">{selectedVideo.playlistName || 'Sem playlist'}</strong>
                </div>
                <div className="rounded-2xl border border-tactical-line/35 bg-tactical-bone/50 px-4 py-4">
                  <span className="block text-[0.68rem] font-black uppercase tracking-[0.24em] text-tactical-ash">Tipo</span>
                  <strong className="mt-2 block text-lg font-black text-tactical-ink">{kindLabel(selectedVideo.kind)}</strong>
                </div>
                <div className="rounded-2xl border border-tactical-line/35 bg-tactical-bone/50 px-4 py-4">
                  <span className="block text-[0.68rem] font-black uppercase tracking-[0.24em] text-tactical-ash">Duracao</span>
                  <strong className="mt-2 block text-lg font-black text-tactical-ink">{formatDuration(selectedVideo.duration)}</strong>
                </div>
                <div className="rounded-2xl border border-tactical-line/35 bg-tactical-bone/50 px-4 py-4">
                  <span className="block text-[0.68rem] font-black uppercase tracking-[0.24em] text-tactical-ash">Enviado por</span>
                  <strong className="mt-2 block text-lg font-black text-tactical-ink">{selectedVideo.uploader || 'Equipe'}</strong>
                </div>
                <div className="rounded-2xl border border-tactical-line/35 bg-tactical-bone/50 px-4 py-4">
                  <span className="block text-[0.68rem] font-black uppercase tracking-[0.24em] text-tactical-ash">Tamanho</span>
                  <strong className="mt-2 block text-lg font-black text-tactical-ink">{formatBytes(selectedVideo.size)}</strong>
                </div>
                <div className="rounded-2xl border border-tactical-line/35 bg-tactical-bone/50 px-4 py-4">
                  <span className="block text-[0.68rem] font-black uppercase tracking-[0.24em] text-tactical-ash">Data</span>
                  <strong className="mt-2 block text-lg font-black text-tactical-ink">{formatDate(selectedVideo.createdAt)}</strong>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
