export const HOLD_SHORTCUT_DELAY_MS = 220;
export const FORWARD_HOLD_RATE = 2.5;
export const SLOW_HOLD_RATE = 0.5;
export const FAST_REVERSE_HOLD_RATE = 2;
export const SLOW_REVERSE_HOLD_RATE = 0.5;
export const REVERSE_STEP_MS = 16;
export const REVERSE_FRAME_WAIT_MS = 90;
export const REVERSE_SLOW_MIN_STEP_SECONDS = 0.08;
export const REVERSE_FAST_MAX_STEP_SECONDS = 0.22;
export const REVERSE_FAST_MIN_STEP_SECONDS = 0.12;
export const REVERSE_SEEK_EPSILON_SECONDS = 0.004;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function isTypingTarget(target, { includeRangeInput = false } = {}) {
  const tagName = target?.tagName?.toLowerCase();
  if (tagName === 'input') {
    return includeRangeInput || target.type !== 'range';
  }

  return tagName === 'textarea' || tagName === 'select' || target?.isContentEditable;
}

export function formatPreciseTime(seconds) {
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

export function timelineProgressBackground(progressPercent) {
  return `linear-gradient(90deg, #3f8f29 0%, #3f8f29 ${progressPercent}%, #2f3a45 ${progressPercent}%, #2f3a45 100%)`;
}
