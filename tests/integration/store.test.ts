import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, sqliteAvailable } from '@awrm/store';

for (const kind of ['memory', 'jsonl', 'sqlite'] as const) {
  test(`store ${kind}: put/get/list/putIfAbsent semantics and persistence`, { skip: kind === 'sqlite' && !sqliteAvailable() ? 'node:sqlite unavailable' : false }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'awrm-store-'));
    try {
      const s = kind === 'memory' ? openStore({ kind }) : openStore({ kind, dir });
      s.put('runs', 'a', { n: 1 });
      s.put('runs', 'b', { n: 2 });
      s.put('runs', 'a', { n: 3 });
      assert.equal(s.putIfAbsent('marks', 'm', { x: 1 }), true);
      assert.equal(s.putIfAbsent('marks', 'm', { x: 2 }), false);
      assert.deepEqual(s.get('runs', 'a'), { n: 3 });
      assert.deepEqual(s.list('runs'), [{ n: 3 }, { n: 2 }]);
      assert.throws(() => s.put('Bad Collection', 'x', {}));
      s.close();
      if (kind !== 'memory') {
        const r = openStore({ kind, dir });
        assert.deepEqual(r.get('runs', 'a'), { n: 3 });
        assert.deepEqual(r.get('marks', 'm'), { x: 1 });
        r.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
test('jsonl: a torn final line is tolerated and sealed; mid-file corruption is fatal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'awrm-torn-'));
  try {
    const s = openStore({ kind: 'jsonl', dir });
    s.put('runs', 'a', { ok: true });
    s.close();
    appendFileSync(join(dir, 'journal.jsonl'), '{"c":"runs","id":"b","d":"{\\"ok');
    const r = openStore({ kind: 'jsonl', dir });
    assert.equal(r.openReport.tornLines, 1);
    r.put('runs', 'c', { ok: 1 });
    r.close();
    const again = openStore({ kind: 'jsonl', dir });
    assert.deepEqual(again.get('runs', 'c'), { ok: 1 });
    again.close();
    appendFileSync(join(dir, 'journal.jsonl'), 'garbage\n{"c":"runs","id":"d","d":"{}"}\n');
    assert.throws(() => openStore({ kind: 'jsonl', dir }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
