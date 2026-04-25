const cfrCrest = "/crests/cfr.svg";
const rapidCrest = "/crests/rapid.png";
const craiovaCrest = "/crests/craiova.svg";
const argesCrest = "/crests/arges.svg";
const dinamoCrest = "/crests/dinamo.png";
const uClujCrest = "/crests/ucluj.png";

interface TeamCrestProps {
  short: string;
  teamId?: string;
  teamName?: string;
  className?: string;
  size?: number;
}

// Real crest assets (served from /public/crests)
const REAL_CRESTS: Record<string, string> = {
  cfr: cfrCrest,
  rapid: rapidCrest,
  craiova: craiovaCrest,
  arges: argesCrest,
  "fc arges": argesCrest,
  "fc argeș": argesCrest,
  dinamo: dinamoCrest,
  "u craiova": craiovaCrest,
  "universitatea craiova": craiovaCrest,
  "cfr cluj": cfrCrest,
  "rapid bucurești": rapidCrest,
  "rapid bucuresti": rapidCrest,
  "dinamo bucurești": dinamoCrest,
  "dinamo bucuresti": dinamoCrest,
  ucluj: uClujCrest,
  "u cluj": uClujCrest,
  "u-cluj": uClujCrest,
  "universitatea cluj": uClujCrest,
  "fc universitatea cluj": uClujCrest,
};

function resolveCrest(teamId?: string, teamName?: string, short?: string): string | null {
  const keys = [teamId, teamName, short]
    .filter(Boolean)
    .map((s) => s!.toLowerCase().trim());
  for (const k of keys) {
    if (REAL_CRESTS[k]) return REAL_CRESTS[k];
  }
  return null;
}

// Abstract grayscale crest — geometric shield with team initials, or real crest when available
export function TeamCrest({ short, teamId, teamName, className = "", size = 56 }: TeamCrestProps) {
  const real = resolveCrest(teamId, teamName, short);

  if (real) {
    return (
      <img
        src={real}
        alt={`${teamName ?? short} crest`}
        width={size}
        height={size}
        className={`object-contain ${className}`}
        style={{ width: size, height: size }}
        loading="lazy"
      />
    );
  }

  // deterministic accent angle from short
  const seed = short.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const angle = (seed * 37) % 360;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={`g-${short}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(0 0% 22%)" />
          <stop offset="100%" stopColor="hsl(0 0% 9%)" />
        </linearGradient>
        <linearGradient id={`s-${short}`} x1="0" y1="0" x2="1" y2="1" gradientTransform={`rotate(${angle} 0.5 0.5)`}>
          <stop offset="0%" stopColor="hsl(0 0% 95%)" />
          <stop offset="100%" stopColor="hsl(0 0% 55%)" />
        </linearGradient>
      </defs>
      <path
        d="M32 2 L60 10 V32 C60 48 46 58 32 62 C18 58 4 48 4 32 V10 Z"
        fill={`url(#g-${short})`}
        stroke="hsl(0 0% 30%)"
        strokeWidth={1.2}
      />
      <path
        d="M32 8 L54 14 V30 C54 42 44 50 32 54 C20 50 10 42 10 30 V14 Z"
        fill="hsl(0 0% 6%)"
        opacity={0.6}
      />
      <text
        x="32"
        y="38"
        textAnchor="middle"
        fill={`url(#s-${short})`}
        fontFamily="Space Grotesk, Inter, sans-serif"
        fontWeight={800}
        fontSize={short.length > 3 ? 13 : 17}
        letterSpacing={short.length > 3 ? 0 : 1}
      >
        {short}
      </text>
    </svg>
  );
}
