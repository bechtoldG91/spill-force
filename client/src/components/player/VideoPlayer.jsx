import { Icon } from '../Icons';
import { Timeline } from './Timeline';
import { formatPreciseTime } from './playerUtils';

const CONTROL_BUTTON_CLASS =
  'grid h-full w-12 place-items-center bg-transparent text-white transition hover:bg-white/12 focus:outline-none focus-visible:outline-none';

function EmptyPlayer({ children }) {
  if (children) {
    return children;
  }

  return (
    <div className="absolute inset-0 grid place-items-center bg-tactical-ink text-center text-white">
      <div>
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/10 text-tactical-pitch">
          <Icon name="film" className="h-7 w-7" />
        </div>
        <strong className="mt-4 block text-lg font-black uppercase tracking-[0.14em]">Selecione um video</strong>
      </div>
    </div>
  );
}

export function VideoPlayer({
  containerRef,
  videoRef,
  video,
  src,
  preload = 'metadata',
  className = 'relative aspect-video overflow-hidden rounded-md bg-black focus:outline-none',
  videoClassName = 'absolute inset-0 h-full w-full object-contain',
  currentTime = 0,
  duration = 0,
  playerDuration,
  isPaused = true,
  timelineBackground,
  timelineChildren,
  rightControls,
  previousButtonProps = {},
  nextButtonProps = {},
  onPrevious,
  onNext,
  onTogglePlayback,
  onSeek,
  onTimelinePointerUp,
  onLoadedMetadata,
  onTimeUpdate,
  onSeeked,
  onPlay,
  onPause,
  onEnded,
  children,
  emptyContent,
  showTimeDisplay = true
}) {
  const timelineValue = duration ? Math.round((currentTime / duration) * 1000) : 0;
  const displayedDuration = playerDuration ?? duration;
  const previousProps = {
    onClick: onPrevious,
    ...previousButtonProps
  };
  const nextProps = {
    onClick: onNext,
    ...nextButtonProps
  };

  return (
    <div ref={containerRef} tabIndex={-1} className={className}>
      {video ? (
        <>
          <video
            ref={videoRef}
            src={src}
            playsInline
            preload={preload}
            className={videoClassName}
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
            onSeeked={onSeeked}
            onPlay={onPlay}
            onPause={onPause}
            onEnded={onEnded}
          />

          {children}

          <div className="absolute inset-x-0 bottom-0 z-30 h-12 bg-black/86 shadow-2xl">
            <div className="flex h-full items-stretch">
              <button
                type="button"
                aria-label="Video anterior"
                title="Video anterior"
                className={CONTROL_BUTTON_CLASS}
                {...previousProps}
              >
                <Icon name="back" className="h-6 w-6" />
              </button>
              <button
                type="button"
                aria-label={isPaused ? 'Reproduzir' : 'Pausar'}
                title={isPaused ? 'Reproduzir' : 'Pausar'}
                className={CONTROL_BUTTON_CLASS}
                onClick={onTogglePlayback}
              >
                <Icon name={isPaused ? 'play' : 'pause'} className="h-6 w-6" />
              </button>
              <button
                type="button"
                aria-label="Proximo video"
                title="Proximo video"
                className={CONTROL_BUTTON_CLASS}
                {...nextProps}
              >
                <Icon name="forward" className="h-6 w-6" />
              </button>

              <div className="relative flex h-full min-w-[220px] flex-1 items-center px-4">
                <Timeline
                  value={timelineValue}
                  background={timelineBackground}
                  onChange={onSeek}
                  onPointerUp={onTimelinePointerUp}
                  onTogglePlayback={onTogglePlayback}
                >
                  {timelineChildren}
                </Timeline>
              </div>

              {rightControls}

              {showTimeDisplay ? (
                <div className="flex h-full shrink-0 items-center px-3 text-[0.68rem] font-black tabular-nums tracking-[0.12em] text-white/80">
                  {formatPreciseTime(currentTime)} / {formatPreciseTime(displayedDuration)}
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <EmptyPlayer>{emptyContent}</EmptyPlayer>
      )}
    </div>
  );
}
