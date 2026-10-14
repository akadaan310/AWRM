/**
 * Two independent deterministic "inference test doubles". They are AWRM-written
 * rule programs that imitate a model's I/O shape. Evidence produced through
 * them proves infrastructure behaviour only — never model reasoning quality.
 *
 *   brainA — keyword rules + regex arithmetic        (port "local-a"/"owned-fixture")
 *   brainB — token-overlap centroid classifier,
 *            shunting-yard arithmetic, extractive summary (port "local-b")
 */
export interface Prompt {
  system?: string;
  user: string;
}

// ---------------------------------------------------------------- brain A
const ARITH = /(-?\d+)\s*(?:×|\*|x|times|\+|plus|-|minus|\/|÷|divided by)\s*(-?\d+)/i;

export function brainA(p: Prompt): string {
  const sys = p.system ?? '';
  const q = p.user;
  if (/Question:/i.test(q)) {
    const line = q.slice(q.lastIndexOf('Question:'));
    const m = ARITH.exec(line);
    if (!m) return 'I cannot determine an integer answer.';
    const a = Number(m[1]);
    const b = Number(m[2]);
    const op = m[0].replace(m[1]!, '').replace(m[2]!, '').trim().toLowerCase();
    if (/×|\*|x|times/.test(op)) return String(a * b);
    if (/\+|plus/.test(op)) return String(a + b);
    if (/÷|\/|divided/.test(op)) return b === 0 ? 'undefined' : Number.isInteger(a / b) ? String(a / b) : (a / b).toFixed(4);
    return String(a - b);
  }
  if (/classify/i.test(sys)) {
    const text = (q.split('Text:').pop() ?? q).toLowerCase();
    if (/invoice|payment|refund|charge|bill|overdue|pay\b/.test(text)) return 'billing';
    if (/ship|deliver|package|tracking|courier/.test(text)) return 'shipping';
    if (/error|crash|bug|login|password|broken|outage/.test(text)) return 'technical';
    return 'other';
  }
  if (/^Summarize:/m.test(q) || /summari[sz]e/i.test(sys)) {
    const text = q.slice(q.lastIndexOf('Summarize:') + 'Summarize:'.length).trim();
    const first = (text.match(/[^.!?]+[.!?]?/) ?? [text])[0]!.trim();
    const topic = /label=([a-z]+)/.exec(q)?.[1];
    return (topic ? `[${topic}] ` : '') + first.slice(0, 240);
  }
  if (/^Extract facts:/m.test(q)) {
    const text = q.slice(q.indexOf('Extract facts:') + 14);
    return (text.match(/[^.!?]+[.!?]/g) ?? [text]).map((s) => s.trim()).filter(Boolean).slice(0, 8).join('\n');
  }
  const cite = /^Cite these facts from (.+?): (\[.*\])$/ms.exec(q);
  if (cite) {
    const facts = JSON.parse(cite[2]!) as string[];
    return facts.map((f) => `${f} [${cite[1]}]`).join(' ');
  }
  return 'I can only answer arithmetic, classification, summary and fact questions.';
}

// ---------------------------------------------------------------- brain B
const CENTROIDS: Record<string, string[]> = {
  billing: ['invoice', 'payment', 'paid', 'pay', 'refund', 'charge', 'charged', 'bill', 'billing', 'overdue', 'price', 'receipt'],
  shipping: ['ship', 'shipping', 'shipped', 'delivery', 'delivered', 'package', 'parcel', 'tracking', 'courier', 'arrive', 'arrived'],
  technical: ['error', 'crash', 'bug', 'login', 'password', 'broken', 'outage', 'app', 'install', 'reset', 'fails'],
};

function tokens(s: string): string[] {
  return s.toLowerCase().match(/[a-z]+/g) ?? [];
}

function evalArith(expr: string): number | null {
  const toks = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/\btimes\b/gi, '*').match(/\d+|[-+*/()]/g);
  if (!toks) return null;
  const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  const out: (number | string)[] = [];
  const ops: string[] = [];
  for (const t of toks) {
    if (/\d/.test(t)) out.push(Number(t));
    else if (t === '(') ops.push(t);
    else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()!);
      ops.pop();
    } else {
      while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]!]! >= prec[t]!) out.push(ops.pop()!);
      ops.push(t);
    }
  }
  while (ops.length) out.push(ops.pop()!);
  const st: number[] = [];
  for (const t of out) {
    if (typeof t === 'number') st.push(t);
    else {
      const b = st.pop();
      const a = st.pop();
      if (a === undefined || b === undefined) return null;
      st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : a / b);
    }
  }
  return st.length === 1 && Number.isFinite(st[0]!) ? st[0]! : null;
}

export function brainB(p: Prompt): string {
  const sys = p.system ?? '';
  const q = p.user;
  const qm = /Question:\s*([^\n]*)/i.exec(q.slice(q.lastIndexOf('Question:')));
  if (qm) {
    const expr = (qm[1]!.match(/[\d(][\d\s+\-*/×÷()]*(?:times[\d\s+\-*/×÷()]*)*/i) ?? [''])[0]!;
    const v = evalArith(expr);
    return v === null || !Number.isInteger(v) ? 'unknown' : `The answer is ${v}.`;
  }
  if (/classify/i.test(sys)) {
    const t = tokens(q.split('Text:').pop() ?? q);
    let best = 'other';
    let bestScore = 0;
    for (const [label, vocab] of Object.entries(CENTROIDS)) {
      const score = t.filter((w) => vocab.includes(w)).length / Math.sqrt(vocab.length);
      if (score > bestScore) [best, bestScore] = [label, score];
    }
    return `Label: ${best}`;
  }
  if (/^Summarize:/m.test(q) || /summari[sz]e/i.test(sys)) {
    const text = q.slice(q.lastIndexOf('Summarize:') + 'Summarize:'.length).trim();
    const sentences = text.match(/[^.!?]+[.!?]?/g) ?? [text];
    // Extractive: pick the sentence with the most content words.
    const scored = sentences.map((s) => ({ s: s.trim(), n: tokens(s).filter((w) => w.length > 3).length }));
    scored.sort((a, b) => b.n - a.n);
    const topic = /label=([a-z]+)/.exec(q)?.[1];
    const core = scored[0]?.s ?? text;
    return (topic ? `Topic ${topic}: ` : '') + core.slice(0, 240);
  }
  if (/^Extract facts:/m.test(q)) {
    const text = q.slice(q.indexOf('Extract facts:') + 14);
    return (text.split(/(?<=[.!?])\s+/) ?? []).map((s) => `- ${s.trim()}`).filter((s) => s.length > 2).slice(0, 8).join('\n');
  }
  const cite = /^Cite these facts from (.+?): (\[.*\])$/ms.exec(q);
  if (cite) return (JSON.parse(cite[2]!) as string[]).map((f) => `(${cite[1]}) ${f}`).join(' ');
  return 'unsupported request';
}
