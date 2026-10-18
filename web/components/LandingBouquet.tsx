/** Landing illustration: a wrapped bouquet whose stems sway and whose flowers open one after another. SVG + CSS only. */
const FLOWERS: { x: number; y: number; c: string; k: string; s: number; p: number; r?: number }[] = [
  { x: 150, y: 70, c: '#e2588f', k: '#f6c34a', s: 1.15, p: 8 },
  { x: 92, y: 104, c: '#f7a1c4', k: '#fff2b8', s: .95, p: 6, r: 12 },
  { x: 212, y: 100, c: '#c3a6ff', k: '#f6c34a', s: 1, p: 7, r: -8 },
  { x: 60, y: 160, c: '#ffd0a6', k: '#e2588f', s: .8, p: 5 },
  { x: 244, y: 162, c: '#f7a1c4', k: '#7aa58a', s: .85, p: 9, r: 20 },
  { x: 124, y: 150, c: '#fff4f8', k: '#e2588f', s: .9, p: 10 },
  { x: 182, y: 148, c: '#ef7aa9', k: '#fff2b8', s: .78, p: 6, r: 30 },
];
const petal = (n: number, rx: number, ry: number) => Array.from({ length: n }, (_, i) => <ellipse key={i} cx={0} cy={-ry} rx={rx} ry={ry} transform={`rotate(${(360 / n) * i})`} />);
export default function LandingBouquet() {
  return <svg className="lb" viewBox="0 0 300 380" role="img" aria-label="A bouquet of flowers">
    <defs>
      <linearGradient id="lb-wrap" x1="0" x2="1"><stop offset="0" stopColor="#f6d9c8" /><stop offset=".5" stopColor="#fbe9dc" /><stop offset="1" stopColor="#efcdb9" /></linearGradient>
    </defs>
    <g className="lb-stems" stroke="#6f9f7e" strokeWidth="3.2" fill="none" strokeLinecap="round">
      {FLOWERS.map((f, i) => <path key={i} className="lb-stem" style={{ ['--i' as any]: i }} d={`M150 300 Q${(f.x + 150) / 2 + (f.x > 150 ? -10 : 10)} ${(f.y + 300) / 2} ${f.x} ${f.y}`} />)}
    </g>
    <g className="lb-leaves" fill="#8cc09b">
      <path className="lb-leaf l" d="M120 250 Q80 230 70 196 Q108 206 124 240Z" />
      <path className="lb-leaf r" d="M180 250 Q222 232 236 198 Q194 206 176 240Z" />
      <path className="lb-leaf l2" d="M140 232 Q118 200 126 170 Q150 196 146 228Z" fill="#a8d3b3" />
    </g>
    {FLOWERS.map((f, i) => <g key={i} className="lb-flower-pos" transform={`translate(${f.x} ${f.y}) rotate(${f.r ?? 0}) scale(${f.s})`}>
      <g className="lb-flower" style={{ ['--i' as any]: i }}>
        <g fill={f.c} stroke="#0000000d">{petal(f.p, 9, 17)}</g>
        <circle r="8.5" fill={f.k} /><circle r="3.4" fill="#fff" opacity=".5" cx="-2" cy="-2" />
      </g></g>)}
    <path d="M86 236 L150 372 L214 236 Q150 262 86 236Z" fill="url(#lb-wrap)" />
    <path d="M86 236 Q150 262 214 236 L206 252 Q150 276 94 252Z" fill="#e9bfa8" opacity=".6" />
    <path className="lb-ribbon" d="M128 300 Q150 310 172 300 L170 314 Q150 322 130 314Z" fill="#e2588f" />
    <path d="M150 312 Q132 340 120 352 M150 312 Q166 342 182 350" stroke="#e2588f" strokeWidth="4" fill="none" strokeLinecap="round" />
    {[0, 1, 2].map(i => <ellipse key={i} className="lb-fall" style={{ ['--i' as any]: i }} cx={100 + i * 55} cy={40} rx="5" ry="8" fill={['#f7a1c4', '#c3a6ff', '#ef7aa9'][i]} />)}
  </svg>;
}
