/** Renders research/results/E005-scaling.svg from the measured E005 result (no hand-entered numbers). */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const r = JSON.parse(readFileSync(join(root, 'research/results/E005.json'), 'utf8')) as {
  environment: { cpus: number; cpuModel: string; commit: string | null };
  metrics: { cpuBound: Pt[]; latencyBound: Pt[] };
};
interface Pt { lanes: number; throughputPerSec: number; p50Ms: number; p95Ms: number }
const series = [
  { name: 'CPU-bound (worker threads, fixed work)', key: 'cpuBound' as const, color: 'var(--series-1)' },
  { name: 'Latency-bound (20 ms simulated wait)', key: 'latencyBound' as const, color: 'var(--series-2)' },
];
const lanes = [1, 2, 4, 8];
const W = 640, H = 300, L = 56, R = 210, T = 36, B = 44;
const x = (n: number) => L + (Math.log2(n) / 3) * (W - L - R);

function panel(title: string, metric: (p: Pt) => number, unit: string, oy: number): string {
  const max = Math.max(...series.flatMap((s) => r.metrics[s.key].map(metric)));
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((v) => v >= raw)!;
  const top = step * 4;
  const y = (v: number) => oy + T + (1 - v / top) * (H - T - B);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(top * f)}" y2="${y(top * f)}" class="grid"/><text x="${L - 8}" y="${y(top * f) + 4}" class="tick" text-anchor="end">${Math.round(top * f)}</text>`).join('');
  const xt = lanes.map((n) => `<text x="${x(n)}" y="${oy + H - B + 18}" class="tick" text-anchor="middle">${n}</text>`).join('');
  const lines = series.map((s) => {
    const pts = r.metrics[s.key];
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.lanes).toFixed(1)},${y(metric(p)).toFixed(1)}`).join(' ');
    const dots = pts.map((p) => `<circle cx="${x(p.lanes)}" cy="${y(metric(p))}" r="4" fill="${s.color}" class="dot"><title>${s.name} — ${p.lanes} lanes: ${metric(p).toFixed(1)} ${unit}</title></circle>`).join('');
    const last = pts.at(-1)!;
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"/>${dots}<text x="${x(last.lanes) + 10}" y="${y(metric(last)) + 4}" class="label">${s.name.split(' (')[0]}: ${metric(last).toFixed(1)}</text>`;
  }).join('');
  return `<text x="${L}" y="${oy + 20}" class="title">${title}</text>${grid}${xt}<text x="${(L + W - R) / 2}" y="${oy + H - 6}" class="tick" text-anchor="middle">lanes (log scale)</text>${lines}`;
}

const legend = series.map((s, i) => `<rect x="${L + i * 290}" y="${2 * H + 6}" width="12" height="12" rx="2" fill="${s.color}"/><text x="${L + 18 + i * 290}" y="${2 * H + 16}" class="tick">${s.name}</text>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${2 * H + 40}" role="img" aria-labelledby="t d">
<title id="t">AWRM E005 — measured Fleet scaling</title>
<desc id="d">Throughput and median latency for 1, 2, 4 and 8 lanes on ${r.environment.cpus} cores (${r.environment.cpuModel}). Data: research/results/E005.json.</desc>
<style>
svg{--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--grid:#e4e3df;--series-1:#2a78d6;--series-2:#eb6834;background:var(--surface)}
@media (prefers-color-scheme: dark){svg{--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--grid:#3a3a37;--series-1:#3987e5;--series-2:#d95926}}
.title{font:600 14px system-ui,sans-serif;fill:var(--ink)}.tick{font:11px system-ui,sans-serif;fill:var(--ink2)}.label{font:11px system-ui,sans-serif;fill:var(--ink)}.grid{stroke:var(--grid);stroke-width:1}.dot{stroke:var(--surface);stroke-width:2}
</style>
<rect width="100%" height="100%" fill="var(--surface)"/>
${panel('Throughput (DMU/s, higher is better)', (p) => p.throughputPerSec, 'DMU/s', 0)}
${panel('Median latency per DMU (ms, lower is better)', (p) => p.p50Ms, 'ms', H)}
${legend}
</svg>
`;
writeFileSync(join(root, 'research/results/E005-scaling.svg'), svg);
console.log('wrote research/results/E005-scaling.svg');
