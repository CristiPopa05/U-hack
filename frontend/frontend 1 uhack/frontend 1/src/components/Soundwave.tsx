interface SoundwaveProps {
  className?: string;
}

export function Soundwave({ className = "" }: SoundwaveProps) {
  const bars = 48;
  return (
    <svg viewBox="0 0 480 120" className={className} aria-hidden>
      <defs>
        <linearGradient id="sw-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="hsl(0 0% 25%)" />
          <stop offset="50%" stopColor="hsl(0 0% 95%)" />
          <stop offset="100%" stopColor="hsl(0 0% 25%)" />
        </linearGradient>
      </defs>
      {Array.from({ length: bars }).map((_, i) => {
        const t = i / (bars - 1);
        const env = Math.sin(t * Math.PI);
        const wob = (Math.sin(i * 1.7) + Math.sin(i * 0.6) * 0.7) * 0.5 + 0.5;
        const h = 8 + env * 90 * (0.4 + wob * 0.6);
        const x = i * (480 / bars);
        return (
          <rect
            key={i}
            x={x + 2}
            y={60 - h / 2}
            width={(480 / bars) - 4}
            height={h}
            rx={2}
            fill="url(#sw-grad)"
            opacity={0.25 + env * 0.75}
          />
        );
      })}
    </svg>
  );
}
