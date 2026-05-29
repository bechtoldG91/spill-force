import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icons';
import { AnnotationPanel } from '../components/player/AnnotationPanel';
import { VideoPlayer } from '../components/player/VideoPlayer';
import {
  HOLD_SHORTCUT_DELAY_MS,
  REVERSE_FAST_MAX_STEP_SECONDS,
  REVERSE_FAST_MIN_STEP_SECONDS,
  REVERSE_FRAME_WAIT_MS,
  REVERSE_SEEK_EPSILON_SECONDS,
  REVERSE_SLOW_MIN_STEP_SECONDS,
  REVERSE_STEP_MS,
  clamp,
  isTypingTarget as isPlayerTypingTarget,
  timelineProgressBackground
} from '../components/player/playerUtils';
import { MARKER_TOLERANCE } from '../lib/constants';
import { authFetch } from '../lib/auth';
import { cn, createId, isVideoProcessing, videoProcessingMessage } from '../lib/utils';

const DEFAULT_DRAW_COLOR = '#ffd400';
const DEFAULT_DRAW_WIDTH = 6;
const CONTROL_CLICK_SUPPRESS_MS = 350;
const MARKER_DELETE_HOVER_DELAY_MS = 500;
const MARKER_DELETE_HIDE_DELAY_MS = 700;
const REVERSE_MAX_STEP_SECONDS = 0.04;
const DEFAULT_TEXT_BOX = {
  x: 0.62,
  y: 0.06,
  width: 0.34
};
const DRAW_TOOLS = [
  { id: 'draw', label: 'Desenhar', icon: 'pen' },
  { id: 'circle', label: 'Redonda', icon: 'circle' },
  { id: 'arrow', label: 'Flecha', icon: 'arrow-up-right' },
  { id: 'text-box', label: 'Caixa de texto', icon: 'text' }
];
const PLAYLIST_TABLE_COLUMNS = [
  { key: 'number', label: '#', width: 'min-w-[80px]' },
  { key: 'odk', label: 'ODK', width: 'min-w-[110px]' },
  { key: 'playType', label: 'Play Type', width: 'min-w-[150px]' },
  { key: 'dn', label: 'DN', width: 'min-w-[90px]' },
  { key: 'dist', label: 'Dist', width: 'min-w-[100px]' },
  { key: 'front', label: 'Front', width: 'min-w-[130px]' },
  { key: 'blitz', label: 'Blitz', width: 'min-w-[120px]' },
  { key: 'cover', label: 'Cover', width: 'min-w-[120px]' },
  { key: 'offForm', label: 'Off Form', width: 'min-w-[150px]' },
  { key: 'motion', label: 'Motion', width: 'min-w-[130px]' },
  { key: 'offPlay', label: 'Off Play', width: 'min-w-[160px]' }
];
const CUSTOM_ANALYSIS_COLUMNS_KEY = 'spill-force-analysis-custom-columns';

function pointFromEvent(event, element) {
  const rect = element.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
  };
}

function isTypingTarget(target) {
  return isPlayerTypingTarget(target, { includeRangeInput: true });
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

function annotationHasVisualMark(annotation) {
  return Boolean(annotation?.strokes?.length || annotation?.boxes?.length);
}

function annotationDisplayText(annotation) {
  const boxText = annotation?.boxes?.find((box) => box?.text)?.text;
  if (annotation?.text) {
    return annotation.text;
  }
  if (boxText) {
    return boxText;
  }
  if (annotationHasVisualMark(annotation)) {
    return 'Marcacao no video.';
  }
  return 'Sem nota escrita.';
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

export function AnalysisPage({ showToast, authUser }) {
  const [searchParams] = useSearchParams();
  const queryVideoId = searchParams.get('video');
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const currentStrokeRef = useRef(null);
  const noteTextareaRef = useRef(null);
  const fullscreenNoteTextareaRef = useRef(null);
  const markerDeleteTimerRef = useRef(null);
  const markerDeleteHideTimerRef = useRef(null);
  const lastAutoPausedAnnotationRef = useRef(null);
  const shouldAutoplayNextRef = useRef(false);
  const draftMarkTimeRef = useRef(null);
  const controlButtonHoldRef = useRef({
    timer: null,
    held: false,
    ignoreClick: false,
    direction: 0,
    wasPaused: true,
    previousRate: 1,
    reverseBaseClock: 0,
    reverseBaseTime: 0,
    reverseDisplayedTime: 0,
    reverseAnimationFrame: null
  });
  const arrowShortcutRef = useRef({
    key: null,
    timer: null,
    held: false,
    mode: null,
    wasPaused: true,
    previousRate: 1,
    reverseLastTime: 0,
    reverseBaseClock: 0,
    reverseBaseTime: 0,
    reverseDisplayedTime: 0,
    reverseTimer: null,
    reverseAnimationFrame: null,
    reverseFrameCallback: null,
    reverseSeekCleanup: null,
    reverseToken: 0
  });
  const replayAnchorRef = useRef(null);
  const [videos, setVideos] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [savingVideoId, setSavingVideoId] = useState('');
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
  const [fullscreenNoteOpen, setFullscreenNoteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pauseOnNotes, setPauseOnNotes] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [playbackMode, setPlaybackMode] = useState('all');
  const [replayAnchorTime, setReplayAnchorTime] = useState(null);
  const [timelineDeleteAnnotationId, setTimelineDeleteAnnotationId] = useState(null);
  const [tableEditable, setTableEditable] = useState(false);
  const [customAnalysisColumns, setCustomAnalysisColumns] = useState(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(CUSTOM_ANALYSIS_COLUMNS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const analysisColumns = useMemo(
    () => [...PLAYLIST_TABLE_COLUMNS, ...customAnalysisColumns],
    [customAnalysisColumns]
  );

  useEffect(() => {
    currentStrokeRef.current = currentStroke;
  }, [currentStroke]);

  useEffect(() => {
    window.localStorage.setItem(CUSTOM_ANALYSIS_COLUMNS_KEY, JSON.stringify(customAnalysisColumns));
  }, [customAnalysisColumns]);

  useEffect(
    () => () => {
      if (markerDeleteTimerRef.current) {
        window.clearTimeout(markerDeleteTimerRef.current);
      }
      if (markerDeleteHideTimerRef.current) {
        window.clearTimeout(markerDeleteHideTimerRef.current);
      }
      const controlState = controlButtonHoldRef.current;
      if (controlState.timer) {
        window.clearTimeout(controlState.timer);
      }
      if (controlState.reverseAnimationFrame) {
        window.cancelAnimationFrame(controlState.reverseAnimationFrame);
      }
    },
    []
  );

  useEffect(() => {
    function handleFullscreenChange() {
      if (document.fullscreenElement !== stageRef.current) {
        setFullscreenNoteOpen(false);
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const selectedVideo = useMemo(
    () => videos.find((video) => video.id === selectedVideoId) || null,
    [videos, selectedVideoId]
  );

  const selectedPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === selectedPlaylistId) || null,
    [playlists, selectedPlaylistId]
  );

  const playlistTableVideos = useMemo(
    () => (selectedPlaylistId ? videos.filter((video) => video.playlistId === selectedPlaylistId) : videos),
    [selectedPlaylistId, videos]
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
              ...DEFAULT_TEXT_BOX,
              text: annotation.text,
              color: annotation.color || DEFAULT_DRAW_COLOR
            }
          ]
        : [];
    });

    return [...annotationBoxes, ...draftBoxes];
  }, [visibleAnnotations, draftBoxes, isPaused]);

  const progressPercent = duration ? clamp((currentTime / duration) * 100, 0, 100) : 0;
  const replayAnchorPercent =
    duration && replayAnchorTime !== null ? clamp((replayAnchorTime / duration) * 100, 0, 100) : null;
  const baseProgressPercent =
    replayAnchorPercent === null ? progressPercent : Math.min(progressPercent, replayAnchorPercent);
  const replayProgressPercent =
    replayAnchorPercent === null ? progressPercent : Math.max(replayAnchorPercent, progressPercent);
  const timelineBackground =
    replayAnchorPercent === null
      ? timelineProgressBackground(progressPercent)
      : `linear-gradient(90deg, #3f8f29 0%, #3f8f29 ${baseProgressPercent}%, #2f3a45 ${baseProgressPercent}%, #2f3a45 ${replayAnchorPercent}%, #c93a3a ${replayAnchorPercent}%, #c93a3a ${replayProgressPercent}%, #2f3a45 ${replayProgressPercent}%, #2f3a45 100%)`;

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

    const strokes = [
      ...(isPaused ? visibleAnnotations.flatMap((annotation) => annotation.strokes || []) : []),
      ...draftStrokes,
      ...(currentStroke ? [currentStroke] : [])
    ];

    strokes.forEach((stroke) => drawStroke(context, stroke, rect.width, rect.height));
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
      const [videosResponse, playlistsResponse] = await Promise.all([authFetch('/api/videos'), authFetch('/api/playlists')]);

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
      replayAnchorRef.current = null;
      setReplayAnchorTime(null);
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
    replayAnchorRef.current = null;
    setReplayAnchorTime(null);

    async function loadAnnotations() {
      const response = await authFetch(`/api/videos/${selectedVideoId}/annotations`);
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
    if (!showNotes || !pauseOnNotes || isPaused || !annotations.length) {
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
  }, [annotations, currentTime, isPaused, pauseOnNotes, showNotes]);

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
    const response = await authFetch(`/api/videos/${selectedVideo.id}/annotations`, {
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

  function editableVideoValue(video, field) {
    return video.analysis?.[field] || '';
  }

  function updateVideoCell(videoId, field, value) {
    setVideos((current) =>
      current.map((video) =>
        video.id === videoId
          ? {
              ...video,
              analysis: {
                ...(video.analysis || {}),
                [field]: value
              }
            }
          : video
      )
    );
  }

  function addAnalysisColumn() {
    setCustomAnalysisColumns((current) => [
      ...current,
      {
        key: `custom-${Date.now()}`,
        label: `Coluna ${current.length + 1}`,
        width: 'min-w-[150px]'
      }
    ]);
  }

  function updateAnalysisColumnLabel(columnKey, label) {
    setCustomAnalysisColumns((current) =>
      current.map((column) => (column.key === columnKey ? { ...column, label } : column))
    );
  }

  function playVideoFromTable(video) {
    if (!video) {
      return;
    }

    setSelectedPlaylistId(video.playlistId || selectedPlaylistId);
    setSelectedVideoId(video.id);
    window.requestAnimationFrame(() => {
      const player = videoRef.current;
      if (!player) {
        return;
      }

      player.currentTime = 0;
      player.play().catch(() => showToast('Nao foi possivel reproduzir.'));
    });
  }

  async function saveVideoRow(videoId) {
    const video = videos.find((item) => item.id === videoId);
    if (!video) {
      return;
    }

    if (isVideoProcessing(video)) {
      showToast(videoProcessingMessage(video, authUser));
      return;
    }

    setSavingVideoId(videoId);
    try {
      const response = await authFetch(`/api/videos/${videoId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          teamId: video.teamId || '',
          playlistId: video.playlistId,
          analysis: video.analysis || {}
        })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel salvar a linha.');
      }

      const updatedVideo = payload.video || video;
      const nextVideos = videos.map((item) => (item.id === videoId ? updatedVideo : item));
      setVideos(nextVideos);
      setPlaylists((current) =>
        current.map((playlist) => ({
          ...playlist,
          count: nextVideos.filter((item) => item.playlistId === playlist.id).length
        }))
      );
      setSaveStatus('Salvo');
    } catch (error) {
      showToast(error.message);
    } finally {
      setSavingVideoId('');
    }
  }

  function handleTableCellKeyDown(event, videoId) {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }

    event.preventDefault();
    event.currentTarget.blur();
    saveVideoRow(videoId);
  }

  function handlePointerDown(event) {
    const canvas = canvasRef.current;
    const video = videoRef.current;

    if (!canvas || !selectedVideo || !video) {
      return;
    }

    event.preventDefault();
    video.pause();
    setIsPaused(true);
    const markTime = video.currentTime || 0;
    draftMarkTimeRef.current = markTime;
    setCurrentTime(markTime);
    if (drawTool === 'text-box') {
      focusNoteBox();
      return;
    }

    const point = pointFromEvent(event, canvas);

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
      focusNoteBox();
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

  function returnFocusToPage() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    noteTextareaRef.current?.blur();
    fullscreenNoteTextareaRef.current?.blur();
    setFullscreenNoteOpen(false);
    stageRef.current?.focus({ preventScroll: true });
    window.setTimeout(() => stageRef.current?.focus({ preventScroll: true }), 0);
  }

  function focusNoteBox() {
    if (document.fullscreenElement === stageRef.current) {
      setFullscreenNoteOpen(true);
      window.requestAnimationFrame(() => fullscreenNoteTextareaRef.current?.focus({ preventScroll: true }));
      return;
    }

    setFullscreenNoteOpen(false);
    window.requestAnimationFrame(() => noteTextareaRef.current?.focus({ preventScroll: true }));
  }

  function handleDrawToolSelect(toolId) {
    setDrawTool(toolId);

    if (toolId !== 'text-box') {
      return;
    }

    const video = videoRef.current;
    if (video) {
      video.pause();
      setIsPaused(true);
      draftMarkTimeRef.current = video.currentTime || 0;
      setCurrentTime(video.currentTime || 0);
    }

    focusNoteBox();
  }

  function clearMarkerDeleteTimer() {
    if (markerDeleteTimerRef.current) {
      window.clearTimeout(markerDeleteTimerRef.current);
      markerDeleteTimerRef.current = null;
    }
  }

  function clearMarkerDeleteHideTimer() {
    if (markerDeleteHideTimerRef.current) {
      window.clearTimeout(markerDeleteHideTimerRef.current);
      markerDeleteHideTimerRef.current = null;
    }
  }

  function scheduleMarkerDeletePopover(annotationId) {
    clearMarkerDeleteTimer();
    clearMarkerDeleteHideTimer();
    markerDeleteTimerRef.current = window.setTimeout(() => {
      setTimelineDeleteAnnotationId(annotationId);
      markerDeleteTimerRef.current = null;
    }, MARKER_DELETE_HOVER_DELAY_MS);
  }

  function hideMarkerDeletePopover(annotationId) {
    clearMarkerDeleteTimer();
    clearMarkerDeleteHideTimer();
    markerDeleteHideTimerRef.current = window.setTimeout(() => {
      setTimelineDeleteAnnotationId((current) => (current === annotationId ? null : current));
      markerDeleteHideTimerRef.current = null;
    }, MARKER_DELETE_HIDE_DELAY_MS);
  }

  async function publishAnnotation({ text = '', strokes = [], boxes = [], time = currentTime } = {}) {
    if (!selectedVideo) {
      showToast('Selecione um video.');
      return null;
    }

    const cleanText = text.trim();
    const nextStrokes = Array.isArray(strokes) ? strokes : [];
    const nextBoxes = Array.isArray(boxes) ? boxes : [];

    if (!cleanText && nextStrokes.length === 0 && nextBoxes.length === 0) {
      showToast('Adicione uma nota ou desenho.');
      return null;
    }

    returnFocusToPage();
    videoRef.current?.pause();
    setIsPaused(true);

    const previousAnnotations = annotations;
    const annotation = {
      id: createId(),
      time: Number(time.toFixed(2)),
      text: cleanText,
      color: DEFAULT_DRAW_COLOR,
      strokes: nextStrokes,
      boxes: nextBoxes.length
        ? nextBoxes
        : cleanText
        ? [
            {
              id: createId(),
              ...DEFAULT_TEXT_BOX,
              text: cleanText,
              color: DEFAULT_DRAW_COLOR
            }
          ]
        : [],
      createdAt: new Date().toISOString()
    };

    const nextAnnotations = [...previousAnnotations, annotation].sort((left, right) => left.time - right.time);
    setAnnotations(nextAnnotations);
    setActiveAnnotationId(annotation.id);
    lastAutoPausedAnnotationRef.current = annotation.id;

    try {
      const saved = await persistAnnotations(nextAnnotations);
      setAnnotations(saved);
      setNoteText('');
      setDraftStrokes([]);
      setDraftBoxes([]);
      draftMarkTimeRef.current = null;
      setCurrentStroke(null);
      showToast('Marcacao salva.');
      returnFocusToPage();
      return annotation;
    } catch (error) {
      setAnnotations(previousAnnotations);
      setActiveAnnotationId(null);
      showToast(error.message);
      return null;
    }
  }

  async function handleSaveAnnotation() {
    await publishAnnotation({
      text: noteText,
      strokes: draftStrokes,
      boxes: draftBoxes,
      time: draftMarkTimeRef.current ?? currentTime
    });
  }

  async function handleDeleteAnnotation(annotationId) {
    clearMarkerDeleteTimer();
    clearMarkerDeleteHideTimer();
    setTimelineDeleteAnnotationId(null);
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

  async function handleDeleteAllAnnotations() {
    if (!annotations.length) {
      return;
    }

    const confirmed = window.confirm('Deletar todas as marcacoes deste video?');
    if (!confirmed) {
      return;
    }

    clearMarkerDeleteTimer();
    clearMarkerDeleteHideTimer();
    setTimelineDeleteAnnotationId(null);
    const previousAnnotations = annotations;
    setAnnotations([]);
    setActiveAnnotationId(null);
    lastAutoPausedAnnotationRef.current = null;

    try {
      const saved = await persistAnnotations([]);
      setAnnotations(saved);
      showToast('Todas as marcacoes foram removidas.');
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

  function clearControlButtonHoldTimers() {
    const state = controlButtonHoldRef.current;
    if (state.timer) {
      window.clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.reverseAnimationFrame) {
      window.cancelAnimationFrame(state.reverseAnimationFrame);
      state.reverseAnimationFrame = null;
    }
  }

  function startControlButtonReverse(rate = 2) {
    const video = videoRef.current;
    const state = controlButtonHoldRef.current;
    if (!video || !selectedVideoId) {
      return;
    }

    video.pause();
    state.reverseBaseClock = performance.now();
    state.reverseBaseTime = video.currentTime || 0;
    state.reverseDisplayedTime = state.reverseBaseTime;

    const step = (now = performance.now()) => {
      if (!state.held || state.direction >= 0) {
        return;
      }

      const elapsed = Math.max((now - state.reverseBaseClock) / 1000, 0);
      const desiredTime = clamp(state.reverseBaseTime - elapsed * rate, 0, duration || Number.MAX_SAFE_INTEGER);
      const distance = state.reverseDisplayedTime - desiredTime;
      const nextTime = distance > REVERSE_FAST_MAX_STEP_SECONDS ? state.reverseDisplayedTime - REVERSE_FAST_MAX_STEP_SECONDS : desiredTime;
      const clampedTime = clamp(nextTime, 0, duration || Number.MAX_SAFE_INTEGER);

      if (Math.abs((video.currentTime || 0) - clampedTime) > REVERSE_SEEK_EPSILON_SECONDS) {
        video.currentTime = clampedTime;
        state.reverseDisplayedTime = clampedTime;
        setCurrentTime(clampedTime);
      }

      state.reverseAnimationFrame = window.requestAnimationFrame(step);
    };

    state.reverseAnimationFrame = window.requestAnimationFrame(step);
  }

  function startControlButtonHold(direction) {
    const video = videoRef.current;
    const state = controlButtonHoldRef.current;
    if (!video || !selectedVideoId || state.direction !== direction) {
      return;
    }

    state.held = true;
    state.ignoreClick = true;

    if (direction > 0) {
      video.playbackRate = 2.5;
      video.play().catch(() => showToast('Nao foi possivel reproduzir.'));
      return;
    }

    startControlButtonReverse(2);
  }

  function handleControlButtonPointerDown(event, direction) {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    const video = videoRef.current;
    const state = controlButtonHoldRef.current;
    clearControlButtonHoldTimers();

    state.held = false;
    state.ignoreClick = false;
    state.direction = direction;
    state.wasPaused = video?.paused ?? true;
    state.previousRate = video?.playbackRate || 1;
    state.timer = window.setTimeout(() => startControlButtonHold(direction), HOLD_SHORTCUT_DELAY_MS);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function finishControlButtonHold() {
    const video = videoRef.current;
    const state = controlButtonHoldRef.current;
    const wasHeld = state.held;

    clearControlButtonHoldTimers();

    if (wasHeld && video) {
      video.playbackRate = state.previousRate || 1;
      if (state.wasPaused) {
        video.pause();
      } else {
        video.play().catch(() => showToast('Nao foi possivel reproduzir.'));
      }
    }

    state.held = false;
    state.direction = 0;

    if (wasHeld) {
      state.ignoreClick = true;
      window.setTimeout(() => {
        state.ignoreClick = false;
      }, CONTROL_CLICK_SUPPRESS_MS);
    }
  }

  function handleControlButtonClick(event, direction) {
    const state = controlButtonHoldRef.current;
    if (state.ignoreClick) {
      event.preventDefault();
      event.stopPropagation();
      state.ignoreClick = false;
      return;
    }

    selectAdjacentVideo(direction);
  }

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
    const arrowKeys = new Set(['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']);

    function clearArrowTimer() {
      const state = arrowShortcutRef.current;
      if (state.timer) {
        window.clearTimeout(state.timer);
        state.timer = null;
      }
    }

    function stopReversePlayback() {
      const state = arrowShortcutRef.current;
      const video = videoRef.current;
      if (state.reverseTimer) {
        window.clearTimeout(state.reverseTimer);
        state.reverseTimer = null;
      }
      if (state.reverseAnimationFrame) {
        window.cancelAnimationFrame(state.reverseAnimationFrame);
        state.reverseAnimationFrame = null;
      }
      if (state.reverseSeekCleanup) {
        state.reverseSeekCleanup();
      }
      if (state.reverseFrameCallback && typeof video?.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(state.reverseFrameCallback);
      }
      state.reverseFrameCallback = null;
      state.reverseSeekCleanup = null;
      state.reverseToken += 1;
    }

    function restorePlaybackAfterHold() {
      const state = arrowShortcutRef.current;
      const video = videoRef.current;
      const hasActiveShortcut = state.key || state.timer || state.mode || state.reverseTimer;

      if (!hasActiveShortcut) {
        return;
      }

      clearArrowTimer();
      stopReversePlayback();

      if (video) {
        video.playbackRate = state.previousRate || 1;

        if (state.wasPaused) {
          video.pause();
        } else {
          video.play().catch(() => showToast('Nao foi possivel reproduzir.'));
        }
      }

      state.key = null;
      state.held = false;
      state.mode = null;
    }

    function playWithTemporaryRate(rate) {
      const video = videoRef.current;
      if (!video || !selectedVideoId) {
        return;
      }

      video.playbackRate = rate;
      video.play().catch(() => showToast('Nao foi possivel reproduzir.'));
    }

    function playReverseSlowMotion(rate = 0.5, maxStepSeconds = REVERSE_MAX_STEP_SECONDS, minStepSeconds = 0) {
      const video = videoRef.current;
      const state = arrowShortcutRef.current;
      if (!video || !selectedVideoId) {
        return;
      }

      stopReversePlayback();
      video.pause();
      state.reverseLastTime = performance.now();
      state.reverseBaseClock = state.reverseLastTime;
      state.reverseBaseTime = video.currentTime || 0;
      state.reverseDisplayedTime = state.reverseBaseTime;
      const reverseToken = state.reverseToken;

      const scheduleStep = (delay = 0) => {
        const activeState = arrowShortcutRef.current;
        if (activeState.reverseToken !== reverseToken || activeState.mode !== 'reverse') {
          return;
        }

        activeState.reverseTimer = window.setTimeout(() => {
          activeState.reverseTimer = null;
          step(performance.now());
        }, delay);
      };

      const waitForRenderedSeek = (targetTime) => {
        const activeState = arrowShortcutRef.current;
        let completed = false;

        const cleanup = () => {
          video.removeEventListener('seeked', finish);
          if (activeState.reverseTimer) {
            window.clearTimeout(activeState.reverseTimer);
            activeState.reverseTimer = null;
          }
          if (activeState.reverseFrameCallback && typeof video.cancelVideoFrameCallback === 'function') {
            video.cancelVideoFrameCallback(activeState.reverseFrameCallback);
          }
          activeState.reverseFrameCallback = null;
          activeState.reverseSeekCleanup = null;
        };

        const finish = () => {
          if (completed) {
            return;
          }

          completed = true;
          cleanup();

          if (activeState.reverseToken !== reverseToken || activeState.mode !== 'reverse') {
            return;
          }

          const actualTime = clamp(video.currentTime || targetTime, 0, duration || Number.MAX_SAFE_INTEGER);
          activeState.reverseDisplayedTime = actualTime;
          setCurrentTime(actualTime);
          scheduleStep(REVERSE_STEP_MS);
        };

        activeState.reverseSeekCleanup = cleanup;
        video.addEventListener('seeked', finish, { once: true });
        activeState.reverseTimer = window.setTimeout(finish, REVERSE_FRAME_WAIT_MS);

        if (typeof video.requestVideoFrameCallback === 'function') {
          activeState.reverseFrameCallback = video.requestVideoFrameCallback(finish);
        }

        video.currentTime = targetTime;
      };

      const step = (now = performance.now()) => {
        const activeState = arrowShortcutRef.current;
        if (activeState.reverseToken !== reverseToken || activeState.mode !== 'reverse') {
          return;
        }

        const elapsed = Math.max((now - activeState.reverseBaseClock) / 1000, 0);
        const desiredTime = clamp(activeState.reverseBaseTime - elapsed * rate, 0, duration || Number.MAX_SAFE_INTEGER);
        const displayedTime = Number.isFinite(activeState.reverseDisplayedTime)
          ? activeState.reverseDisplayedTime
          : video.currentTime || 0;
        const distance = displayedTime - desiredTime;
        const seekDistance = clamp(Math.max(distance, minStepSeconds), 0, maxStepSeconds);
        const nextTime = displayedTime - seekDistance;
        const clampedTime = clamp(nextTime, 0, duration || Number.MAX_SAFE_INTEGER);

        if (Math.abs((video.currentTime || 0) - clampedTime) > REVERSE_SEEK_EPSILON_SECONDS) {
          waitForRenderedSeek(clampedTime);
          return;
        }

        activeState.reverseLastTime = now;
        scheduleStep(REVERSE_STEP_MS);
      };

      scheduleStep(REVERSE_STEP_MS);
    }

    function startArrowHoldAction(key) {
      const state = arrowShortcutRef.current;
      const video = videoRef.current;
      if (state.key !== key || !video || !selectedVideoId) {
        return;
      }

      state.held = true;
      state.mode = key === 'ArrowLeft' || key === 'ArrowUp' ? 'reverse' : 'rate';

      if (key === 'ArrowRight') {
        playWithTemporaryRate(2.5);
        return;
      }

      if (key === 'ArrowDown') {
        playWithTemporaryRate(0.5);
        return;
      }

      if (key === 'ArrowUp') {
        playReverseSlowMotion(2, REVERSE_FAST_MAX_STEP_SECONDS, REVERSE_FAST_MIN_STEP_SECONDS);
        return;
      }

      if (key === 'ArrowLeft') {
        playReverseSlowMotion(0.5, REVERSE_SLOW_MIN_STEP_SECONDS, REVERSE_SLOW_MIN_STEP_SECONDS);
      }
    }

    function runArrowTapAction(key) {
      const video = videoRef.current;

      if (key === 'ArrowRight') {
        selectAdjacentVideo(1);
        return;
      }

      if (key === 'ArrowLeft') {
        selectAdjacentVideo(-1);
        return;
      }

      if (key === 'ArrowDown') {
        togglePlayback();
        return;
      }

      if (key === 'ArrowUp' && video) {
        const shouldResume = !video.paused;
        const nextTime =
          replayAnchorRef.current !== null ? clamp(replayAnchorRef.current, 0, duration || Number.MAX_SAFE_INTEGER) : 0;
        video.currentTime = nextTime;
        setCurrentTime(nextTime);
        if (shouldResume) {
          video.play().catch(() => showToast('Nao foi possivel reproduzir.'));
        }
      }
    }

    function handleKeyboardShortcut(event) {
      const targetIsTyping = isTypingTarget(event.target);
      const shiftOnly = event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
      const typingShiftShortcut = targetIsTyping && shiftOnly;

      if (event.code === 'Space' && (!targetIsTyping || typingShiftShortcut)) {
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

      if (shiftOnly && event.key.toLowerCase() === 'q' && !targetIsTyping) {
        event.preventDefault();
        const video = videoRef.current;
        if (video && !video.paused) {
          video.pause();
        }
        if (document.fullscreenElement === stageRef.current) {
          setFullscreenNoteOpen(true);
          window.requestAnimationFrame(() => fullscreenNoteTextareaRef.current?.focus());
        } else {
          setFullscreenNoteOpen(false);
          noteTextareaRef.current?.focus();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z') {
        if (targetIsTyping) {
          return;
        }

        event.preventDefault();
        undoLastDraftMarking();
        return;
      }

      if (arrowKeys.has(event.key)) {
        const regularArrowShortcut = !targetIsTyping && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
        const shiftedTypingArrowShortcut = targetIsTyping && shiftOnly;

        if (!regularArrowShortcut && !shiftedTypingArrowShortcut) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (event.repeat || arrowShortcutRef.current.key) {
          return;
        }

        const video = videoRef.current;
        const state = arrowShortcutRef.current;
        state.key = event.key;
        state.held = false;
        state.mode = null;
        state.wasPaused = video?.paused ?? true;
        state.previousRate = video?.playbackRate || 1;
        state.timer = window.setTimeout(() => startArrowHoldAction(event.key), HOLD_SHORTCUT_DELAY_MS);
      }
    }

    function handleKeyboardShortcutRelease(event) {
      const state = arrowShortcutRef.current;
      if (!state.key || event.key !== state.key) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const key = state.key;
      const wasHeld = state.held;

      if (wasHeld) {
        if (key === 'ArrowUp') {
          const video = videoRef.current;
          const anchorTime = clamp(video?.currentTime || 0, 0, duration || Number.MAX_SAFE_INTEGER);
          replayAnchorRef.current = anchorTime;
          setReplayAnchorTime(anchorTime);
        }

        restorePlaybackAfterHold();
        return;
      }

      clearArrowTimer();
      state.key = null;
      state.mode = null;
      runArrowTapAction(key);
    }

    window.addEventListener('keydown', handleKeyboardShortcut, { capture: true });
    window.addEventListener('keyup', handleKeyboardShortcutRelease, { capture: true });
    window.addEventListener('blur', restorePlaybackAfterHold);

    return () => {
      window.removeEventListener('keydown', handleKeyboardShortcut, { capture: true });
      window.removeEventListener('keyup', handleKeyboardShortcutRelease, { capture: true });
      window.removeEventListener('blur', restorePlaybackAfterHold);
      restorePlaybackAfterHold();
    };
  }, [duration, selectAdjacentVideo, selectedVideoId, showToast]);

  return (
    <section
      className={cn(
        'relative left-1/2 grid w-full -translate-x-1/2 gap-6 xl:w-[min(calc(100vw-2rem),1800px)] xl:grid-cols-[minmax(0,1fr)_296px] xl:items-start'
      )}
    >
      <div className="space-y-4">
        <VideoPlayer
          containerRef={stageRef}
          videoRef={videoRef}
          video={selectedVideo}
          src={selectedVideo?.url}
          preload="auto"
          className="relative aspect-[16/10] overflow-hidden rounded-md bg-black focus:outline-none xl:aspect-auto xl:h-[min(68vh,654px)] xl:min-h-[524px]"
          currentTime={currentTime}
          duration={duration}
          isPaused={isPaused}
          timelineBackground={timelineBackground}
          showTimeDisplay={false}
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
          previousButtonProps={{
            onPointerDown: (event) => handleControlButtonPointerDown(event, -1),
            onPointerUp: finishControlButtonHold,
            onPointerCancel: finishControlButtonHold,
            onClick: (event) => handleControlButtonClick(event, -1)
          }}
          nextButtonProps={{
            onPointerDown: (event) => handleControlButtonPointerDown(event, 1),
            onPointerUp: finishControlButtonHold,
            onPointerCancel: finishControlButtonHold,
            onClick: (event) => handleControlButtonClick(event, 1)
          }}
          onTogglePlayback={togglePlayback}
          onSeek={handleSeek}
          onTimelinePointerUp={() => stageRef.current?.focus({ preventScroll: true })}
          rightControls={
            <>
              <button
                type="button"
                aria-label="Configuracoes do player"
                title="Configuracoes do player"
                onClick={() => setSettingsOpen((current) => !current)}
                className="grid h-full w-12 place-items-center bg-transparent text-white transition hover:bg-white/12 focus:outline-none focus-visible:outline-none"
              >
                <Icon name="settings" className="h-6 w-6" />
              </button>

              <button
                type="button"
                aria-label="Tela cheia"
                title="Tela cheia"
                onClick={toggleFullscreen}
                className="grid h-full w-12 place-items-center bg-transparent text-white transition hover:bg-white/12 focus:outline-none focus-visible:outline-none"
              >
                <Icon name="maximize" className="h-6 w-6" />
              </button>
            </>
          }
          timelineChildren={
            showNotes && duration && annotations.length ? (
              <div className="pointer-events-none absolute inset-x-0 top-1/2">
                {annotations.map((annotation) => {
                  const markerLeft = `${clamp((annotation.time / duration) * 100, 0, 100)}%`;

                  return (
                    <div
                      key={annotation.id}
                      className="pointer-events-auto absolute top-0 z-20"
                      style={{ left: markerLeft, transform: 'translate(-50%, -50%)' }}
                      onMouseEnter={() => scheduleMarkerDeletePopover(annotation.id)}
                      onMouseLeave={() => hideMarkerDeletePopover(annotation.id)}
                    >
                      <button
                        type="button"
                        onClick={() => openAnnotation(annotation.id)}
                        className={cn(
                          'grid h-7 w-3.5 place-items-center rounded-full border shadow-md transition focus:outline-none focus-visible:outline-none',
                          annotation.id === activeAnnotationId ? 'border-white bg-tactical-ember' : 'border-tactical-ink bg-[#ffd400]'
                        )}
                      >
                        <span className="h-3 w-1 rounded-full bg-tactical-ink" />
                      </button>

                      {timelineDeleteAnnotationId === annotation.id ? (
                        <div
                          className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-xl bg-tactical-ink p-1 shadow-xl"
                          onMouseEnter={clearMarkerDeleteHideTimer}
                          onMouseLeave={() => hideMarkerDeletePopover(annotation.id)}
                        >
                          <button
                            type="button"
                            aria-label="Deletar marcacao"
                            title="Deletar marcacao"
                            className="grid h-8 w-8 place-items-center rounded-lg text-white transition hover:bg-white/12 focus:outline-none focus-visible:outline-none"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              handleDeleteAnnotation(annotation.id);
                            }}
                          >
                            <Icon name="trash" className="h-4 w-4" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null
          }
        >
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
                  maxWidth: `${clamp(100 - box.x * 100 - 2, 12, 55)}%`,
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
                onClick={() => handleDrawToolSelect(tool.id)}
                className={cn(
                  'grid h-10 w-10 place-items-center rounded-lg text-white transition',
                  drawTool === tool.id ? 'bg-tactical-pitch shadow-glow' : 'hover:bg-white/14 hover:text-white'
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

          {fullscreenNoteOpen ? (
            <div className="absolute right-4 top-4 z-50 w-[min(360px,calc(100%-2rem))] rounded-2xl border border-white/12 bg-white p-3 shadow-2xl">
              <label className="block">
                <span className="tactical-label">Nota</span>
                <textarea
                  ref={fullscreenNoteTextareaRef}
                  className="tactical-textarea min-h-24"
                  rows="3"
                  maxLength={900}
                  placeholder="Shift + Q para digitar"
                  value={noteText}
                  onChange={(event) => setNoteText(event.target.value)}
                  onKeyDown={handleNoteKeyDown}
                />
              </label>
              <span className="mt-2 block text-[0.62rem] font-black uppercase tracking-[0.14em] text-tactical-ash">
                Enter salva / Shift + Enter quebra linha
              </span>
            </div>
          ) : null}

          {settingsOpen ? (
            <div className="absolute bottom-14 right-3 z-50 w-64 rounded-2xl border border-white/10 bg-tactical-ink p-2.5 text-white shadow-2xl">
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => setPauseOnNotes((current) => !current)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-1.5 text-left transition hover:bg-white/10"
                >
                  <span className="text-xs font-black uppercase tracking-[0.14em]">Parar nas notas</span>
                  <span className={cn('relative h-7 w-12 rounded-full transition', pauseOnNotes ? 'bg-tactical-pitch' : 'bg-white/25')}>
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
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-1.5 text-left transition hover:bg-white/10"
                >
                  <span className="text-xs font-black uppercase tracking-[0.14em]">Ver notas</span>
                  <span className={cn('relative h-7 w-12 rounded-full transition', showNotes ? 'bg-tactical-pitch' : 'bg-white/25')}>
                    <span
                      className={cn(
                        'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition',
                        showNotes ? 'left-6' : 'left-1'
                      )}
                    />
                  </span>
                </button>
              </div>

              <div className="mt-2 grid gap-1 border-t border-white/10 pt-2">
                <button
                  type="button"
                  onClick={() => setPlaybackMode('all')}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-1.5 text-left transition hover:bg-white/10"
                >
                  <span className="text-xs font-black uppercase tracking-[0.14em]">PLAY ALL</span>
                  <span className={cn('relative h-7 w-12 rounded-full transition', playbackMode === 'all' ? 'bg-tactical-pitch' : 'bg-white/25')}>
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
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-1.5 text-left transition hover:bg-white/10"
                >
                  <span className="text-xs font-black uppercase tracking-[0.14em]">REPEAT</span>
                  <span className={cn('relative h-7 w-12 rounded-full transition', playbackMode === 'repeat' ? 'bg-tactical-pitch' : 'bg-white/25')}>
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
        </VideoPlayer>
      </div>

      <AnnotationPanel
        annotations={annotations}
        activeAnnotationId={activeAnnotationId}
        noteTextareaRef={noteTextareaRef}
        noteText={noteText}
        onNoteChange={setNoteText}
        onNoteKeyDown={handleNoteKeyDown}
        onSaveAnnotation={handleSaveAnnotation}
        onOpenAnnotation={openAnnotation}
        onDeleteAnnotation={handleDeleteAnnotation}
        onDeleteAllAnnotations={handleDeleteAllAnnotations}
        annotationDisplayText={annotationDisplayText}
      />

      <section className="tactical-panel overflow-hidden xl:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-tactical-ink/10 px-5 py-4">
          <div className="min-w-0">
            <span className="tactical-label mb-1">Playlist</span>
            <h2 className="truncate text-2xl font-black tracking-tight text-tactical-ink">
              {selectedPlaylist?.name || 'Tabela de videos'}
            </h2>
          </div>
          <div className="flex max-w-full flex-wrap gap-2">
            {playlists.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                onClick={() => handlePlaylistSelect(playlist.id)}
                className={cn(
                  'inline-flex min-h-9 items-center gap-2 rounded-xl border px-3 text-xs font-black uppercase tracking-[0.12em] transition',
                  playlist.id === selectedPlaylistId
                    ? 'border-tactical-pitch bg-tactical-pitch text-white shadow-glow'
                    : 'border-tactical-ink/10 bg-white text-tactical-ink hover:border-tactical-pitch/35 hover:bg-tactical-pitch/10'
                )}
              >
                <span className="max-w-[12rem] truncate">{playlist.name}</span>
                <span className={cn('rounded-full px-2 py-0.5 text-[0.6rem]', playlist.id === selectedPlaylistId ? 'bg-white/20' : 'bg-tactical-bone')}>
                  {playlist.count || 0}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setTableEditable((current) => !current)}
              className={cn(
                'inline-flex min-h-9 items-center rounded-xl border px-3 text-xs font-black uppercase tracking-[0.12em] transition',
                tableEditable
                  ? 'border-tactical-pitch bg-tactical-pitch text-white shadow-glow'
                  : 'border-tactical-ink/10 bg-white text-tactical-ink hover:border-tactical-pitch/35 hover:bg-tactical-pitch/10'
              )}
            >
              {tableEditable ? 'Editavel' : 'Reproducao'}
            </button>
            <button
              type="button"
              onClick={addAnalysisColumn}
              disabled={!tableEditable}
              className="inline-flex min-h-9 items-center rounded-xl border border-tactical-pitch/30 bg-tactical-pitch/10 px-3 text-xs font-black uppercase tracking-[0.12em] text-tactical-ink transition hover:border-tactical-pitch hover:bg-tactical-pitch hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
            >
              + Coluna
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] border-collapse text-left">
            <thead>
              <tr className="bg-tactical-bone/70">
                <th className="w-24 border-b border-r border-tactical-line/35 px-3 py-3 text-[0.62rem] font-black uppercase tracking-[0.16em] text-tactical-ash">
                  Abrir
                </th>
                {analysisColumns.map((column) => (
                  <th
                    key={column.key}
                    className={cn(
                      'border-b border-r border-tactical-line/35 px-3 py-3 text-[0.62rem] font-black uppercase tracking-[0.16em] text-tactical-ash',
                      column.width
                    )}
                  >
                    {column.key.startsWith('custom-') ? (
                      <input
                        className="w-full bg-transparent font-black uppercase tracking-[0.16em] text-tactical-ash outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-tactical-pitch/25"
                        value={column.label}
                        maxLength={40}
                        disabled={!tableEditable}
                        onChange={(event) => updateAnalysisColumnLabel(column.key, event.target.value)}
                      />
                    ) : (
                      column.label
                    )}
                  </th>
                ))}
                <th className="w-28 border-b border-tactical-line/35 px-3 py-3 text-[0.62rem] font-black uppercase tracking-[0.16em] text-tactical-ash">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {playlistTableVideos.map((video) => (
                <tr
                  key={video.id}
                  className={cn(
                    'transition',
                    tableEditable ? '' : 'cursor-pointer',
                    video.id === selectedVideoId ? 'bg-tactical-pitch/10' : 'bg-white hover:bg-tactical-bone/40'
                  )}
                  onClick={() => {
                    if (!tableEditable) {
                      playVideoFromTable(video);
                    }
                  }}
                >
                  <td className="border-b border-r border-tactical-line/35 px-2 py-2 align-top">
                    <button
                      type="button"
                      className={cn(
                        'h-10 w-full rounded-lg text-xs font-black uppercase tracking-[0.12em] transition',
                        video.id === selectedVideoId
                          ? 'bg-tactical-pitch text-white'
                          : 'bg-tactical-bone text-tactical-ink hover:bg-tactical-pitch/10 hover:text-tactical-pitch'
                      )}
                      onClick={() => {
                        playVideoFromTable(video);
                      }}
                    >
                      Abrir
                    </button>
                  </td>

                  {analysisColumns.map((column) => (
                    <td key={`${video.id}-${column.key}`} className="border-b border-r border-tactical-line/35 p-0 align-top">
                      <input
                        className="h-11 w-full bg-transparent px-3 text-sm font-semibold text-tactical-ink outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-tactical-pitch/25"
                        value={editableVideoValue(video, column.key)}
                        maxLength={240}
                        readOnly={!tableEditable}
                        onClick={(event) => {
                          if (tableEditable) {
                            event.stopPropagation();
                          }
                        }}
                        onFocus={() => {
                          if (tableEditable) {
                            setSelectedVideoId(video.id);
                          }
                        }}
                        onChange={(event) => updateVideoCell(video.id, column.key, event.target.value)}
                        onKeyDown={(event) => handleTableCellKeyDown(event, video.id)}
                      />
                    </td>
                  ))}

                  <td className="border-b border-tactical-line/35 px-2 py-2 align-top">
                    <button
                      type="button"
                      className="h-10 w-full rounded-lg bg-tactical-ink px-2 text-xs font-black uppercase tracking-[0.12em] text-white transition hover:bg-tactical-pitch disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!tableEditable || savingVideoId === video.id || isVideoProcessing(video)}
                      onClick={() => saveVideoRow(video.id)}
                    >
                      {isVideoProcessing(video) ? 'Editando' : savingVideoId === video.id ? 'Salvando' : 'Salvar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!playlistTableVideos.length ? (
            <div className="px-5 py-10 text-center text-sm font-black uppercase tracking-[0.16em] text-tactical-ash">
              Nenhum video nesta playlist.
            </div>
          ) : null}
        </div>
      </section>
    </section>
  );
}
