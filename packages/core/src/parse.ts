/**
 * Declarative extraction of a structured candidate output from a raw response.
 * Parsing never decides validity: the Form's output schema does. A parser that
 * cannot find structure returns the raw text in the declared field so the
 * schema rejects it visibly (no silent coercion to a "plausible" answer).
 */
export type ParseSpec =
  | { mode: 'json' }
  | { mode: 'integer'; field: string }
  | { mode: 'label'; field: string; labels: string[] }
  | { mode: 'text'; field: string }
  | { mode: 'lines'; field: string; maxLines: number };

export function parseResponse(spec: ParseSpec, raw: string): unknown {
  const text = raw.trim();
  switch (spec.mode) {
    case 'json': {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0 || end < start) return { __unparsed: text };
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return { __unparsed: text };
      }
    }
    case 'integer': {
      if (/^-?\d+$/.test(text)) return { [spec.field]: Number(text) };
      const json = tryJson(text);
      if (json && typeof json === 'object' && spec.field in json) return json;
      const ints = text.replace(/(\d),(\d{3})/g, '$1$2').match(/-?\b\d+\b/g) ?? [];
      // Exactly one integer in a short answer is accepted; several are ambiguous.
      if (ints.length === 1) return { [spec.field]: Number(ints[0]), explanation: text };
      return { [spec.field]: text };
    }
    case 'label': {
      const norm = text.toLowerCase().replace(/[^a-z0-9 _-]/g, ' ').trim();
      const exact = spec.labels.find((l) => l === norm);
      if (exact) return { [spec.field]: exact };
      const hits = spec.labels.filter((l) => new RegExp(`\\b${l}\\b`).test(norm));
      return { [spec.field]: hits.length === 1 ? hits[0] : text };
    }
    case 'text':
      return { [spec.field]: text };
    case 'lines': {
      const lines = text
        .split('\n')
        .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
        .filter(Boolean)
        .slice(0, spec.maxLines + 1); // one extra so maxItems can reject overflow
      return { [spec.field]: lines };
    }
  }
}

function tryJson(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
