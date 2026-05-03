export function Timeline({
  value,
  max = 1000,
  step = 1,
  background,
  onChange,
  onPointerUp,
  onTogglePlayback,
  children,
  className = 'timeline-slider timeline-slider-progress block',
  wrapperClassName = 'relative w-full'
}) {
  return (
    <div className={wrapperClassName}>
      {children}
      <input
        className={className}
        type="range"
        min="0"
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange?.(event.target.value, event)}
        onPointerUp={onPointerUp}
        onKeyDown={(event) => {
          if (event.code === 'Space' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            onTogglePlayback?.();
          }
        }}
        style={{ background }}
      />
    </div>
  );
}
