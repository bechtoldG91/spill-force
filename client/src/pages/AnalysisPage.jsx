import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icons';
import { MARKER_TOLERANCE } from '../lib/constants';
import { cn, createId, formatDuration } from '../lib/utils';

const DEFAULT_DRAW_COLOR = '#ffd400';
const DEFAULT_DRAW_WIDTH = 6;
const DRAW_TOOLS = [
  { id: 'draw', label: 'Desenhar', icon: 'pen' },
  { id: 'circle', label: 'Redonda', icon: 'circle' },
  { id: 'arrow', label: 'Flecha', icon: 'arrow-up-right' },
  { id: 'text-box', label: 'Caixa de texto', icon: 'text' }
];

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

function isTypingTarget(target) {
  const tagName = target?.tagName?.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target?.isContentEditable;
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

function buildCircleStroke(start, end) {
  const centerX = (start.x + end.x) / 2;
  const centerY = (start.y + end.y) / 2;
  const radiusX = Math.max(Math.abs(end.x - start.x) / 2, 0.01);
  const radiusY = Math.max(Math.abs(end.y - start.y) / 2, 0.01);
  const points = [];

  for (let index = 0; index <= 48; index += 1) {
    const angle = (Math.PI * 2 * index) / 48;
    points.push({
      x: clamp(centerX + Math.cos(angle) * radiusX, 0, 1),
      y: clamp(centerY + Math.sin(angle) * radiusY, 0, 1)
    });
  }

  return points;
}

function buildArrowStroke(start, end) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const headLength = clamp(length * 0.28, 0.035, 0.09);
  const headAngle = Math.PI / 7;

  const headLeft = {
    x: clamp(end.x - Math.cos(angle - headAngle) * headLength, 0, 1),
    y: clamp(end.y - Math.sin(angle - headAngle) * headLength, 0, 1)
  };
  const headRight = {
    x: clamp(end.x - Math.cos(angle + headAngle) * headLength, 0, 1),
    y: clamp(end.y - Math.sin(angle + headAngle) * headLength, 0, 1)
  };

  return [start, end, headLeft, end, headRight];
}

function buildShapePoints(tool, start, end) {
  if (tool === 'circle') {
    return buildCircleStroke(start, end);
  }

  if (tool === 'arrow') {
    return buildArrowStroke(start, end);
  }

  return [start, end];
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

export function AnalysisPage({ showToast }) {
  const [searchParams] = useSearchParams();
  const queryVideoId = searchParams.get('video');
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const currentStrokeRef = useRef(null);
  const noteTextareaRef = useRef(null);
  const lastAutoPausedAnnotationRef = useRef(null);
  const shouldAutoplayNextRef = useRef(false);
  const [videos, setVideos] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [activeAnnotationId, setActiveAnnotationId] = useState(null);
  const [draftStrokes, setDraftStrokes] = useState([]);
  const [draftBoxes, setDraftBoxes] = useState([]);
  const [currentStroke, setCurrentStroke] = useState(null);
  const [drawTool, setDrawTool] = useState('draw');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPaused, setIsPaused] = useState(true);
  const [saveStatus, setSaveStatus] = useState('Pronto');
  const [noteText, setNoteText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pauseOnNotes, setPauseOnNotes] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [playbackMode, setPlaybackMode] = useState('all');

  useEffect(() => {
    currentStrokeRef.current = currentStroke;
  }, [currentStroke]);

  const selectedVideo = useMemo(
    () => videos.find((video) => video.id === selectedVideoId) || null,
    [videos, selectedVideoId]
  );

  const visibleAnnotations = useMemo(() => {
    if (!showNotes || !isPaused) {
      return [];
    }

    return annotations.filter((annotation) => Math.abs(annotation.time - currentTime) <= MARKER_TOLERANCE);
  }, [annotations, currentTime, isPaused, showNotes]);

  const visibleBoxes = useMemo(() => {
    if (!isPaused) {
      return [];
    }

    const annotationBoxes = visibleAnnotations.flatMap((annotation) => {
      if (annotation.boxes?.length) {
        return annotation.boxes;
      }

      return annotation.text
        ? [
            {
              id: `${annotation.id}-note`,
              x: 0.33,
              y: 0.06,
              width: 0.34,
              text: annotation.text,
              color: annotation.color || DEFAULT_DRAW_COLOR
            }
          ]
        : [];
    });

    return [...annotationBoxes, ...draftBoxes];
  }, [visibleAnnotations, draftBoxes, isPaused]);

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
    setCurrentStroke(null);
    setNoteText('');
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

  useEffect(() => {
    if (!pauseOnNotes || isPaused || !annotations.length) {
      return;
    }

    const nearest = nearestAnnotation(annotations, currentTime);
    if (!nearest) {
      lastAutoPausedAnnotationRef.current = null;
      return;
    }

    if (lastAutoPausedAnnotationRef.current === nearest.id) {
      return;
    }

    lastAutoPausedAnnotationRef.current = nearest.id;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = nearest.time;
    }
    setCurrentTime(nearest.time);
    setActiveAnnotationId(nearest.id);
  }, [annotations, currentTime, isPaused, pauseOnNotes]);

  useEffect(() => {
    if (isPaused || !selectedVideoId) {
      return undefined;
    }

    let frameId = 0;
    const syncPlaybackTime = () => {
      const video = videoRef.current;
      if (video) {
        setCurrentTime(video.currentTime || 0);
      }

      frameId = window.requestAnimationFrame(syncPlaybackTime);
    };

    frameId = window.requestAnimationFrame(syncPlaybackTime);
    return () => window.cancelAnimationFrame(frameId);
  }, [isPaused, selectedVideoId]);

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

  function handlePointerDown(event) {
    const canvas = canvasRef.current;
    const video = videoRef.current;

    if (!canvas || !selectedVideo || !video) {
      return;
    }

    event.preventDefault();
    video.pause();
    const point = pointFromEvent(event, canvas);

    if (drawTool === 'text-box') {
      setDraftBoxes((current) => [
        ...current,
        {
          id: createId(),
          x: clamp(point.x - 0.17, 0, 0.66),
          y: clamp(point.y - 0.04, 0, 0.9),
          width: 0.34,
          text: noteText.trim() || 'Texto',
          color: DEFAULT_DRAW_COLOR
        }
      ]);
      return;
    }

    const nextStroke = {
      color: DEFAULT_DRAW_COLOR,
      width: DEFAULT_DRAW_WIDTH,
      tool: drawTool,
      origin: point,
      points: [point]
    };

    event.currentTarget.setPointerCapture?.(event.pointerId);
    setCurrentStroke(nextStroke);
  }

  function handlePointerMove(event) {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    setCurrentStroke((stroke) => {
      if (!stroke) {
        return stroke;
      }

      const point = pointFromEvent(event, canvas);
      if (stroke.tool === 'circle' || stroke.tool === 'arrow') {
        return {
          ...stroke,
          points: buildShapePoints(stroke.tool, stroke.origin || stroke.points[0], point)
        };
      }

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
      const { origin, tool, ...savedStroke } = stroke;
      setDraftStrokes((current) => [...current, savedStroke]);
    }

    setCurrentStroke(null);
  }

  function undoLastDraftMarking() {
    if (currentStrokeRef.current) {
      setCurrentStroke(null);
      return;
    }

    if (draftBoxes.length) {
      setDraftBoxes((current) => current.slice(0, -1));
      return;
    }

    setDraftStrokes((current) => current.slice(0, -1));
  }

  async function handleSaveAnnotation() {
    if (!selectedVideo) {
      showToast('Selecione um video.');
      return;
    }

    const text = noteText.trim();
    if (!text && draftStrokes.length === 0 && draftBoxes.length === 0) {
      showToast('Adicione uma nota ou desenho.');
      return;
    }

    videoRef.current?.pause();

    const previousAnnotations = annotations;
    const annotation = {
      id: createId(),
      time: Number(currentTime.toFixed(2)),
      text,
      color: DEFAULT_DRAW_COLOR,
      strokes: draftStrokes,
      boxes: draftBoxes.length
        ? draftBoxes
        : text
        ? [
            {
              id: createId(),
              x: 0.33,
              y: 0.06,
              width: 0.34,
              text,
              color: DEFAULT_DRAW_COLOR
            }
          ]
        : [],
      createdAt: new Date().toISOString()
    };

    const nextAnnotations = [...previousAnnotations, annotation].sort((left, right) => left.time - right.time);
    setAnnotations(nextAnnotations);
    setActiveAnnotationId(annotation.id);

    try {
      const saved = await persistAnnotations(nextAnnotations);
      setAnnotations(saved);
      setNoteText('');
      setDraftStrokes([]);
      setDraftBoxes([]);
      setCurrentStroke(null);
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

  function handleNoteKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }

    event.preventDefault();
    handleSaveAnnotation();
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

  function toggleFullscreen() {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }

    stage.requestFullscreen?.().catch(() => showToast('Nao foi possivel abrir em tela cheia.'));
  }

  const selectAdjacentVideo = useCallback(
    (direction) => {
      const playlistVideos = selectedPlaylistId
        ? videos.filter((video) => video.playlistId === selectedPlaylistId)
        : videos;

      if (!playlistVideos.length) {
        return;
      }

      const currentIndex = playlistVideos.findIndex((video) => video.id === selectedVideoId);
      const fallbackIndex = direction > 0 ? -1 : 0;
      const nextIndex = (currentIndex === -1 ? fallbackIndex : currentIndex) + direction;
      const normalizedIndex = (nextIndex + playlistVideos.length) % playlistVideos.length;
      const nextVideo = playlistVideos[normalizedIndex];

      setSelectedPlaylistId(nextVideo.playlistId || selectedPlaylistId);
      setSelectedVideoId(nextVideo.id);
    },
    [selectedPlaylistId, selectedVideoId, videos]
  );

  function handleVideoEnded() {
    setIsPaused(true);

    const video = videoRef.current;
    if (playbackMode === 'repeat' && video) {
      video.currentTime = 0;
      setCurrentTime(0);
      video.play().catch(() => showToast('Nao foi possivel reproduzir.'));
      return;
    }

    shouldAutoplayNextRef.current = true;
    selectAdjacentVideo(1);
  }

  useEffect(() => {
    function handleKeyboardShortcut(event) {
      if (event.code === 'Space' && !isTypingTarget(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        const video = videoRef.current;
        if (!video || !selectedVideoId) {
          return;
        }

        if (video.paused) {
          video.play().catch(() => showToast('Nao foi possivel reproduzir.'));
          return;
        }

        video.pause();
        return;
      }

      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'q') {
        event.preventDefault();
        noteTextareaRef.current?.focus();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z') {
        if (isTypingTarget(event.target)) {
          return;
        }

        event.preventDefault();
        undoLastDraftMarking();
        return;
      }

      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isTypingTarget(event.target)) {
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        selectAdjacentVideo(1);
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        selectAdjacentVideo(-1);
      }
    }

    window.addEventListener('keydown', handleKeyboardShortcut, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyboardShortcut, { capture: true });
  }, [selectAdjacentVideo, selectedVideoId, showToast]);

  return (
    <section className="grid gap-2 xl:grid-cols-[200px_minmax(0,1fr)_296px] xl:items-start">
      <aside className="tactical-dark-panel ml-1 self-start px-2.5 pb-5 pt-3 sm:ml-1.5 xl:ml-0 xl:h-[min(68vh,654px)] xl:min-h-[524px]">
        <div>
          <span className="text-[0.68rem] font-black uppercase tracking-[0.3em] text-white/60">Playlists</span>
          <div className="mt-3 grid gap-1.5">
            {playlists.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                onClick={() => handlePlaylistSelect(playlist.id)}
                className={cn(
                  'grid min-h-9 grid-cols-[minmax(0,1fr)_1.75rem] items-center gap-1 rounded-lg border px-2 py-1.5 text-left text-[0.66rem] font-black uppercase tracking-[0.08em] transition',
                  playlist.id === selectedPlaylistId
                    ? 'border-tactical-pitch bg-tactical-pitch text-white shadow-glow'
                    : 'border-white/10 bg-white/5 text-white hover:border-tactical-pitch/40 hover:bg-white/10'
                )}
              >
                <span className="truncate">{playlist.name}</span>
                <span
                  className={cn(
                    'grid h-7 w-7 place-items-center rounded-full text-[0.56rem] tracking-[0.06em]',
                    playlist.id === selectedPlaylistId ? 'bg-white/15 text-white' : 'bg-white/10 text-tactical-mist'
                  )}
                >
                  {playlist.count || 0}
                </span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div className="space-y-4">
            <div
              ref={stageRef}
              className="relative aspect-[16/10] overflow-hidden rounded-md bg-black xl:aspect-auto xl:h-[min(68vh,654px)] xl:min-h-[524px]"
            >
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
                      if (shouldAutoplayNextRef.current) {
                        shouldAutoplayNextRef.current = false;
                        event.currentTarget.play().catch(() => showToast('Nao foi possivel reproduzir.'));
                      }
                    }}
                    onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
                    onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
                    onPlay={() => setIsPaused(false)}
                    onPause={(event) => {
                      setIsPaused(true);
                      setCurrentTime(event.currentTarget.currentTime || 0);
                    }}
                    onEnded={handleVideoEnded}
                  />
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 z-10 h-full w-full touch-none cursor-crosshair"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                  />
                  <div className="pointer-events-none absolute inset-0 z-20">
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

                  <div className="absolute left-4 top-4 z-30 flex flex-col rounded-xl border border-white/10 bg-black/58 p-1 shadow-2xl backdrop-blur">
                    {DRAW_TOOLS.map((tool) => (
                      <button
                        key={tool.id}
                        type="button"
                        aria-label={tool.label}
                        aria-pressed={drawTool === tool.id}
                        title={tool.label}
                        onClick={() => setDrawTool(tool.id)}
                        className={cn(
                          'grid h-10 w-10 place-items-center rounded-lg text-white transition',
                          drawTool === tool.id
                            ? 'bg-tactical-pitch shadow-glow'
                            : 'hover:bg-white/14 hover:text-white'
                        )}
                      >
                        <Icon name={tool.icon} className="h-5 w-5" />
                      </button>
                    ))}
                    <div className="my-1 h-px bg-white/10" />
                    <button
                      type="button"
                      aria-label="Desfazer ultima marcacao"
                      title="Desfazer ultima marcacao"
                      onClick={undoLastDraftMarking}
                      disabled={!currentStroke && draftStrokes.length === 0 && draftBoxes.length === 0}
                      className="grid h-10 w-10 place-items-center rounded-lg text-white transition hover:bg-white/14 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Icon name="undo" className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="absolute inset-x-0 bottom-0 z-30 h-12 bg-black/86 shadow-2xl">
                    <div className="flex h-full items-stretch">
                      <button
                        type="button"
                        className="grid h-full w-12 place-items-center border-r border-white/10 bg-transparent text-white transition hover:bg-white/12"
                        onClick={() => skip(-5)}
                      >
                        <Icon name="back" className="h-6 w-6" />
                      </button>
                      <button
                        type="button"
                        className="grid h-full w-12 place-items-center border-r border-white/10 bg-transparent text-white transition hover:bg-white/12"
                        onClick={togglePlayback}
                      >
                        <Icon name={isPaused ? 'play' : 'pause'} className="h-6 w-6" />
                      </button>
                      <button
                        type="button"
                        className="grid h-full w-12 place-items-center border-r border-white/10 bg-transparent text-white transition hover:bg-white/12"
                        onClick={() => skip(5)}
                      >
                        <Icon name="forward" className="h-6 w-6" />
                      </button>

                      <div className="relative flex h-full min-w-[220px] flex-1 items-center px-4">
                        {showNotes && duration && annotations.length ? (
                          <div className="pointer-events-none absolute inset-x-4 top-1/2">
                            {annotations.map((annotation) => (
                              <button
                                key={annotation.id}
                                type="button"
                                onClick={() => openAnnotation(annotation.id)}
                                className={cn(
                                  'pointer-events-auto absolute top-0 grid h-7 w-3.5 place-items-center rounded-full border shadow-md transition',
                                  annotation.id === activeAnnotationId
                                    ? 'border-white bg-tactical-ember'
                                    : 'border-tactical-ink bg-[#ffd400]'
                                )}
                                style={{ left: `${(annotation.time / duration) * 100}%`, transform: 'translate(-50%, -50%)' }}
                              >
                                <span className="h-3 w-1 rounded-full bg-tactical-ink" />
                              </button>
                            ))}
                          </div>
                        ) : null}
                        <input
                          className="timeline-slider timeline-slider-progress"
                          type="range"
                          min="0"
                          max="1000"
                          step="1"
                          value={duration ? Math.round((currentTime / duration) * 1000) : 0}
                          onChange={(event) => handleSeek(event.target.value)}
                          style={{
                            background: `linear-gradient(90deg, #3f8f29 0%, #3f8f29 ${
                              duration ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0
                            }%, rgba(255, 255, 255, 0.82) ${
                              duration ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0
                            }%, rgba(255, 255, 255, 0.82) 100%)`
                          }}
                        />
                      </div>

                      <button
                        type="button"
                        aria-label="Configuracoes do player"
                        title="Configuracoes do player"
                        onClick={() => setSettingsOpen((current) => !current)}
                        className="grid h-full w-12 place-items-center border-l border-white/10 bg-transparent text-white transition hover:bg-white/12"
                      >
                        <Icon name="settings" className="h-6 w-6" />
                      </button>

                      <button
                        type="button"
                        aria-label="Tela cheia"
                        title="Tela cheia"
                        onClick={toggleFullscreen}
                        className="grid h-full w-12 place-items-center border-l border-white/10 bg-transparent text-white transition hover:bg-white/12"
                      >
                        <Icon name="maximize" className="h-6 w-6" />
                      </button>
                    </div>
                  </div>
                  {settingsOpen ? (
                    <div className="absolute bottom-14 right-0 z-50 w-64 rounded-2xl border border-white/10 bg-tactical-ink p-3 text-white shadow-2xl">
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => setPauseOnNotes((current) => !current)}
                          className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-white/10"
                        >
                          <span className="text-xs font-black uppercase tracking-[0.14em]">Parar nas notas</span>
                          <span
                            className={cn(
                              'relative h-7 w-12 rounded-full transition',
                              pauseOnNotes ? 'bg-tactical-pitch' : 'bg-white/25'
                            )}
                          >
                            <span
                              className={cn(
                                'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition',
                                pauseOnNotes ? 'left-6' : 'left-1'
                              )}
                            />
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setShowNotes((current) => !current)}
                          className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-white/10"
                        >
                          <span className="text-xs font-black uppercase tracking-[0.14em]">Ver notas</span>
                          <span
                            className={cn(
                              'relative h-7 w-12 rounded-full transition',
                              showNotes ? 'bg-tactical-pitch' : 'bg-white/25'
                            )}
                          >
                            <span
                              className={cn(
                                'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition',
                                showNotes ? 'left-6' : 'left-1'
                              )}
                            />
                          </span>
                        </button>
                      </div>

                      <div className="mt-3 grid gap-2 border-t border-white/10 pt-3">
                        <button
                          type="button"
                          onClick={() => setPlaybackMode('all')}
                          className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-white/10"
                        >
                          <span className="text-xs font-black uppercase tracking-[0.14em]">PLAY ALL</span>
                          <span
                            className={cn(
                              'relative h-7 w-12 rounded-full transition',
                              playbackMode === 'all' ? 'bg-tactical-pitch' : 'bg-white/25'
                            )}
                          >
                            <span
                              className={cn(
                                'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition',
                                playbackMode === 'all' ? 'left-6' : 'left-1'
                              )}
                            />
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPlaybackMode('repeat')}
                          className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-white/10"
                        >
                          <span className="text-xs font-black uppercase tracking-[0.14em]">REPEAT</span>
                          <span
                            className={cn(
                              'relative h-7 w-12 rounded-full transition',
                              playbackMode === 'repeat' ? 'bg-tactical-pitch' : 'bg-white/25'
                            )}
                          >
                            <span
                              className={cn(
                                'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition',
                                playbackMode === 'repeat' ? 'left-6' : 'left-1'
                              )}
                            />
                          </span>
                        </button>
                      </div>
                    </div>
                  ) : null}
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
      </div>

      <aside className="space-y-6">
        <div className="tactical-panel px-5 py-4">
          <div className="space-y-3">
            <label className="block">
              <span className="tactical-label">Nota</span>
              <textarea
                ref={noteTextareaRef}
                className="tactical-textarea min-h-20"
                rows="3"
                maxLength={900}
                value={noteText}
                onChange={(event) => setNoteText(event.target.value)}
                onKeyDown={handleNoteKeyDown}
              />
            </label>

            <button type="button" className="tactical-button w-full" onClick={handleSaveAnnotation}>
              <Icon name="save" className="h-4 w-4" />
              Salvar marcacao
            </button>
          </div>
        </div>

        <div className="tactical-panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-tactical-ink/10 px-5 py-2.5">
            <h2 className="text-sm font-black uppercase tracking-[0.12em] text-tactical-ink">Marcacoes</h2>
            <span className="grid h-8 w-8 place-items-center rounded-full bg-tactical-pitch/10 text-xs font-black text-tactical-pitch">
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

            {annotations.map((annotation) => (
                <article
                  key={annotation.id}
                  className={cn(
                    'rounded-xl border border-tactical-ink/10 bg-white p-3 shadow-sm transition',
                    annotation.id === activeAnnotationId ? 'border-tactical-pitch shadow-glow' : ''
                  )}
                  style={{ borderLeftColor: annotation.color || '#3f8f29', borderLeftWidth: '5px' }}
                >
                  <p className="text-sm leading-5 text-tactical-ash">{annotation.text || 'Sem nota escrita.'}</p>

                  <div className="mt-3 grid grid-cols-[minmax(0,1fr)_42px] gap-2">
                    <button type="button" className="tactical-button-secondary min-h-10" onClick={() => openAnnotation(annotation.id)}>
                      Abrir
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-tactical-ember/20 bg-tactical-ember/10 text-tactical-ember transition hover:border-tactical-ember hover:bg-tactical-ember/18 hover:text-tactical-ember"
                      onClick={() => handleDeleteAnnotation(annotation.id)}
                    >
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  </div>
                </article>
              ))}
          </div>
        </div>
      </aside>
    </section>
  );
}
