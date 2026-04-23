import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icons';
import { DEFAULT_PLAYLIST_ID, MARKER_TOLERANCE, SWATCHES } from '../lib/constants';
import { cn, createId, formatBytes, formatDuration, kindLabel, normalizeText } from '../lib/utils';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pointFromEvent(event, element) {
  const rect = element.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
  };
}

function annotationItemCount(annotation) {
  return (annotation.strokes?.length || 0) + (annotation.boxes?.length || 0);
}

function nearestAnnotation(annotations, currentTime) {
  return annotations
    .map((annotation) => ({
      annotation,
      distance: Math.abs(annotation.time - currentTime)
    }))
    .filter((item) => item.distance <= MARKER_TOLERANCE)
    .sort((left, right) => left.distance - right.distance)[0]?.annotation;
}

function drawStroke(context, stroke, width, height) {
  if (!stroke?.points?.length || stroke.points.length < 2) {
    return;
  }

  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = stroke.color || '#3f8f29';
  context.lineWidth = Number(stroke.width || 6);
  context.shadowColor = 'rgba(0, 0, 0, 0.32)';
  context.shadowBlur = 5;
  context.beginPath();
  context.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);

  stroke.points.slice(1).forEach((point) => {
    context.lineTo(point.x * width, point.y * height);
  });

  context.stroke();
  context.restore();
}

export function LibraryPage({ showToast }) {
  const [searchParams] = useSearchParams();
  const queryVideoId = searchParams.get('video');
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const currentStrokeRef = useRef(null);
  const [videos, setVideos] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [activeAnnotationId, setActiveAnnotationId] = useState(null);
  const [search, setSearch] = useState('');
  const [draftStrokes, setDraftStrokes] = useState([]);
  const [draftBoxes, setDraftBoxes] = useState([]);
  const [draftHistory, setDraftHistory] = useState([]);
  const [currentStroke, setCurrentStroke] = useState(null);
  const [color, setColor] = useState('#3f8f29');
  const [brushSize, setBrushSize] = useState(6);
  const [activeTool, setActiveTool] = useState('draw');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPaused, setIsPaused] = useState(true);
  const [saveStatus, setSaveStatus] = useState('Pronto');
  const [noteText, setNoteText] = useState('');
  const [overlayText, setOverlayText] = useState('');
  const [isDeletingVideo, setIsDeletingVideo] = useState(false);
  const [isDeletingPlaylist, setIsDeletingPlaylist] = useState(false);

  useEffect(() => {
    currentStrokeRef.current = currentStroke;
  }, [currentStroke]);

  const selectedVideo = useMemo(
    () => videos.find((video) => video.id === selectedVideoId) || null,
    [videos, selectedVideoId]
  );

  const selectedPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === selectedPlaylistId) || null,
    [playlists, selectedPlaylistId]
  );

  const filteredVideos = useMemo(
    () =>
      videos.filter((video) => {
        const matchesPlaylist = !selectedPlaylistId || video.playlistId === selectedPlaylistId;
        const haystack = normalizeText([
          video.title,
          video.team,
          video.uploader,
          video.playlistName,
          video.kind,
          ...(video.tags || [])
        ].join(' '));

        return matchesPlaylist && haystack.includes(normalizeText(search));
      }),
    [videos, selectedPlaylistId, search]
  );

  const visibleAnnotations = useMemo(() => {
    if (!isPaused) {
      return [];
    }

    return annotations.filter((annotation) => Math.abs(annotation.time - currentTime) <= MARKER_TOLERANCE);
  }, [annotations, currentTime, isPaused]);

  const visibleBoxes = useMemo(() => {
    if (!isPaused) {
      return [];
    }

    return [...visibleAnnotations.flatMap((annotation) => annotation.boxes || []), ...draftBoxes];
  }, [visibleAnnotations, draftBoxes, isPaused]);

  const draftItemCount = draftStrokes.length + draftBoxes.length;

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;

    if (!canvas || !stage) {
      return;
    }

    const context = canvas.getContext('2d');
    const rect = stage.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);

    if (!isPaused) {
      return;
    }

    [...visibleAnnotations.flatMap((annotation) => annotation.strokes || []), ...draftStrokes, ...(currentStroke ? [currentStroke] : [])].forEach(
      (stroke) => drawStroke(context, stroke, rect.width, rect.height)
    );
  }, [visibleAnnotations, draftStrokes, currentStroke, isPaused]);

  useLayoutEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return undefined;
    }

    const observer = new ResizeObserver(() => renderCanvas());
    observer.observe(stage);
    window.addEventListener('resize', renderCanvas);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', renderCanvas);
    };
  }, [renderCanvas]);

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
    if (!selectedVideoId) {
      setAnnotations([]);
      setActiveAnnotationId(null);
      setDraftStrokes([]);
      setDraftBoxes([]);
      setDraftHistory([]);
      setCurrentStroke(null);
      setCurrentTime(0);
      setDuration(0);
      setIsPaused(true);
      setSaveStatus('Pronto');
      return undefined;
    }

    let ignore = false;
    setAnnotations([]);
    setActiveAnnotationId(null);
    setDraftStrokes([]);
    setDraftBoxes([]);
    setDraftHistory([]);
    setCurrentStroke(null);
    setNoteText('');
    setOverlayText('');
    setSaveStatus('Carregando');

    async function loadAnnotations() {
      const response = await fetch(`/api/videos/${selectedVideoId}/annotations`);
      if (!response.ok) {
        throw new Error('Nao foi possivel carregar marcacoes.');
      }

      const payload = await response.json();
      if (!ignore) {
        setAnnotations(payload.annotations || []);
        setSaveStatus('Pronto');
      }
    }

    loadAnnotations().catch((error) => {
      if (!ignore) {
        setSaveStatus('Erro');
        showToast(error.message);
      }
    });

    return () => {
      ignore = true;
    };
  }, [selectedVideoId, showToast]);

  useEffect(() => {
    if (!isPaused) {
      setActiveAnnotationId((current) => (current === null ? current : null));
      return;
    }

    const nearest = nearestAnnotation(annotations, currentTime);
    const nextId = nearest?.id || null;
    setActiveAnnotationId((current) => (current === nextId ? current : nextId));
  }, [annotations, currentTime, isPaused]);

  async function persistAnnotations(nextAnnotations) {
    if (!selectedVideo) {
      return [];
    }

    setSaveStatus('Salvando');
    const response = await fetch(`/api/videos/${selectedVideo.id}/annotations`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ annotations: nextAnnotations })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'Nao foi possivel salvar.');
    }

    setSaveStatus('Salvo');
    return payload.annotations || [];
  }

  function handlePlaylistSelect(playlistId) {
    setSelectedPlaylistId(playlistId);
    const firstVideo = videos.find((video) => video.playlistId === playlistId) || null;
    setSelectedVideoId(firstVideo?.id || null);
  }

  async function handleDeleteSelectedPlaylist() {
    if (!selectedPlaylist || selectedPlaylist.id === DEFAULT_PLAYLIST_ID || isDeletingPlaylist) {
      return;
    }

    const confirmed = window.confirm(`Excluir a playlist "${selectedPlaylist.name}"? Os videos dela vao para Geral.`);
    if (!confirmed) {
      return;
    }

    setIsDeletingPlaylist(true);

    try {
      const response = await fetch(`/api/playlists/${encodeURIComponent(selectedPlaylist.id)}`, {
        method: 'DELETE'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel excluir a playlist.');
      }

      const movedCount = Number(payload.movedCount) || 0;
      const nextVideos = videos.map((video) =>
        video.playlistId === selectedPlaylist.id
          ? {
              ...video,
              playlistId: DEFAULT_PLAYLIST_ID,
              playlistName: 'Geral'
            }
          : video
      );

      setVideos(nextVideos);
      setPlaylists((current) =>
        current
          .filter((playlist) => playlist.id !== selectedPlaylist.id)
          .map((playlist) =>
            playlist.id === DEFAULT_PLAYLIST_ID ? { ...playlist, count: (playlist.count || 0) + movedCount } : playlist
          )
      );
      setSelectedPlaylistId(DEFAULT_PLAYLIST_ID);

      const nextSelectedVideo =
        nextVideos.find((video) => video.id === selectedVideoId && video.playlistId === DEFAULT_PLAYLIST_ID) ||
        nextVideos.find((video) => video.playlistId === DEFAULT_PLAYLIST_ID) ||
        nextVideos[0] ||
        null;
      setSelectedVideoId(nextSelectedVideo?.id || null);

      showToast(movedCount ? `Playlist removida. ${movedCount} videos foram para Geral.` : 'Playlist removida.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setIsDeletingPlaylist(false);
    }
  }

  async function handleDeleteSelectedVideo() {
    if (!selectedVideo || isDeletingVideo) {
      return;
    }

    const confirmed = window.confirm(`Excluir o video "${selectedVideo.title}"?`);
    if (!confirmed) {
      return;
    }

    setIsDeletingVideo(true);

    try {
      const response = await fetch(`/api/videos/${selectedVideo.id}`, {
        method: 'DELETE'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel excluir o video.');
      }

      const deletedVideoId = selectedVideo.id;
      const deletedPlaylistId = selectedVideo.playlistId;
      const nextVideos = videos.filter((video) => video.id !== deletedVideoId);

      setVideos(nextVideos);
      setPlaylists((current) =>
        current.map((playlist) =>
          playlist.id === deletedPlaylistId ? { ...playlist, count: Math.max(0, (playlist.count || 0) - 1) } : playlist
        )
      );

      const nextSelectedVideo = nextVideos.find((video) => video.playlistId === selectedPlaylistId) || null;
      setSelectedVideoId(nextSelectedVideo?.id || null);
      showToast('Video removido.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setIsDeletingVideo(false);
    }
  }

  function handlePointerDown(event) {
    const canvas = canvasRef.current;
    const video = videoRef.current;

    if (!canvas || !selectedVideo || !video) {
      return;
    }

    event.preventDefault();
    if (activeTool === 'text') {
      const text = overlayText.trim();
      if (!text) {
        showToast('Digite o texto da caixa.');
        return;
      }

      video.pause();
      const point = pointFromEvent(event, canvas);
      const box = {
        id: createId(),
        x: point.x,
        y: point.y,
        width: 0.24,
        text,
        color
      };

      setDraftBoxes((current) => [...current, box]);
      setDraftHistory((current) => [...current, { type: 'box', value: box }]);
      setOverlayText('');
      return;
    }

    video.pause();
    const point = pointFromEvent(event, canvas);
    const nextStroke = {
      color,
      width: Number(brushSize),
      points: [point]
    };

    event.currentTarget.setPointerCapture?.(event.pointerId);
    setCurrentStroke(nextStroke);
  }

  function handlePointerMove(event) {
    const canvas = canvasRef.current;

    if (!canvas || activeTool !== 'draw') {
      return;
    }

    setCurrentStroke((stroke) => {
      if (!stroke) {
        return stroke;
      }

      const point = pointFromEvent(event, canvas);
      const previous = stroke.points[stroke.points.length - 1];
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y);

      if (distance <= 0.002) {
        return stroke;
      }

      return {
        ...stroke,
        points: [...stroke.points, point]
      };
    });
  }

  function handlePointerUp(event) {
    if (!currentStrokeRef.current) {
      return;
    }

    event.preventDefault();
    const stroke = currentStrokeRef.current;
    if (stroke.points.length > 1) {
      setDraftStrokes((current) => [...current, stroke]);
      setDraftHistory((current) => [...current, { type: 'stroke', value: stroke }]);
    }

    setCurrentStroke(null);
  }

  function handleUndoDraft() {
    const last = draftHistory[draftHistory.length - 1];
    if (!last) {
      return;
    }

    setDraftHistory((current) => current.slice(0, -1));
    if (last.type === 'stroke') {
      setDraftStrokes((current) => current.filter((stroke) => stroke !== last.value));
    }

    if (last.type === 'box') {
      setDraftBoxes((current) => current.filter((box) => box !== last.value));
    }
  }

  function clearDraft() {
    setDraftStrokes([]);
    setDraftBoxes([]);
    setDraftHistory([]);
    setCurrentStroke(null);
  }

  async function handleSaveAnnotation() {
    if (!selectedVideo) {
      showToast('Selecione um video.');
      return;
    }

    const text = noteText.trim();
    if (!text && draftStrokes.length === 0 && draftBoxes.length === 0) {
      showToast('Adicione uma nota, desenho ou caixa de texto.');
      return;
    }

    const previousAnnotations = annotations;
    const annotation = {
      id: createId(),
      time: Number(currentTime.toFixed(2)),
      text,
      color,
      strokes: draftStrokes,
      boxes: draftBoxes,
      createdAt: new Date().toISOString()
    };

    const nextAnnotations = [...previousAnnotations, annotation].sort((left, right) => left.time - right.time);
    setAnnotations(nextAnnotations);
    setActiveAnnotationId(annotation.id);

    try {
      const saved = await persistAnnotations(nextAnnotations);
      setAnnotations(saved);
      setNoteText('');
      setOverlayText('');
      clearDraft();
      showToast('Marcacao salva.');
    } catch (error) {
      setAnnotations(previousAnnotations);
      setActiveAnnotationId(null);
      showToast(error.message);
    }
  }

  async function handleDeleteAnnotation(annotationId) {
    const previousAnnotations = annotations;
    const nextAnnotations = previousAnnotations.filter((annotation) => annotation.id !== annotationId);
    setAnnotations(nextAnnotations);
    if (activeAnnotationId === annotationId) {
      setActiveAnnotationId(null);
    }

    try {
      const saved = await persistAnnotations(nextAnnotations);
      setAnnotations(saved);
      showToast('Marcacao removida.');
    } catch (error) {
      setAnnotations(previousAnnotations);
      showToast(error.message);
    }
  }

  function openAnnotation(annotationId) {
    const annotation = annotations.find((item) => item.id === annotationId);
    const video = videoRef.current;
    if (!annotation || !video) {
      return;
    }

    video.pause();
    video.currentTime = annotation.time;
    setCurrentTime(annotation.time);
    setActiveAnnotationId(annotation.id);
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video || !selectedVideo) {
      return;
    }

    if (video.paused) {
      video.play().catch(() => showToast('Nao foi possivel reproduzir.'));
      return;
    }

    video.pause();
  }

  function handleSeek(value) {
    const video = videoRef.current;
    if (!video || !duration) {
      return;
    }

    const nextTime = (Number(value) / 1000) * duration;
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  function skip(seconds) {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.currentTime = clamp((video.currentTime || 0) + seconds, 0, duration || Number.MAX_SAFE_INTEGER);
    setCurrentTime(video.currentTime);
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
      <aside className="tactical-dark-panel flex min-h-[calc(100vh-8.5rem)] flex-col gap-5 px-4 py-4">
        <label className="block">
          <span className="mb-2 block text-[0.68rem] font-black uppercase tracking-[0.3em] text-white/60">Buscar</span>
          <span className="flex h-12 items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 text-white/65">
            <Icon name="search" className="h-4 w-4" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              type="search"
              placeholder="Buscar videos"
              className="h-full w-full border-0 bg-transparent text-sm text-white outline-none placeholder:text-white/45"
            />
          </span>
        </label>

        <div>
          <span className="text-[0.68rem] font-black uppercase tracking-[0.3em] text-white/60">
            {playlists.length} {playlists.length === 1 ? 'playlist' : 'playlists'}
          </span>
          <div className="mt-3 grid gap-2">
            {playlists.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                onClick={() => handlePlaylistSelect(playlist.id)}
                className={cn(
                  'flex min-h-12 items-center justify-between gap-3 rounded-xl border px-4 text-left text-sm font-black uppercase tracking-[0.16em] transition',
                  playlist.id === selectedPlaylistId
                    ? 'border-tactical-pitch bg-tactical-pitch text-white shadow-glow'
                    : 'border-white/10 bg-white/5 text-white hover:border-tactical-pitch/40 hover:bg-white/10'
                )}
              >
                <span className="truncate">{playlist.name}</span>
                <span
                  className={cn(
                    'rounded-full px-2 py-1 text-[0.62rem] tracking-[0.16em]',
                    playlist.id === selectedPlaylistId ? 'bg-white/15 text-white' : 'bg-white/10 text-tactical-mist'
                  )}
                >
                  {playlist.count || 0}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-white/10 pt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <strong className="truncate text-sm font-black uppercase tracking-[0.18em] text-white">
              {selectedPlaylist?.name || 'Playlist'}
            </strong>
            <div className="flex items-center gap-2">
              <span className="text-[0.68rem] font-black uppercase tracking-[0.22em] text-white/60">
                {filteredVideos.length} {filteredVideos.length === 1 ? 'video' : 'videos'}
              </span>
              {selectedPlaylist && selectedPlaylist.id !== DEFAULT_PLAYLIST_ID ? (
                <button
                  type="button"
                  onClick={handleDeleteSelectedPlaylist}
                  disabled={isDeletingPlaylist}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-tactical-ember/20 bg-tactical-ember/10 px-3 text-[0.62rem] font-black uppercase tracking-[0.16em] text-tactical-ember transition hover:bg-tactical-ember hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon name="trash" className="h-3.5 w-3.5" />
                  {isDeletingPlaylist ? 'Excluindo' : 'Excluir'}
                </button>
              ) : null}
            </div>
          </div>

          <div className="grid max-h-[calc(100vh-23rem)] gap-3 overflow-y-auto pr-1">
            {!filteredVideos.length ? (
              <div className="rounded-2xl border border-dashed border-white/12 px-4 py-8 text-center text-sm font-semibold uppercase tracking-[0.18em] text-white/55">
                Nenhum video nesta lista
              </div>
            ) : null}

            {filteredVideos.map((video) => (
              <button
                key={video.id}
                type="button"
                onClick={() => setSelectedVideoId(video.id)}
                className={cn(
                  'grid gap-3 rounded-2xl border p-3 text-left transition md:grid-cols-[108px_minmax(0,1fr)]',
                  video.id === selectedVideoId
                    ? 'border-tactical-pitch bg-white/10 shadow-glow'
                    : 'border-white/10 bg-white/5 hover:border-tactical-pitch/35 hover:bg-white/10'
                )}
              >
                <div className="relative overflow-hidden rounded-xl bg-black">
                  <video src={video.url} muted playsInline preload="metadata" className="aspect-video h-full w-full object-cover" />
                  <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-1 text-[0.6rem] font-black uppercase tracking-[0.16em] text-white">
                    {formatDuration(video.duration)}
                  </span>
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-black uppercase tracking-[0.14em] text-white">{video.title}</h3>
                  <div className="mt-2 flex flex-wrap gap-2 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-white/60">
                    <span>{kindLabel(video.kind)}</span>
                    <span>{formatBytes(video.size)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div className="space-y-6">
        <div className="tactical-panel overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-tactical-ink/10 px-5 py-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[0.68rem] font-black uppercase tracking-[0.3em] text-tactical-ash">Biblioteca de analise</p>
              <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.12em] text-tactical-ink">
                {selectedVideo?.title || 'Analise de video'}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex h-11 items-center rounded-full border border-tactical-pitch/20 bg-tactical-pitch/10 px-4 text-xs font-black uppercase tracking-[0.2em] text-tactical-pitch">
                {saveStatus}
              </span>
              {selectedVideo ? (
                <button
                  type="button"
                  onClick={handleDeleteSelectedVideo}
                  disabled={isDeletingVideo}
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-tactical-ember/20 bg-tactical-ember/10 px-4 text-xs font-black uppercase tracking-[0.18em] text-tactical-ember transition hover:bg-tactical-ember hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon name="trash" className="h-4 w-4" />
                  {isDeletingVideo ? 'Excluindo' : 'Excluir video'}
                </button>
              ) : null}
            </div>
          </div>

          <div className="space-y-5 px-5 py-5">
            <div ref={stageRef} className="relative aspect-video overflow-hidden rounded-[1.75rem] bg-black">
              {selectedVideo ? (
                <>
                  <video
                    ref={videoRef}
                    src={selectedVideo.url}
                    playsInline
                    preload="metadata"
                    className="absolute inset-0 h-full w-full object-contain"
                    onLoadedMetadata={(event) => {
                      setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : selectedVideo.duration || 0);
                      setCurrentTime(event.currentTarget.currentTime || 0);
                      setIsPaused(event.currentTarget.paused);
                    }}
                    onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
                    onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
                    onPlay={() => setIsPaused(false)}
                    onPause={(event) => {
                      setIsPaused(true);
                      setCurrentTime(event.currentTarget.currentTime || 0);
                    }}
                    onEnded={() => setIsPaused(true)}
                  />
                  <canvas
                    ref={canvasRef}
                    className={cn(
                      'absolute inset-0 h-full w-full touch-none',
                      activeTool === 'text' ? 'cursor-text' : 'cursor-crosshair'
                    )}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                  />
                  <div className="pointer-events-none absolute inset-0">
                    {visibleBoxes.map((box) => (
                      <div
                        key={box.id}
                        className="absolute rounded-xl border-2 bg-black/70 px-3 py-2 text-sm font-black uppercase tracking-[0.12em] text-white shadow-lg"
                        style={{
                          left: `${clamp(box.x * 100, 0, 100)}%`,
                          top: `${clamp(box.y * 100, 0, 100)}%`,
                          width: `${clamp((box.width || 0.24) * 100, 12, 55)}%`,
                          borderColor: box.color || '#3f8f29'
                        }}
                      >
                        {box.text}
                      </div>
                    ))}
                  </div>
                </>
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

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="grid h-11 w-11 place-items-center rounded-xl border border-tactical-ink/10 bg-white text-tactical-ink transition hover:border-tactical-pitch hover:text-tactical-pitch"
                onClick={() => skip(-5)}
              >
                <Icon name="back" className="h-5 w-5" />
              </button>
              <button type="button" className="tactical-button h-12 w-12 rounded-full p-0" onClick={togglePlayback}>
                <Icon name={isPaused ? 'play' : 'pause'} className="h-5 w-5" />
              </button>
              <button
                type="button"
                className="grid h-11 w-11 place-items-center rounded-xl border border-tactical-ink/10 bg-white text-tactical-ink transition hover:border-tactical-pitch hover:text-tactical-pitch"
                onClick={() => skip(5)}
              >
                <Icon name="forward" className="h-5 w-5" />
              </button>

              <span className="rounded-full border border-tactical-ink/10 bg-tactical-bone px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-tactical-ash">
                {formatDuration(currentTime)}
              </span>

              <div className="relative min-w-[240px] flex-1 px-2 pb-10 pt-2">
                {duration && annotations.length ? (
                  <div className="pointer-events-none absolute inset-x-4 bottom-6 top-0">
                    {annotations.map((annotation) => (
                      <button
                        key={annotation.id}
                        type="button"
                        onClick={() => openAnnotation(annotation.id)}
                        className={cn(
                          'pointer-events-auto absolute bottom-0 rounded-full border px-3 py-1 text-[0.62rem] font-black uppercase tracking-[0.16em] shadow-md transition',
                          annotation.id === activeAnnotationId
                            ? 'border-tactical-ember bg-tactical-ember text-white'
                            : 'border-tactical-ink bg-tactical-pitch text-tactical-ink'
                        )}
                        style={{ left: `${(annotation.time / duration) * 100}%`, transform: 'translateX(-50%)' }}
                      >
                        Nota
                        <span className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-current bg-inherit" />
                      </button>
                    ))}
                  </div>
                ) : null}
                <input
                  className="timeline-slider mt-8"
                  type="range"
                  min="0"
                  max="1000"
                  step="1"
                  value={duration ? Math.round((currentTime / duration) * 1000) : 0}
                  onChange={(event) => handleSeek(event.target.value)}
                />
              </div>

              <span className="rounded-full border border-tactical-ink/10 bg-tactical-bone px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-tactical-ash">
                {formatDuration(duration)}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-[1.75rem] border border-tactical-ink/10 bg-tactical-bone/80 px-4 py-4">
              <button
                type="button"
                onClick={() => setActiveTool('draw')}
                className={cn(
                  'inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-black uppercase tracking-[0.16em] transition',
                  activeTool === 'draw'
                    ? 'border-tactical-ink bg-tactical-ink text-white'
                    : 'border-tactical-ink/10 bg-white text-tactical-ink hover:border-tactical-pitch hover:text-tactical-pitch'
                )}
              >
                <Icon name="pen" className="h-4 w-4" />
                Desenhar
              </button>
              <button
                type="button"
                onClick={() => setActiveTool('text')}
                className={cn(
                  'inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-black uppercase tracking-[0.16em] transition',
                  activeTool === 'text'
                    ? 'border-tactical-ink bg-tactical-ink text-white'
                    : 'border-tactical-ink/10 bg-white text-tactical-ink hover:border-tactical-pitch hover:text-tactical-pitch'
                )}
              >
                <Icon name="text" className="h-4 w-4" />
                Texto
              </button>

              <div className="flex items-center gap-2">
                {SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`Selecionar cor ${swatch}`}
                    onClick={() => setColor(swatch)}
                    className={cn(
                      'h-9 w-9 rounded-full border-2 transition',
                      color === swatch ? 'scale-110 border-tactical-ink shadow-md' : 'border-white'
                    )}
                    style={{ backgroundColor: swatch }}
                  />
                ))}
              </div>

              <label className="flex min-w-[170px] items-center gap-3">
                <span className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-tactical-ash">Traco</span>
                <input
                  type="range"
                  min="2"
                  max="18"
                  value={brushSize}
                  onChange={(event) => setBrushSize(Number(event.target.value))}
                  className="timeline-slider"
                />
              </label>

              <button type="button" className="tactical-button-secondary" onClick={handleUndoDraft}>
                <Icon name="undo" className="h-4 w-4" />
                Desfazer
              </button>
              <button type="button" className="tactical-button-secondary" onClick={clearDraft}>
                <Icon name="trash" className="h-4 w-4" />
                Limpar
              </button>
            </div>
          </div>
        </div>
      </div>

      <aside className="space-y-6">
        <div className="tactical-panel px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-tactical-ash">
              <Icon name="clock" className="h-4 w-4" />
              {formatDuration(currentTime)}
            </span>
            <span className="text-xs font-black uppercase tracking-[0.22em] text-tactical-ash">
              {draftItemCount} {draftItemCount === 1 ? 'item' : 'itens'}
            </span>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="tactical-label">Nota</span>
              <textarea
                className="tactical-textarea"
                rows="5"
                maxLength={900}
                value={noteText}
                onChange={(event) => setNoteText(event.target.value)}
                placeholder="Ex: cobertura atrasou na segunda bola"
              />
            </label>

            <label className="block">
              <span className="tactical-label">Texto no video</span>
              <input
                className="tactical-input"
                maxLength={240}
                value={overlayText}
                onChange={(event) => setOverlayText(event.target.value)}
                placeholder="Caixa de texto"
              />
            </label>

            <button type="button" className="tactical-button w-full" onClick={handleSaveAnnotation}>
              <Icon name="save" className="h-4 w-4" />
              Salvar marcacao
            </button>
          </div>
        </div>

        <div className="tactical-panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-tactical-ink/10 px-5 py-4">
            <h2 className="text-lg font-black uppercase tracking-[0.14em] text-tactical-ink">Marcacoes</h2>
            <span className="grid h-10 w-10 place-items-center rounded-full bg-tactical-pitch/10 text-sm font-black text-tactical-pitch">
              {annotations.length}
            </span>
          </div>

          <div className="grid max-h-[calc(100vh-18rem)] gap-3 overflow-y-auto px-5 py-5">
            {!annotations.length ? (
              <div className="rounded-2xl border border-dashed border-tactical-ink/12 px-4 py-10 text-center">
                <strong className="block text-sm font-black uppercase tracking-[0.18em] text-tactical-ink">Sem marcacoes</strong>
                <span className="mt-2 block text-sm leading-6 text-tactical-ash">As notas salvas aparecem aqui.</span>
              </div>
            ) : null}

            {annotations.map((annotation) => {
              const itemCount = annotationItemCount(annotation);

              return (
                <article
                  key={annotation.id}
                  className={cn(
                    'rounded-2xl border border-tactical-ink/10 bg-white p-4 shadow-sm transition',
                    annotation.id === activeAnnotationId ? 'border-tactical-pitch shadow-glow' : ''
                  )}
                  style={{ borderLeftColor: annotation.color || '#3f8f29', borderLeftWidth: '5px' }}
                >
                  <div className="flex items-center justify-between gap-3 text-xs font-black uppercase tracking-[0.2em] text-tactical-ash">
                    <span className="inline-flex items-center gap-2">
                      <Icon name="clock" className="h-4 w-4" />
                      {formatDuration(annotation.time)}
                    </span>
                    <span>
                      {itemCount} {itemCount === 1 ? 'item' : 'itens'}
                    </span>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-tactical-ash">{annotation.text || 'Sem nota escrita.'}</p>

                  <div className="mt-4 grid grid-cols-[minmax(0,1fr)_48px] gap-3">
                    <button type="button" className="tactical-button-secondary" onClick={() => openAnnotation(annotation.id)}>
                      Abrir
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-11 items-center justify-center rounded-xl border border-tactical-ember/20 bg-tactical-ember/10 text-tactical-ember transition hover:bg-tactical-ember hover:text-white"
                      onClick={() => handleDeleteAnnotation(annotation.id)}
                    >
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </aside>
    </section>
  );
}
