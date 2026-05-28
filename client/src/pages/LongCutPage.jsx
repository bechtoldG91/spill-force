import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icons';
import { authFetch } from '../lib/auth';
import { formatDuration, isVideoProcessing, videoProcessingMessage } from '../lib/utils';

const HOLD_SHORTCUT_DELAY_MS = 220;
const FORWARD_HOLD_RATE = 2.5;
const SLOW_HOLD_RATE = 0.5;
const FAST_REVERSE_HOLD_RATE = 2;
const SLOW_REVERSE_HOLD_RATE = 0.5;
const REVERSE_STEP_MS = 16;
const REVERSE_FRAME_WAIT_MS = 90;
const REVERSE_SLOW_MIN_STEP_SECONDS = 0.08;
const REVERSE_FAST_MAX_STEP_SECONDS = 0.22;
const REVERSE_FAST_MIN_STEP_SECONDS = 0.12;
const REVERSE_SEEK_EPSILON_SECONDS = 0.004;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isTypingTarget(target) {
  const tagName = target?.tagName?.toLowerCase();
  if (tagName === 'input') {
    return target.type !== 'range';
  }

  return tagName === 'textarea' || tagName === 'select' || target?.isContentEditable;
}

function formatPreciseTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00.00';
  }

  const totalCentiseconds = Math.round(seconds * 100);
  const hours = Math.floor(totalCentiseconds / 360000);
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
  const remainingSeconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function createClipId() {
  return `clip-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

export function LongCutPage({ showToast }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryVideoId = searchParams.get('video');
  const videoRef = useRef(null);
  const arrowShortcutRef = useRef({
    key: null,
    timer: null,
    held: false,
    mode: null,
    wasPaused: true,
    previousRate: 1,
    reverseTimer: null,
    reverseBaseClock: 0,
    reverseBaseTime: 0,
    reverseDisplayedTime: 0,
    reverseFrameCallback: null,
    reverseSeekCleanup: null,
    reverseToken: 0
  });
  const [videos, setVideos] = useState([]);
  const [selectedVideoId, setSelectedVideoId] = useState(queryVideoId || '');
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPaused, setIsPaused] = useState(true);
  const [clipStartTime, setClipStartTime] = useState(0);
  const [plannedClips, setPlannedClips] = useState([]);
  const [activeClipId, setActiveClipId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const activeClipRef = useRef(null);

  const selectedVideo = useMemo(
    () => videos.find((video) => video.id === selectedVideoId) || videos.find((video) => video.id === queryVideoId) || videos[0] || null,
    [queryVideoId, selectedVideoId, videos]
  );

  const effectiveDuration = duration || selectedVideo?.duration || 0;
  const clipCards = useMemo(() => {
    const sortedClips = [...plannedClips].sort((left, right) => left.start - right.start);
    const cards = [];
    let previousEnd = 0;

    sortedClips.forEach((clip) => {
      if (clip.start - previousEnd > 0.05) {
        cards.push({
          id: `remaining-${previousEnd.toFixed(2)}-${clip.start.toFixed(2)}`,
          kind: 'remaining',
          start: previousEnd,
          end: clip.start,
          duration: clip.start - previousEnd
        });
      }

      cards.push({
        ...clip,
        kind: 'planned'
      });
      previousEnd = Math.max(previousEnd, clip.end);
    });

    if (effectiveDuration - previousEnd > 0.05) {
      cards.push({
        id: `remaining-${previousEnd.toFixed(2)}-${effectiveDuration.toFixed(2)}`,
        kind: 'remaining',
        start: previousEnd,
        end: effectiveDuration,
        duration: effectiveDuration - previousEnd
      });
    }

    return cards
      .sort((left, right) => left.start - right.start || left.end - right.end)
      .map((clip, index) => ({
        ...clip,
        cardIndex: index + 1
      }));
  }, [effectiveDuration, plannedClips]);
  const activeClip = clipCards.find((clip) => clip.id === activeClipId) || null;
  const displayStartTime = activeClip?.start ?? clipStartTime;
  const displayEndTime = activeClip?.end ?? effectiveDuration;
  const displayDuration = Math.max(0, displayEndTime - displayStartTime);
  const displayCurrentTime = clamp(currentTime - displayStartTime, 0, displayDuration || 0);
  const progressPercent = displayDuration ? Math.max(0, Math.min(100, (displayCurrentTime / displayDuration) * 100)) : 0;
  const timelineBackground = `linear-gradient(90deg, #3f8f29 0%, #3f8f29 ${progressPercent}%, #2f3a45 ${progressPercent}%, #2f3a45 100%)`;

  useEffect(() => {
    activeClipRef.current = activeClip;
  }, [activeClip]);

  useEffect(() => {
    let ignore = false;

    async function loadVideos() {
      try {
        const response = await authFetch('/api/videos');
        if (!response.ok) {
          throw new Error('Nao foi possivel carregar os videos.');
        }

        const payload = await response.json();
        if (ignore) {
          return;
        }

        const nextVideos = payload.videos || [];
        setVideos(nextVideos);
        setSelectedVideoId((current) => current || queryVideoId || nextVideos[0]?.id || '');
      } catch (error) {
        if (!ignore) {
          showToast(error.message);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadVideos();
    return () => {
      ignore = true;
    };
  }, [queryVideoId, showToast]);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setIsPaused(true);
    setClipStartTime(0);
    setPlannedClips([]);
    setActiveClipId('');
    setIsSaving(false);
  }, [selectedVideo?.id]);

  useEffect(() => {
    if (isPaused) {
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
  }, [isPaused, selectedVideo?.id]);

  useEffect(() => {
    function handleKeyDown(event) {
      const arrowKeys = new Set(['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']);

      if (isTypingTarget(event.target)) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        event.stopPropagation();
        togglePlayback();
        return;
      }

      if (arrowKeys.has(event.key)) {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
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
        return;
      }

      if (event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 's') {
        if (event.repeat) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        createPlannedClip();
      }
    }

    function handleKeyUp(event) {
      const state = arrowShortcutRef.current;
      if (!state.key || event.key !== state.key) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const key = state.key;
      const wasHeld = state.held;

      if (wasHeld) {
        restorePlaybackAfterArrowHold();
        return;
      }

      clearArrowTimer();
      state.key = null;
      state.mode = null;
      runArrowTapAction(key);
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });
    window.addEventListener('blur', restorePlaybackAfterArrowHold);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keyup', handleKeyUp, { capture: true });
      window.removeEventListener('blur', restorePlaybackAfterArrowHold);
    };
  });

  function clearArrowTimer() {
    const state = arrowShortcutRef.current;
    if (state.timer) {
      window.clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function stopArrowReverse() {
    const state = arrowShortcutRef.current;
    const video = videoRef.current;
    if (state.reverseTimer) {
      window.clearTimeout(state.reverseTimer);
      state.reverseTimer = null;
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

  function restorePlaybackAfterArrowHold() {
    const state = arrowShortcutRef.current;
    const video = videoRef.current;
    const hasActiveShortcut = state.key || state.timer || state.mode || state.reverseTimer;

    if (!hasActiveShortcut) {
      return;
    }

    clearArrowTimer();
    stopArrowReverse();

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
    if (!video || !selectedVideo) {
      return;
    }

    video.playbackRate = rate;
    video.play().catch(() => showToast('Nao foi possivel reproduzir.'));
  }

  function getPlaybackBounds() {
    const activePlaybackClip = activeClipRef.current;
    if (activePlaybackClip) {
      return {
        start: activePlaybackClip.start,
        end: activePlaybackClip.end
      };
    }

    return {
      start: clipStartTime,
      end: effectiveDuration || duration || Number.MAX_SAFE_INTEGER
    };
  }

  function playReverse(rate, maxStepSeconds, minStepSeconds) {
    const video = videoRef.current;
    const state = arrowShortcutRef.current;
    if (!video || !selectedVideo) {
      return;
    }

    stopArrowReverse();
    video.pause();
    state.reverseBaseClock = performance.now();
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

        const bounds = getPlaybackBounds();
        const actualTime = clamp(video.currentTime || targetTime, bounds.start, bounds.end);
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
      const bounds = getPlaybackBounds();
      const desiredTime = clamp(activeState.reverseBaseTime - elapsed * rate, bounds.start, bounds.end);
      const displayedTime = Number.isFinite(activeState.reverseDisplayedTime)
        ? activeState.reverseDisplayedTime
        : video.currentTime || 0;
      const distance = displayedTime - desiredTime;
      const seekDistance = clamp(Math.max(distance, minStepSeconds), 0, maxStepSeconds);
      const clampedTime = clamp(displayedTime - seekDistance, bounds.start, bounds.end);

      if (Math.abs((video.currentTime || 0) - clampedTime) > REVERSE_SEEK_EPSILON_SECONDS) {
        waitForRenderedSeek(clampedTime);
        return;
      }

      scheduleStep(REVERSE_STEP_MS);
    };

    scheduleStep(REVERSE_STEP_MS);
  }

  function startArrowHoldAction(key) {
    const state = arrowShortcutRef.current;
    const video = videoRef.current;
    if (state.key !== key || !video || !selectedVideo) {
      return;
    }

    state.held = true;
    state.mode = key === 'ArrowLeft' || key === 'ArrowUp' ? 'reverse' : 'rate';

    if (key === 'ArrowRight') {
      playWithTemporaryRate(FORWARD_HOLD_RATE);
      return;
    }

    if (key === 'ArrowDown') {
      playWithTemporaryRate(SLOW_HOLD_RATE);
      return;
    }

    if (key === 'ArrowUp') {
      playReverse(FAST_REVERSE_HOLD_RATE, REVERSE_FAST_MAX_STEP_SECONDS, REVERSE_FAST_MIN_STEP_SECONDS);
      return;
    }

    if (key === 'ArrowLeft') {
      playReverse(SLOW_REVERSE_HOLD_RATE, REVERSE_SLOW_MIN_STEP_SECONDS, REVERSE_SLOW_MIN_STEP_SECONDS);
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
      const bounds = getPlaybackBounds();
      video.currentTime = bounds.start;
      setCurrentTime(bounds.start);
      if (shouldResume) {
        video.play().catch(() => showToast('Nao foi possivel reproduzir.'));
      }
    }
  }

  function selectAdjacentVideo(direction) {
    if (!videos.length) {
      return;
    }

    const currentIndex = videos.findIndex((video) => video.id === selectedVideo?.id);
    const fallbackIndex = direction > 0 ? -1 : 0;
    const nextIndex = (currentIndex === -1 ? fallbackIndex : currentIndex) + direction;
    const normalizedIndex = (nextIndex + videos.length) % videos.length;
    setSelectedVideoId(videos[normalizedIndex].id);
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (video.paused) {
      const bounds = getPlaybackBounds();
      if (video.currentTime < bounds.start || video.currentTime >= bounds.end - 0.03) {
        video.currentTime = bounds.start;
        setCurrentTime(bounds.start);
      }
      video.play().catch(() => showToast('Nao foi possivel reproduzir.'));
      return;
    }

    video.pause();
  }

  function handleSeek(value) {
    const video = videoRef.current;
    if (!video || !displayDuration) {
      return;
    }

    const nextTime = clamp(displayStartTime + (Number(value) / 1000) * displayDuration, displayStartTime, displayEndTime);
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  function playClip(clip) {
    const video = videoRef.current;
    if (!video || !selectedVideo) {
      return;
    }

    clearArrowTimer();
    stopArrowReverse();
    video.playbackRate = 1;
    activeClipRef.current = clip;
    setActiveClipId(clip.id);
    video.currentTime = clip.start;
    setCurrentTime(clip.start);
    video.play().catch(() => showToast('Nao foi possivel reproduzir.'));
  }

  function createPlannedClip() {
    if (!selectedVideo) {
      return;
    }

    const video = videoRef.current;
    const endTime = clamp(video?.currentTime || currentTime, clipStartTime, duration || Number.MAX_SAFE_INTEGER);
    if (endTime <= clipStartTime + 0.5) {
      showToast('Avance o video antes de criar o clipe.');
      return;
    }

    const clip = {
      id: createClipId(),
      index: plannedClips.length + 1,
      start: clipStartTime,
      end: endTime,
      duration: endTime - clipStartTime
    };

    setPlannedClips((current) => [...current, clip]);
    setClipStartTime(endTime);
    activeClipRef.current = null;
    setActiveClipId('');
    setCurrentTime(endTime);
    if (video) {
      video.currentTime = endTime;
    }
    showToast('Clipe criado na fila de alteracoes.');
  }

  function deletePlannedClip(clipId) {
    const clipIndex = plannedClips.findIndex((clip) => clip.id === clipId);
    if (clipIndex === -1) {
      return;
    }

    const nextClips = plannedClips
      .filter((clip) => clip.id !== clipId)
      .sort((left, right) => left.start - right.start)
      .map((clip, index) => ({
        ...clip,
        index: index + 1
      }));
    const nextStartTime = nextClips.reduce((latestEnd, clip) => Math.max(latestEnd, clip.end), 0);
    const video = videoRef.current;

    setPlannedClips(nextClips);
    setClipStartTime(nextStartTime);
    activeClipRef.current = null;
    setActiveClipId('');
    setCurrentTime(nextStartTime);

    if (video) {
      video.pause();
      video.currentTime = nextStartTime;
    }

    showToast('Clipe removido da fila.');
  }

  function syncVideoTime(event) {
    const video = event.currentTarget;
    const nextTime = video.currentTime || 0;
    const playbackClip = activeClipRef.current;

    if (playbackClip && nextTime >= playbackClip.end - 0.03) {
      video.currentTime = playbackClip.end;
      video.pause();
      setCurrentTime(playbackClip.end);
      return;
    }

    setCurrentTime(nextTime);
  }

  async function saveLongCutChanges() {
    if (!selectedVideo || isSaving) {
      return;
    }

    if (isVideoProcessing(selectedVideo)) {
      showToast(videoProcessingMessage(selectedVideo));
      return;
    }

    if (!plannedClips.length) {
      showToast('Crie pelo menos um clipe antes de salvar.');
      return;
    }

    setIsSaving(true);
    try {
      const response = await authFetch(`/api/videos/${selectedVideo.id}/long-cut`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          duration: duration || selectedVideo.duration || 0,
          clips: plannedClips.map((clip) => ({
            start: clip.start,
            end: clip.end
          }))
        })
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel salvar o corte longo.');
      }

      const playlistId = payload.playlistId || selectedVideo.playlistId || '';
      showToast(response.status === 202 ? 'Corte longo iniciado. O video continua disponivel para assistir e anotar.' : 'Alteracoes salvas.');
      navigate(playlistId ? `/biblioteca?playlist=${encodeURIComponent(playlistId)}` : '/biblioteca');
    } catch (error) {
      showToast(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-[1280px] space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="tactical-panel overflow-hidden">
          <div className="relative aspect-video bg-black">
            {selectedVideo ? (
              <>
                <video
                  ref={videoRef}
                  src={selectedVideo.url}
                  playsInline
                  preload="metadata"
                  className="absolute inset-0 h-full w-full object-contain"
                  onLoadedMetadata={(event) => {
                    const nextDuration = Number.isFinite(event.currentTarget.duration)
                      ? event.currentTarget.duration
                      : selectedVideo.duration || 0;
                    setDuration(nextDuration);
                    setCurrentTime(event.currentTarget.currentTime || 0);
                    setIsPaused(event.currentTarget.paused);
                  }}
                  onTimeUpdate={syncVideoTime}
                  onSeeked={syncVideoTime}
                  onPlay={() => setIsPaused(false)}
                  onPause={(event) => {
                    setIsPaused(true);
                    syncVideoTime(event);
                  }}
                  onEnded={() => setIsPaused(true)}
                />

                <div className="absolute inset-x-0 bottom-0 z-20 h-12 bg-black/86 shadow-2xl">
                  <div className="flex h-full items-stretch">
                    <button
                      type="button"
                      aria-label={isPaused ? 'Reproduzir' : 'Pausar'}
                      title={isPaused ? 'Reproduzir' : 'Pausar'}
                      onClick={togglePlayback}
                      className="grid h-full w-14 place-items-center bg-transparent text-white transition hover:bg-white/12 focus:outline-none"
                    >
                      <Icon name={isPaused ? 'play' : 'pause'} className="h-6 w-6" />
                    </button>
                    <div className="relative flex h-full min-w-[180px] flex-1 items-center px-4">
                      <input
                        className="timeline-slider timeline-slider-progress block"
                        type="range"
                        min="0"
                        max="1000"
                        step="1"
                        value={displayDuration ? Math.round((displayCurrentTime / displayDuration) * 1000) : 0}
                        onChange={(event) => handleSeek(event.target.value)}
                        style={{ background: timelineBackground }}
                      />
                    </div>
                    <div className="flex h-full shrink-0 items-center px-3 text-[0.68rem] font-black tabular-nums tracking-[0.12em] text-white/80">
                      {formatPreciseTime(displayCurrentTime)} / {formatPreciseTime(displayDuration)}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="absolute inset-0 grid place-items-center bg-tactical-ink text-center text-white">
                <div>
                  <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/10 text-tactical-pitch">
                    <Icon name="film" className="h-7 w-7" />
                  </div>
                  <strong className="mt-4 block text-lg font-black uppercase tracking-[0.14em]">
                    {loading ? 'Carregando video' : 'Nenhum video selecionado'}
                  </strong>
                </div>
              </div>
            )}
          </div>

        </div>

        <aside className="space-y-5">
          <div className="tactical-panel px-5 py-5">
            {isVideoProcessing(selectedVideo) ? (
              <div className="mb-3 rounded-xl border border-tactical-pitch/25 bg-tactical-pitch/10 px-3 py-3 text-sm font-black text-tactical-ink">
                {videoProcessingMessage(selectedVideo)}
              </div>
            ) : null}
            <button type="button" className="tactical-button w-full" onClick={createPlannedClip} disabled={!selectedVideo || isVideoProcessing(selectedVideo)}>
              Criar clipe
            </button>
            <button
              type="button"
              className="tactical-button-secondary mt-3 w-full"
              onClick={saveLongCutChanges}
              disabled={!selectedVideo || isVideoProcessing(selectedVideo) || isSaving || plannedClips.length === 0}
            >
              {isSaving ? 'Salvando' : 'Salvar alteracoes'}
            </button>
          </div>

          <div className="tactical-panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-tactical-ink/10 px-5 py-3">
              <h2 className="text-sm font-black uppercase tracking-[0.14em] text-tactical-ink">Clipes</h2>
              <span className="grid h-8 min-w-8 place-items-center rounded-full bg-tactical-pitch/10 px-2 text-xs font-black text-tactical-pitch">
                {clipCards.length}
              </span>
            </div>

            <div className="grid max-h-[calc(100vh-21rem)] gap-3 overflow-y-auto px-5 py-5">
              {clipCards.length ? null : (
                <div className="rounded-2xl border border-dashed border-tactical-ink/12 px-4 py-10 text-center">
                  <strong className="block text-sm font-black uppercase tracking-[0.18em] text-tactical-ink">
                    Nenhum clipe criado
                  </strong>
                </div>
              )}

              {clipCards.map((clip) => {
                const isPlannedClip = clip.kind === 'planned';

                return (
                  <div
                    key={clip.id}
                    className={`grid grid-cols-[minmax(0,1fr)_44px] items-stretch gap-2 rounded-xl border p-3 shadow-sm transition ${
                      activeClipId === clip.id ? 'border-tactical-pitch bg-tactical-pitch/10' : 'border-tactical-ink/10 bg-white'
                    }`}
                  >
                    <button type="button" className="min-w-0 text-left" onClick={() => playClip(clip)}>
                      <span className="block text-[0.58rem] font-black uppercase tracking-[0.16em] text-tactical-ash">
                        Clipe {clip.cardIndex}
                      </span>
                      <strong className="mt-1 block truncate text-sm font-black tabular-nums text-tactical-ink">
                        {formatPreciseTime(clip.start)} - {formatPreciseTime(clip.end)}
                      </strong>
                      <span className="mt-1 block text-sm font-semibold text-tactical-ash">{formatDuration(clip.duration)}</span>
                    </button>

                    {isPlannedClip ? (
                      <button
                        type="button"
                        className="grid h-11 w-11 place-items-center self-center rounded-xl border border-red-300 bg-red-50 text-red-600 transition hover:border-red-500 hover:bg-red-100"
                        onClick={() => deletePlannedClip(clip.id)}
                        aria-label={`Excluir clipe ${clip.cardIndex}`}
                        title="Excluir clipe"
                      >
                        <Icon name="trash" className="h-4 w-4" />
                      </button>
                    ) : (
                      <span aria-hidden="true" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
