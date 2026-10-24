import { useId, type ReactNode } from "react";
import { teamById } from "../shared/teams";

const FONT = "Inter Variable, system-ui, sans-serif";

// ---------------------------------------------------------------------------
// Team animals: flat vector faces on a team-coloured tile. They look the same
// in light and dark mode, and replace the system emoji.
// ---------------------------------------------------------------------------

function Cow() {
  return (
    <g>
      <ellipse cx="11" cy="24" rx="9" ry="5.5" transform="rotate(-25 11 24)" fill="#fbf8f2" />
      <ellipse cx="11" cy="24" rx="5.5" ry="3" transform="rotate(-25 11 24)" fill="#f6b6bd" />
      <ellipse cx="53" cy="24" rx="9" ry="5.5" transform="rotate(25 53 24)" fill="#fbf8f2" />
      <ellipse cx="53" cy="24" rx="5.5" ry="3" transform="rotate(25 53 24)" fill="#f6b6bd" />
      <path d="M23 15Q20 6 26 8M41 15Q44 6 38 8" fill="none" stroke="#f3dca3" strokeWidth="3.5" strokeLinecap="round" />
      <ellipse cx="32" cy="31" rx="17" ry="19" fill="#fbf8f2" />
      <ellipse cx="23.5" cy="20" rx="7" ry="6" transform="rotate(-20 23.5 20)" fill="#2b2b2f" />
      <circle cx="25" cy="29" r="2.6" fill="#1c1c20" />
      <circle cx="40" cy="28" r="2.6" fill="#1c1c20" />
      <ellipse cx="32" cy="45" rx="12.5" ry="8.5" fill="#f6b6bd" />
      <ellipse cx="27.5" cy="45" rx="2" ry="2.8" fill="#b4566b" />
      <ellipse cx="36.5" cy="45" rx="2" ry="2.8" fill="#b4566b" />
    </g>
  );
}

function Chicken() {
  return (
    <g>
      <circle cx="26.5" cy="14" r="5" fill="#e5322d" />
      <circle cx="32" cy="11" r="5.8" fill="#e5322d" />
      <circle cx="37.5" cy="14" r="5" fill="#e5322d" />
      <circle cx="32" cy="34" r="19" fill="#fffdf8" />
      <circle cx="20.5" cy="39" r="3.2" fill="#ffc2c2" opacity=".9" />
      <circle cx="43.5" cy="39" r="3.2" fill="#ffc2c2" opacity=".9" />
      <circle cx="24" cy="30" r="2.6" fill="#1c1c20" />
      <circle cx="40" cy="30" r="2.6" fill="#1c1c20" />
      <ellipse cx="32" cy="49" rx="3.2" ry="4.5" fill="#e5322d" />
      <path d="M27 36.5L37 36.5L32 45.5Z" fill="#ff9f1c" strokeLinejoin="round" />
    </g>
  );
}

function Goat() {
  return (
    <g>
      <path d="M24 18Q16 3 10 9M40 18Q48 3 54 9" fill="none" stroke="#e8d8ae" strokeWidth="4" strokeLinecap="round" />
      <ellipse cx="10" cy="29" rx="9" ry="4.5" transform="rotate(20 10 29)" fill="#f4eee2" />
      <ellipse cx="54" cy="29" rx="9" ry="4.5" transform="rotate(-20 54 29)" fill="#f4eee2" />
      <path d="M32 58L27 44L37 44Z" fill="#efe7d6" />
      <path d="M16 28Q16 13 32 13Q48 13 48 28Q48 40 41 47L23 47Q16 40 16 28Z" fill="#faf5ea" />
      <circle cx="25" cy="29" r="2.6" fill="#1c1c20" />
      <circle cx="39" cy="29" r="2.6" fill="#1c1c20" />
      <ellipse cx="32" cy="42" rx="9" ry="5.5" fill="#eadfcb" />
      <circle cx="29" cy="42" r="1.3" fill="#7a6a58" />
      <circle cx="35" cy="42" r="1.3" fill="#7a6a58" />
    </g>
  );
}

function Pig() {
  return (
    <g>
      <path d="M14 20L25 11L26 26Z" fill="#ff9bc2" strokeLinejoin="round" />
      <path d="M50 20L39 11L38 26Z" fill="#ff9bc2" strokeLinejoin="round" />
      <circle cx="32" cy="34" r="19" fill="#ffd3e4" />
      <ellipse cx="32" cy="41" rx="10.5" ry="8" fill="#ff9fc4" />
      <ellipse cx="28" cy="41" rx="1.9" ry="2.8" fill="#b8335f" />
      <ellipse cx="36" cy="41" rx="1.9" ry="2.8" fill="#b8335f" />
      <circle cx="23.5" cy="30" r="2.6" fill="#1c1c20" />
      <circle cx="40.5" cy="30" r="2.6" fill="#1c1c20" />
    </g>
  );
}

export function TeamIcon({ teamId, size = 32, sticker = false, className = "" }: { teamId: number | null | undefined; size?: number; sticker?: boolean; className?: string }) {
  const t = teamById(teamId);
  const uid = useId().replace(/:/g, "");
  const color = t?.color ?? "#6b7280";
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      role="img"
      aria-label={t ? `Team ${t.name}` : "No team"}
      style={sticker ? { filter: "drop-shadow(0 4px 8px rgba(0,0,0,.28))" } : undefined}
    >
      <defs>
        <radialGradient id={`t${uid}`} cx="28%" cy="18%" r="95%">
          <stop offset="0" stopColor="#fff" stopOpacity=".3" />
          <stop offset="1" stopColor="#000" stopOpacity=".14" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={color} />
      <rect width="64" height="64" rx="16" fill={`url(#t${uid})`} />
      {t?.id === 1 && <Cow />}
      {t?.id === 2 && <Chicken />}
      {t?.id === 3 && <Goat />}
      {t?.id === 4 && <Pig />}
      {sticker && <rect x="1.5" y="1.5" width="61" height="61" rx="14.5" fill="none" stroke="#fff" strokeWidth="3" />}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Game artwork: colourful flat illustrations, like thumbnails on a games site.
// Drawn on a 320 x 200 canvas and scaled to fit, so they work at any size.
// ---------------------------------------------------------------------------

function Bg({ id, a, b, children }: { id: string; a: string; b: string; children: ReactNode }) {
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      <rect width="320" height="200" fill={`url(#${id})`} />
      <circle cx="30" cy="185" r="75" fill="#fff" opacity=".07" />
      <circle cx="300" cy="20" r="65" fill="#fff" opacity=".07" />
      {children}
    </>
  );
}

function Sparkle({ x, y, s = 10, fill = "#fff", opacity = 1 }: { x: number; y: number; s?: number; fill?: string; opacity?: number }) {
  return <path d={`M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z`} fill={fill} opacity={opacity} />;
}

function Note({ x, y, s = 1, fill = "#fff", opacity = 1 }: { x: number; y: number; s?: number; fill?: string; opacity?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={opacity}>
      <ellipse cx="0" cy="0" rx="8" ry="6" transform="rotate(-20)" fill={fill} />
      <path d="M6.5 -2V-32Q16 -27 16 -16" fill="none" stroke={fill} strokeWidth="3.5" strokeLinecap="round" />
    </g>
  );
}

type ArtProps = { id: string };

function MemeArt({ id }: ArtProps) {
  return (
    <Bg id={id} a="#7c3aed" b="#ec4899">
      <circle cx="120" cy="108" r="62" fill="#ffd23f" />
      <circle cx="120" cy="108" r="62" fill="none" stroke="#fff" strokeWidth="5" />
      <ellipse cx="100" cy="92" rx="7" ry="11" fill="#3a2a00" />
      <ellipse cx="140" cy="92" rx="7" ry="11" fill="#3a2a00" />
      <path d="M92 72Q101 62 111 69M129 69Q139 62 148 72" stroke="#3a2a00" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M88 122Q120 170 152 122Z" fill="#7f1d1d" />
      <path d="M103 148Q120 138 137 148Q120 162 103 148Z" fill="#ff6b81" />
      <rect x="190" y="30" width="104" height="62" rx="20" fill="#fff" />
      <path d="M204 90L194 114L226 92Z" fill="#fff" />
      <text x="242" y="72" textAnchor="middle" fontSize="30" fontWeight="900" fill="#7c3aed" fontFamily={FONT}>
        LOL
      </text>
      <rect x="222" y="124" width="72" height="42" rx="15" fill="#fff" opacity=".92" />
      <text x="258" y="154" textAnchor="middle" fontSize="24" fontWeight="900" fill="#ec4899" fontFamily={FONT}>
        ?!
      </text>
      <Sparkle x={52} y={44} s={12} fill="#ffe66d" />
      <Sparkle x={290} y={150} s={9} />
      <Sparkle x={178} y={182} s={8} fill="#ffe66d" />
    </Bg>
  );
}

function GreenRedArt({ id }: ArtProps) {
  return (
    <Bg id={id} a="#16a34a" b="#dc2626">
      <circle cx="96" cy="64" r="13" fill="#fff" />
      <g stroke="#fff" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M96 82L88 126" />
        <path d="M94 94L118 106M94 94L70 108" />
        <path d="M88 126L112 150L106 176M88 126L66 150L46 148" />
      </g>
      <path d="M20 120H60M10 140H44M26 160H56" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity=".5" />
      <rect x="222" y="170" width="16" height="22" fill="#111827" />
      <rect x="190" y="20" width="80" height="152" rx="22" fill="#111827" />
      <circle cx="230" cy="52" r="19" fill="#7f1d1d" />
      <circle cx="230" cy="96" r="19" fill="#78350f" />
      <circle cx="230" cy="140" r="30" fill="#4ade80" opacity=".3" />
      <circle cx="230" cy="140" r="19" fill="#4ade80" />
      <circle cx="224" cy="134" r="6" fill="#fff" opacity=".6" />
      <Sparkle x={160} y={36} s={9} />
      <Sparkle x={290} y={120} s={7} />
    </Bg>
  );
}

function SharkArt({ id }: ArtProps) {
  return (
    <Bg id={id} a="#0ea5e9" b="#1e3a8a">
      <path d="M110 150Q122 80 176 38Q166 100 224 150Z" fill="#cbd5e1" />
      <path d="M176 38Q166 100 224 150L190 150Q176 100 176 38Z" fill="#94a3b8" />
      <circle cx="150" cy="104" r="4.5" fill="#0f172a" />
      <path d="M0 146Q40 132 80 146T160 146T240 146T320 146V200H0Z" fill="#0b3a75" opacity=".85" />
      <path d="M0 166Q40 152 80 166T160 166T240 166T320 166V200H0Z" fill="#082f5f" opacity=".9" />
      <circle cx="58" cy="148" r="24" fill="#ef4444" />
      <path d="M58 126L52 133L60 133L58 126ZM50 128Q58 120 66 128Q58 124 50 128Z" fill="#22c55e" />
      <circle cx="50" cy="142" r="6" fill="#fff" opacity=".35" />
      <g transform="rotate(35 264 130)">
        <path d="M240 130Q262 112 292 130Q262 148 240 130Z" fill="#f97316" />
        <path d="M240 130L226 118M240 130L224 136M240 130L228 146" stroke="#22c55e" strokeWidth="5" strokeLinecap="round" />
      </g>
      <circle cx="262" cy="52" r="26" fill="#fbbf24" />
      <circle cx="262" cy="52" r="20" fill="none" stroke="#f59e0b" strokeWidth="3" />
      <text x="262" y="62" textAnchor="middle" fontSize="28" fontWeight="900" fill="#b45309" fontFamily={FONT}>
        $
      </text>
      <Sparkle x={46} y={48} s={10} />
      <Sparkle x={300} y={104} s={7} />
    </Bg>
  );
}

function ActArt({ id }: ArtProps) {
  return (
    <Bg id={id} a="#f97316" b="#be123c">
      <path d="M30 0L90 0L150 130L70 130Z" fill="#fff" opacity=".1" />
      <path d="M290 0L230 0L170 130L250 130Z" fill="#fff" opacity=".1" />
      <rect x="82" y="92" width="156" height="86" rx="10" fill="#1f2937" />
      <path d="M96 118H224M96 138H190M96 158H210" stroke="#fff" strokeWidth="5" strokeLinecap="round" opacity=".35" />
      <g transform="rotate(-14 82 90)">
        <rect x="82" y="58" width="156" height="32" rx="7" fill="#111827" />
        <path d="M100 58L128 58L108 90L80 90ZM140 58L168 58L148 90L120 90ZM180 58L208 58L188 90L160 90ZM220 58L238 58L238 70L228 90L200 90Z" fill="#fff" />
      </g>
      <rect x="82" y="86" width="156" height="12" rx="4" fill="#0b1220" />
      <path d="M96 98L96 94M110 98L110 94" stroke="#fff" strokeWidth="2" opacity=".4" />
      <Sparkle x={48} y={150} s={13} fill="#fde047" />
      <Sparkle x={272} y={44} s={11} fill="#fde047" />
      <Sparkle x={290} y={140} s={7} />
    </Bg>
  );
}

function CupArt({ id }: ArtProps) {
  return (
    <Bg id={id} a="#06b6d4" b="#2563eb">
      <g stroke="#fff" strokeWidth="6" strokeLinecap="round" opacity=".95">
        <path d="M58 78V172M90 78V172M28 108H120M28 140H120" />
      </g>
      <path d="M36 86L52 102M52 86L36 102" stroke="#fde047" strokeWidth="7" strokeLinecap="round" />
      <circle cx="74" cy="124" r="10" fill="none" stroke="#fb7185" strokeWidth="6" />
      <path d="M100 150L114 164M114 150L100 164" stroke="#fde047" strokeWidth="7" strokeLinecap="round" />
      <g transform="rotate(26 220 100)">
        <ellipse cx="220" cy="62" rx="42" ry="9" fill="#e2e8f0" />
        <path d="M178 62L196 168Q220 178 244 168L262 62Z" fill="#fff" />
        <path d="M184 96L257 96L254 120L187 120Z" fill="#ef4444" />
        <ellipse cx="220" cy="62" rx="42" ry="9" fill="none" stroke="#cbd5e1" strokeWidth="2" />
      </g>
      <path d="M262 36Q292 60 282 98" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 11" />
      <path d="M284 92L282 106L270 98" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <Sparkle x={150} y={40} s={10} fill="#fde047" />
    </Bg>
  );
}

function ArmArt({ id }: ArtProps) {
  return (
    <Bg id={id} a="#ef4444" b="#9a3412">
      <rect y="150" width="320" height="50" fill="#7c2d12" />
      <rect y="150" width="320" height="6" fill="#fdba74" opacity=".5" />
      <path d="M-10 168L140 108" stroke="#f1c27d" strokeWidth="38" strokeLinecap="round" />
      <path d="M330 168L180 108" stroke="#b9794a" strokeWidth="38" strokeLinecap="round" />
      <path d="M-14 172L34 153" stroke="#2563eb" strokeWidth="46" strokeLinecap="butt" />
      <path d="M334 172L286 153" stroke="#16a34a" strokeWidth="46" strokeLinecap="butt" />
      <circle cx="160" cy="104" r="30" fill="#e0ac69" />
      <path d="M144 94Q160 86 176 94M142 106Q160 98 178 106M146 118Q160 112 174 118" stroke="#b9794a" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <g stroke="#fff" strokeWidth="5" strokeLinecap="round">
        <path d="M160 42V62M120 54L132 70M200 54L188 70M96 86L116 92M224 86L204 92" />
      </g>
      <Sparkle x={52} y={52} s={10} fill="#fde047" />
      <Sparkle x={278} y={60} s={10} fill="#fde047" />
    </Bg>
  );
}

function ColourArt({ id }: ArtProps) {
  const colors = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#a3e635"];
  return (
    <Bg id={id} a="#1e1b4b" b="#6d28d9">
      {colors.map((c, i) => {
        const x = 92 + (i % 3) * 48;
        const y = 32 + Math.floor(i / 3) * 48;
        return <rect key={i} x={x} y={y} width="40" height="40" rx="9" fill={c} />;
      })}
      <rect x="140" y="80" width="40" height="40" rx="9" fill="#0f0a2e" opacity=".6" />
      <path d="M149 89L171 111M171 89L149 111" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <path d="M40 100Q56 80 72 100Q56 120 40 100Z" fill="#fff" />
      <circle cx="56" cy="100" r="7" fill="#6d28d9" />
      <Sparkle x={256} y={48} s={11} fill="#fde047" />
      <Sparkle x={274} y={150} s={8} />
      <Sparkle x={36} y={160} s={8} fill="#fde047" />
    </Bg>
  );
}

function PaperDanceArt({ id }: ArtProps) {
  return (
    <Bg id={id} a="#ec4899" b="#7c3aed">
      <g transform="rotate(-8 160 100)">
        <path d="M100 28H206L236 58V172H100Z" fill="#fff" />
        <path d="M206 28L236 58H206Z" fill="#e5e7eb" />
        <g fill="#ec4899">
          <ellipse cx="146" cy="122" rx="12" ry="19" transform="rotate(-8 146 122)" />
          <circle cx="136" cy="98" r="4.5" /><circle cx="146" cy="94" r="4" /><circle cx="156" cy="97" r="3.6" />
          <ellipse cx="192" cy="136" rx="12" ry="19" transform="rotate(8 192 136)" fill="#7c3aed" />
        </g>
        <g fill="#7c3aed">
          <circle cx="182" cy="110" r="4.5" /><circle cx="192" cy="106" r="4" /><circle cx="202" cy="109" r="3.6" />
        </g>
      </g>
      <Note x={54} y={74} s={1.2} fill="#fde047" />
      <Note x={276} y={118} s={1.1} />
      <Note x={44} y={150} s={0.9} />
      <Sparkle x={270} y={40} s={11} fill="#fde047" />
    </Bg>
  );
}

function SquareArt({ id }: ArtProps) {
  return (
    <Bg id={id} a="#4338ca" b="#0ea5e9">
      <path d="M40 150L96 80H226L282 150Z" fill="#fff" opacity=".12" />
      <path d="M40 150L96 80H226L282 150Z" fill="none" stroke="#fff" strokeWidth="5" strokeDasharray="14 10" strokeLinejoin="round" />
      <circle cx="148" cy="72" r="11" fill="#fff" />
      <g stroke="#fff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M148 88L142 122" />
        <path d="M146 98L166 108M146 98L128 110" />
        <path d="M142 122L162 142L158 160M142 122L124 138L110 134" />
      </g>
      <ellipse cx="146" cy="168" rx="38" ry="6" fill="#0f172a" opacity=".25" />
      <circle cx="262" cy="52" r="32" fill="#fff" />
      <circle cx="262" cy="52" r="32" fill="none" stroke="#fde047" strokeWidth="6" />
      <rect x="256" y="12" width="12" height="8" rx="2" fill="#fde047" />
      <path d="M262 52V32M262 52L276 60" stroke="#4338ca" strokeWidth="4" strokeLinecap="round" />
      <Sparkle x={52} y={44} s={11} />
      <Sparkle x={300} y={140} s={8} fill="#fde047" />
    </Bg>
  );
}

function HookArt({ id }: ArtProps) {
  return (
    <Bg id={id} a="#f43f5e" b="#f59e0b">
      <path d="M160 0L100 200H220Z" fill="#fff" opacity=".12" />
      <circle cx="160" cy="54" r="14" fill="#fff" />
      <g stroke="#fff" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M160 72L156 118" />
        <path d="M158 84L194 66L214 42M158 84L122 100L100 126" />
        <path d="M156 118L186 146L196 178M156 118L126 148L96 150" />
      </g>
      <circle cx="214" cy="42" r="6" fill="#fde047" />
      <circle cx="100" cy="126" r="6" fill="#fde047" />
      <Note x={52} y={66} s={1.2} fill="#fff" />
      <Note x={262} y={120} s={1.2} fill="#fde047" />
      <Sparkle x={270} y={44} s={12} />
      <Sparkle x={44} y={150} s={9} fill="#fde047" />
    </Bg>
  );
}

function BlindfoldArt({ id }: ArtProps) {
  return (
    <Bg id={id} a="#334155" b="#7c3aed">
      <circle cx="140" cy="106" r="62" fill="#fcd9b6" />
      <path d="M80 92Q140 74 200 92L200 118Q140 100 80 118Z" fill="#111827" />
      <path d="M200 100L232 86L226 122Z" fill="#111827" />
      <path d="M118 140Q140 156 162 140" stroke="#b45309" strokeWidth="5" fill="none" strokeLinecap="round" />
      <g fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" opacity=".85">
        <path d="M250 70Q266 88 250 106" />
        <path d="M264 56Q290 88 264 120" opacity=".6" />
        <path d="M30 70Q14 88 30 106" />
        <path d="M16 56Q-10 88 16 120" opacity=".6" />
      </g>
      <Sparkle x={256} y={160} s={9} fill="#fde047" />
    </Bg>
  );
}

function DiceArt({ id }: ArtProps) {
  const pip = (x: number, y: number) => <circle key={`${x}${y}`} cx={x} cy={y} r="7" fill="#0f172a" />;
  return (
    <Bg id={id} a="#14b8a6" b="#3b82f6">
      <g transform="rotate(-12 120 100)">
        <rect x="68" y="50" width="104" height="104" rx="22" fill="#fff" />
        {[pip(94, 76), pip(146, 76), pip(120, 102), pip(94, 128), pip(146, 128)]}
      </g>
      <g transform="rotate(16 232 128)">
        <rect x="196" y="92" width="72" height="72" rx="16" fill="#fde047" />
        {[<circle key="a" cx="216" cy="112" r="5.5" fill="#0f172a" />, <circle key="b" cx="248" cy="144" r="5.5" fill="#0f172a" />, <circle key="c" cx="232" cy="128" r="5.5" fill="#0f172a" />]}
      </g>
      <Sparkle x={44} y={46} s={11} />
      <Sparkle x={282} y={50} s={9} fill="#fde047" />
    </Bg>
  );
}

const PALETTES: [string, string][] = [
  ["#7c3aed", "#ec4899"],
  ["#0ea5e9", "#1e3a8a"],
  ["#f97316", "#be123c"],
  ["#14b8a6", "#3b82f6"],
  ["#f43f5e", "#f59e0b"],
  ["#16a34a", "#0f766e"],
];

function FallbackArt({ id, name }: ArtProps & { name: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = PALETTES[h % PALETTES.length];
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <Bg id={id} a={a} b={b}>
      <circle cx="160" cy="100" r="64" fill="#fff" opacity=".18" />
      <circle cx="160" cy="100" r="46" fill="#fff" />
      <text x="160" y="116" textAnchor="middle" fontSize="42" fontWeight="900" fill={a} fontFamily={FONT}>
        {initials}
      </text>
      <Sparkle x={60} y={48} s={11} />
      <Sparkle x={268} y={150} s={10} fill="#fde047" />
    </Bg>
  );
}

const ART: Record<string, (p: ArtProps) => ReactNode> = {
  "meme-charades": MemeArt,
  "green-light-red-light": GreenRedArt,
  "shark-tank": SharkArt,
  "act-it-out": ActArt,
  "cup-flip-tic-tac-toe": CupArt,
  "arm-wrestling": ArmArt,
  "colour-blind": ColourArt,
  "paper-dance": PaperDanceArt,
  "stay-in-the-square": SquareArt,
  "hook-step-challenge": HookArt,
  "blindfold-animals": BlindfoldArt,
  "random-activity": DiceArt,
};

export function GameArt({ slug, name, className = "" }: { slug: string; name: string; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const Art = ART[slug];
  return (
    <svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" className={`block h-full w-full ${className}`} role="img" aria-label={name}>
      {Art ? <Art id={`g${uid}`} /> : <FallbackArt id={`g${uid}`} name={name} />}
    </svg>
  );
}
