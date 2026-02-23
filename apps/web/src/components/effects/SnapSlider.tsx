'use client';

import { useCallback } from 'react';

interface SnapSliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue: number;
  onChange: (value: number) => void;
  style?: React.CSSProperties;
  /**
   * Snap zone as a fraction of the total range.
   * Default: 0.04 (4% of range on each side of defaultValue triggers snap)
   */
  snapThreshold?: number;
}

/**
 * Range slider that magnetically snaps to the default value when dragged nearby.
 * Shows a small tick mark at the default position so users know where it is.
 */
export function SnapSlider({
  min,
  max,
  step,
  value,
  defaultValue,
  onChange,
  style,
  snapThreshold = 0.04,
}: SnapSliderProps) {
  const range = max - min;
  const threshold = range * snapThreshold;
  const isAtDefault = value === defaultValue;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = parseFloat(e.target.value);
      const snapped = Math.abs(raw - defaultValue) <= threshold ? defaultValue : raw;
      onChange(snapped);
    },
    [defaultValue, threshold, onChange],
  );

  // Percentage position of the default value along the track.
  // The browser renders thumb centers at 8px from each edge (for ~16px thumb),
  // so we apply a small correction to keep the tick visually aligned.
  const pct = ((defaultValue - min) / range) * 100;
  // Correction: thumb offset compensation (approximated for 16px thumb)
  const tickLeft = `calc(${pct}% + (50 - ${pct}) * 0.12px)`;

  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        ...style,
      }}
    >
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ width: '100%', margin: 0 }}
        onChange={handleChange}
      />
      {/* Tick mark showing default value position */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: -1,
          left: tickLeft,
          transform: 'translateX(-50%)',
          width: 2,
          height: 4,
          background: isAtDefault
            ? 'rgba(13,148,136,0.85)'
            : 'rgba(13,148,136,0.35)',
          borderRadius: 1,
          pointerEvents: 'none',
          transition: 'background 0.15s ease',
        }}
      />
    </div>
  );
}
