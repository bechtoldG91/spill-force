import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icons';
import { VideoPlayer } from '../components/player/VideoPlayer';
import { useWindowShortcuts } from '../components/player/useWindowShortcuts';
import {
  FAST_REVERSE_HOLD_RATE,
  FORWARD_HOLD_RATE,
  HOLD_SHORTCUT_DELAY_MS,
  REVERSE_FAST_MAX_STEP_SECONDS,
  REVERSE_FAST_MIN_STEP_SECONDS,
  REVERSE_FRAME_WAIT_MS,
  REVERSE_SEEK_EPSILON_SECONDS,
  REVERSE_SLOW_MIN_STEP_SECONDS,
  REVERSE_STEP_MS,
  SLOW_HOLD_RATE,
  SLOW_REVERSE_HOLD_RATE,
  clamp,
  isTypingTarget,
  timelineProgressBackground
} from '../components/player/playerUtils';
import { authFetch } from '../lib/auth';
import {
  cn,
  formatDuration,
  isVideoProcessing,
  isVideoProcessingByOtherUser,
  kindLabel,
  videoProcessingMessage
} from '../lib/utils';

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

export function LibraryPage({ showToast, authUser }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryVideoId = searchParams.get('video');
  const queryPlaylistId = searchParams.get('playlist');
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const arrowShortcutRef = useRef({
    key: null,
    timer: null,
    held: false,
    mode: null,
    wasPaused: true,
    previousRate: 1,
    reverseTimer: null,
    reverseLastTime: 0,
    reverseBaseClock: 0,
    reverseBaseTime: 0,
    reverseDisplayedTime: 0,
    reverseFrameCallback: null,
    reverseSeekCleanup: null,
    reverseToken: 0
  });
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
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPaused, setIsPaused] = useState(true);
  const [isTrimming, setIsTrimming] = useState(false);

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
  const selectedHasProcessing = selectedVisibleVideoIds.some((videoId) => isVideoProcessing(videos.find((video) => video.id === videoId)));
  const hasProcessingVideos = useMemo(() => videos.some(isVideoProcessing), [videos]);
  const availableMovePlaylists = useMemo(
    () => playlists.filter((playlist) => playlist.id !== selectedPlaylistId),
    [playlists, selectedPlaylistId]
  );
  const videoStartOffset = Math.max(0, Number(selectedVideo?.startOffset) || 0);
  const playerDuration = duration || Number(selectedVideo?.duration) || 0;
  const progressPercent = playerDuration ? clamp((currentTime / playerDuration) * 100, 0, 100) : 0;
  const currentCutPoint = clamp(currentTime, 0, playerDuration || 0);
  const remainingDuration = Math.max(0, playerDuration - currentCutPoint);
  const timelineBackground = timelineProgressBackground(progressPercent);

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
      const playlistByQuery = queryPlaylistId ? nextPlaylists.find((playlist) => playlist.id === queryPlaylistId) : null;
      const defaultPlaylist =
        byQuery?.playlistId || playlistByQuery?.id || nextPlaylists.find((playlist) => playlist.count > 0)?.id || nextPlaylists[0]?.id || null;
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
  }, [queryPlaylistId, queryVideoId, showToast]);

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

  useEffect(() => {
    const nextDuration = Number(selectedVideo?.duration) || 0;
    setCurrentTime(0);
    setDuration(nextDuration);
    setIsPaused(true);
  }, [selectedVideoId, selectedVideo]);

  useEffect(() => {
    if (isPaused || !selectedVideoId) {
      return undefined;
    }

    let frameId = 0;
    const syncPlaybackTime = () => {
      const video = videoRef.current;
      if (video) {
        setCurrentTime(toVisibleTime(video.currentTime || 0));
      }

      frameId = window.requestAnimationFrame(syncPlaybackTime);
    };

    frameId = window.requestAnimationFrame(syncPlaybackTime);
    return () => window.cancelAnimationFrame(frameId);
  }, [isPaused, selectedVideoId, selectedVideo?.startOffset, duration]);

  useEffect(() => {
    if (!hasProcessingVideos) {
      return undefined;
    }

    let ignore = false;
    async function refreshProcessingVideos() {
      try {
        const [videosResponse, playlistsResponse] = await Promise.all([authFetch('/api/videos'), authFetch('/api/playlists')]);
        if (!videosResponse.ok || !playlistsResponse.ok) {
          return;
        }

        const videosPayload = await videosResponse.json();
        const playlistsPayload = await playlistsResponse.json();
        if (ignore) {
          return;
        }

        const nextVideos = videosPayload.videos || [];
        setVideos(nextVideos);
        setPlaylists(playlistsPayload.playlists || []);
        setSelectedVideoId((current) => (nextVideos.some((video) => video.id === current) ? current : nextVideos[0]?.id || null));
        setSelectedVideoIds((current) => current.filter((videoId) => nextVideos.some((video) => video.id === videoId)));
      } catch {
        // A proxima rodada tenta novamente.
      }
    }

    const interval = window.setInterval(refreshProcessingVideos, 3000);
    return () => {
      ignore = true;
      window.clearInterval(interval);
    };
  }, [hasProcessingVideos]);

  useWindowShortcuts({
    onKeyDown: handleKeyboardShortcut,
    onKeyUp: handleKeyboardShortcutRelease,
    onBlur: restorePlaybackAfterArrowHold,
    dependencies: [selectedVideoId, selectedVideo?.duration, selectedVideo?.startOffset, selectedVideo?.processing?.id, duration, currentTime, isTrimming]
  });

  function getPlaybackBounds() {
    const visibleDuration = duration || Number(selectedVideo?.duration) || 0;
    const start = videoStartOffset;
    const end = visibleDuration ? start + visibleDuration : Number.MAX_SAFE_INTEGER;
    return { start, end, duration: visibleDuration };
  }

  function toVisibleTime(videoTime) {
    const bounds = getPlaybackBounds();
    return clamp((Number(videoTime) || 0) - bounds.start, 0, bounds.duration || Number.MAX_SAFE_INTEGER);
  }

  function toVideoTime(visibleTime) {
    const bounds = getPlaybackBounds();
    return bounds.start + clamp(Number(visibleTime) || 0, 0, bounds.duration || Number.MAX_SAFE_INTEGER);
  }

  function handleKeyboardShortcut(event) {
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

    const key = event.key.toLowerCase();

    if (event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && key === 'c') {
      if (event.repeat) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void handleTrimVideo();
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
      restorePlaybackAfterArrowHold();
      return;
    }

    clearArrowTimer();
    state.key = null;
    state.mode = null;
    runArrowTapAction(key);
  }

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
    if (!video || !selectedVideoId) {
      return;
    }

    video.playbackRate = rate;
    video.play().catch(() => showToast('Nao foi possivel reproduzir.'));
  }

  function playReverse(rate, maxStepSeconds, minStepSeconds) {
    const video = videoRef.current;
    const state = arrowShortcutRef.current;
    if (!video || !selectedVideoId) {
      return;
    }

    stopArrowReverse();
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

        const bounds = getPlaybackBounds();
        const actualTime = clamp(video.currentTime || targetTime, bounds.start, bounds.end);
        activeState.reverseDisplayedTime = actualTime;
        setCurrentTime(toVisibleTime(actualTime));
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
        : clamp(video.currentTime || bounds.start, bounds.start, bounds.end);
      const distance = displayedTime - desiredTime;
      const seekDistance = clamp(Math.max(distance, minStepSeconds), 0, maxStepSeconds);
      const nextTime = displayedTime - seekDistance;
      const clampedTime = clamp(nextTime, bounds.start, bounds.end);

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
      video.currentTime = getPlaybackBounds().start;
      setCurrentTime(0);
      if (shouldResume) {
        video.play().catch(() => showToast('Nao foi possivel reproduzir.'));
      }
    }
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video || !selectedVideo) {
      return;
    }

    if (video.paused) {
      const bounds = getPlaybackBounds();
      if (video.currentTime < bounds.start || video.currentTime >= bounds.end - 0.03) {
        video.currentTime = bounds.start;
        setCurrentTime(0);
      }
      video.play().catch(() => showToast('Nao foi possivel reproduzir.'));
      return;
    }

    video.pause();
  }

  function selectAdjacentVideo(direction) {
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
  }

  function handleSeek(value) {
    const video = videoRef.current;
    if (!video || !playerDuration) {
      return;
    }

    const nextTime = (Number(value) / 1000) * playerDuration;
    video.currentTime = toVideoTime(nextTime);
    setCurrentTime(nextTime);
    playerRef.current?.focus({ preventScroll: true });
  }

  function handlePlayerTimeUpdate(event) {
    setCurrentTime(toVisibleTime(event.currentTarget.currentTime || 0));
  }

  function openLongCutPage() {
    if (!selectedVideo) {
      return;
    }

    if (isVideoProcessing(selectedVideo)) {
      showToast(videoProcessingMessage(selectedVideo, authUser));
      return;
    }

    navigate(`/corte-longo?video=${selectedVideo.id}`);
  }

  async function handleTrimVideo() {
    if (!selectedVideo || isTrimming) {
      return;
    }

    if (isVideoProcessing(selectedVideo)) {
      showToast(videoProcessingMessage(selectedVideo, authUser));
      return;
    }

    const cutStart = clamp(toVisibleTime(videoRef.current?.currentTime ?? toVideoTime(currentTime)), 0, playerDuration || duration || 0);
    const cutEnd = playerDuration || duration || Number(selectedVideo.duration) || 0;

    if (!cutEnd || cutStart < 0.5 || cutEnd - cutStart < 0.5) {
      showToast('Avance o video para escolher onde o novo inicio vai ficar.');
      return;
    }

    setIsTrimming(true);
    videoRef.current?.pause();

    try {
      const response = await authFetch(`/api/videos/${selectedVideo.id}/trim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          teamId: selectedVideo.teamId || '',
          start: cutStart,
          end: cutEnd,
          duration: cutEnd
        })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel cortar o inicio do video.');
      }

      if (response.status === 202) {
        if (payload.video) {
          setVideos((current) => current.map((video) => (video.id === payload.video.id ? payload.video : video)));
        }
        setIsPaused(true);
        showToast('Corte iniciado. O video continua disponivel para assistir e anotar.');
        return;
      }

      const nextVideo = payload.video;
      setVideos((current) => current.map((video) => (video.id === nextVideo.id ? nextVideo : video)));
      setCurrentTime(0);
      setDuration(Number(nextVideo.duration) || cutEnd - cutStart);
      if (videoRef.current) {
        videoRef.current.currentTime = Number(nextVideo.startOffset) || 0;
      }
      setIsPaused(true);
      showToast('Inicio do video cortado.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setIsTrimming(false);
    }
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

    const lockedVideo = videos.find((video) => video.playlistId === playlist.id && isVideoProcessing(video));
    if (lockedVideo) {
      showToast(videoProcessingMessage(lockedVideo, authUser));
      return;
    }

    const confirmed = window.confirm(`Excluir a playlist "${playlist.name}" e todos os videos dentro dela?`);
    if (!confirmed) {
      return;
    }

    setIsDeletingPlaylist(true);

    try {
      const response = await authFetch(`/api/playlists/${encodeURIComponent(playlist.id)}`, {
        method: 'DELETE'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel excluir a playlist.');
      }

      const [videosResponse, playlistsResponse] = await Promise.all([authFetch('/api/videos'), authFetch('/api/playlists')]);
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

    const lockedVideo = videos.find((video) => selectedVisibleVideoIds.includes(video.id) && isVideoProcessing(video));
    if (lockedVideo) {
      showToast(videoProcessingMessage(lockedVideo, authUser));
      return;
    }

    setIsDeletingSelectedVideos(true);

    try {
      const deletedIds = [];

      for (const videoId of selectedVisibleVideoIds) {
        const response = await authFetch(`/api/videos/${videoId}`, {
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

    const lockedVideo = videos.find((video) => selectedVisibleVideoIds.includes(video.id) && isVideoProcessing(video));
    if (lockedVideo) {
      showToast(videoProcessingMessage(lockedVideo, authUser));
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
        const response = await authFetch(`/api/videos/${videoId}`, {
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
      <aside className="tactical-dark-panel flex min-h-[calc(100vh-8.5rem)] min-w-0 flex-col gap-5 overflow-hidden px-4 py-4">
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
                    disabled={!selectedVisibleVideoIds.length || selectedHasProcessing || !bulkPlaylistTargetId || isDeletingSelectedVideos || isMovingSelectedVideos}
                    className="inline-flex h-9 min-w-0 items-center justify-center rounded-xl border border-tactical-pitch/20 bg-tactical-pitch/10 px-3 text-[0.62rem] font-black uppercase tracking-[0.16em] text-tactical-pitch transition hover:bg-tactical-pitch hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isMovingSelectedVideos ? 'Movendo' : 'Mover'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteSelectedVideos}
                    disabled={!selectedVisibleVideoIds.length || selectedHasProcessing || isDeletingSelectedVideos || isMovingSelectedVideos}
                    className="inline-flex h-9 min-w-0 items-center justify-center rounded-xl border border-tactical-pitch/20 bg-tactical-pitch/10 px-3 text-[0.62rem] font-black uppercase tracking-[0.16em] text-tactical-pitch transition hover:border-red-400 hover:bg-red-500/12 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isDeletingSelectedVideos ? 'Excluindo' : 'Excluir'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleDeleteSelectedVideos}
                  disabled={!selectedVisibleVideoIds.length || selectedHasProcessing || isDeletingSelectedVideos || isMovingSelectedVideos}
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
              const playlistHasProcessing = playlistVideos.some(isVideoProcessing);
              const isExpanded = expandedPlaylistIds.includes(playlist.id);
              const isActivePlaylist = playlist.id === selectedPlaylistId;

              return (
                <div key={playlist.id} className="w-full max-w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
                  <div className="flex min-w-0 items-center gap-2">
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
                      onClick={() => {
                        setSelectedPlaylistId(playlist.id);
                        togglePlaylistExpanded(playlist.id);
                      }}
                      className={cn(
                        'flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left transition',
                        isActivePlaylist ? 'bg-white/10 text-white' : 'text-white/80 hover:bg-white/8 hover:text-white'
                      )}
                    >
                      <span className="min-w-0 truncate text-[0.75rem] font-black uppercase tracking-[0.12em]">
                        {playlist.name}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-1 text-[0.58rem] font-black uppercase tracking-[0.12em]',
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
                      disabled={playlistHasProcessing || isDeletingPlaylist || isDeletingSelectedVideos || isMovingSelectedVideos}
                      className="group inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/70 transition hover:border-red-400 hover:bg-red-500/12 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Icon name="trash" className="h-4 w-4 transition-colors group-hover:text-red-400" />
                    </button>
                  </div>

                  {isExpanded ? (
                    <div className="ml-2 mt-2.5 min-w-0 border-l border-white/10 pl-2">
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
                              <div key={video.id} className="flex min-w-0 items-start gap-2">
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
                                    'min-w-0 flex-1 overflow-hidden rounded-xl px-2 py-1.5 text-left transition',
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
            <VideoPlayer
              containerRef={playerRef}
              videoRef={videoRef}
              video={selectedVideo}
              src={selectedVideo?.url}
              currentTime={currentTime}
              duration={duration}
              playerDuration={playerDuration}
              isPaused={isPaused}
              timelineBackground={timelineBackground}
              onLoadedMetadata={(event) => {
                const mediaDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
                const metadataDuration = Number(selectedVideo.duration) || 0;
                const nextDuration = videoStartOffset
                  ? Math.max(0, Math.min(metadataDuration || mediaDuration - videoStartOffset, mediaDuration - videoStartOffset))
                  : mediaDuration || metadataDuration;
                if (event.currentTarget.currentTime < videoStartOffset) {
                  event.currentTarget.currentTime = videoStartOffset;
                }
                setDuration(nextDuration);
                setCurrentTime(toVisibleTime(event.currentTarget.currentTime || videoStartOffset));
                setIsPaused(event.currentTarget.paused);
              }}
              onTimeUpdate={handlePlayerTimeUpdate}
              onSeeked={(event) => setCurrentTime(toVisibleTime(event.currentTarget.currentTime || 0))}
              onPlay={() => setIsPaused(false)}
              onPause={(event) => {
                setIsPaused(true);
                setCurrentTime(toVisibleTime(event.currentTarget.currentTime || 0));
              }}
              onEnded={() => setIsPaused(true)}
              onPrevious={() => selectAdjacentVideo(-1)}
              onNext={() => selectAdjacentVideo(1)}
              onTogglePlayback={togglePlayback}
              onSeek={handleSeek}
              onTimelinePointerUp={() => playerRef.current?.focus({ preventScroll: true })}
              emptyContent={
                <div className="absolute inset-0 grid place-items-center bg-tactical-ink text-center text-white">
                  <div>
                    <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/10 text-tactical-pitch">
                      <span className="material-symbols-outlined text-[2rem] leading-none">video_library</span>
                    </div>
                    <strong className="mt-4 block text-lg font-black uppercase tracking-[0.14em]">Selecione um video</strong>
                  </div>
                </div>
              }
            />

            {selectedVideo ? (
              <>
                {isVideoProcessingByOtherUser(selectedVideo, authUser) ? (
                  <div className="rounded-2xl border border-tactical-pitch/25 bg-tactical-pitch/10 px-4 py-3 text-sm font-black text-tactical-ink">
                    {videoProcessingMessage(selectedVideo, authUser)} Voce ainda pode assistir e fazer anotacoes.
                  </div>
                ) : null}

                <div className="rounded-2xl border border-tactical-line/35 bg-tactical-bone/50 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="grid gap-1">
                      <span className="text-center text-[0.52rem] font-black uppercase tracking-[0.14em] text-tactical-ash">Shift+C</span>
                      <button
                        type="button"
                        className="tactical-button min-h-10 px-4"
                        onClick={handleTrimVideo}
                        disabled={isTrimming || isVideoProcessing(selectedVideo) || currentCutPoint < 0.5 || remainingDuration < 0.5}
                      >
                        {isTrimming ? 'Cortando' : 'Cortar inicio'}
                      </button>
                    </div>
                    <div className="grid gap-1">
                      <span className="text-center text-[0.52rem] font-black uppercase tracking-[0.14em] text-tactical-ash">Jogo inteiro</span>
                      <button
                        type="button"
                        className="inline-flex min-h-10 items-center justify-center rounded-xl border border-tactical-ember/25 bg-tactical-ember/10 px-3 text-sm font-black uppercase tracking-[0.18em] text-tactical-ink transition hover:border-tactical-ember hover:bg-tactical-ember hover:text-white"
                        onClick={openLongCutPage}
                        disabled={isVideoProcessing(selectedVideo)}
                      >
                        Corte longo
                      </button>
                    </div>
                  </div>
                </div>

              </>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
