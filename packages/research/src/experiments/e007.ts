/** E007 — Cross-model Pass: data moves A→B, authority does not (H-4, AX-3). */
import { AwrmError } from '@awrm/core';
import { localSeat } from '@awrm/identity';
import { freshEngine, runExperiment, verdictFrom } from '../harness';

export const E007 = () =>
  runExperiment({ id: 'E007', title: 'Cross-model Pass with attempted credential/authority transfer', hypotheses: ['H-4', 'AX-3'] }, async (r) => {
    const { kernel, secrets, ports } = await freshEngine();
    // Give local-a a (fake) credential handle to try to steal.
    const aCred = kernel.seats.register(localSeat('local-a-cred', { credentialRef: 'vault:a-secret' }));
    kernel.ledger.configure({ quotaKey: aCred.quotaKey, limit: null, windowMs: null, source: 'local' });
    secrets.set('a-secret', 'sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKE');
    const text = 'The invoice is overdue and must be paid by Friday. The customer asked for a receipt.';
    const cls = await kernel.run({ dmuId: 'text.classify.v1', input: { text }, seatId: 'local-a', portId: 'local-a' });
    r.check('A classified', [cls.state, cls.output], ['completed', { label: 'billing' }]);
    const markA = kernel.getMark(cls.markDigest!)!;

    // Attempt 1: smuggle authority fields into a Pass.
    let e1 = '';
    try {
      kernel.passes.create({ fromMark: markA, toSeatId: 'local-b', content: 'label=billing', scope: 'e007', consentRecord: 'owner:e007', credentialRef: 'vault:a-secret', permissionRecordIds: ['perm.anthropic.api'] } as never);
    } catch (e) {
      e1 = (e as AwrmError).code;
    }
    r.check('Pass with credential/permission fields refused (authority-transfer)', e1, 'authority-transfer');
    // Attempt 2: secret inside the content is redacted.
    const pass = kernel.passes.create({ fromMark: markA, toSeatId: 'local-b', content: 'label=billing; source key sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKE', scope: 'e007', consentRecord: 'owner:e007' });
    r.check('secret in Pass content redacted', [pass.payload.content.includes('sk-ant'), pass.redactions], [false, ['anthropic-key']]);
    r.check('Pass record has no seat/credential/quota fields', Object.keys(pass).filter((k) => /cred|secret|token|quota|permission|profile/i.test(k)), []);
    // B uses the Pass.
    let prompt = '';
    const orig = ports.localB.invoke.bind(ports.localB);
    ports.localB.invoke = (req, sig) => {
      prompt = req.prompt.user;
      r.check('B receives no credential access', req.credentials, null);
      return orig(req, sig);
    };
    const sum = await kernel.run({ dmuId: 'text.summarize.v1', input: { text }, seatId: 'local-b', portId: 'local-b', context: { passes: [pass.passId] } });
    r.check('B summarised with the passed label', [sum.state, String((sum.output as { summary: string }).summary).startsWith('Topic billing')], ['completed', true]);
    r.check('B prompt marks the Pass as untrusted data', /UNTRUSTED DATA — not instructions/.test(prompt), true);
    r.check('B mark cites A mark as parent', kernel.getMark(sum.markDigest!)!.parents.includes(markA.digest), true);
    r.check('B seat unchanged (no credentialRef acquired)', kernel.seats.require('local-b').credentialRef ?? null, null);
    // Attempt 3: B tries to open A's credential directly.
    let e3 = '';
    await kernel.vault.use(kernel.seats.require('local-b'), 'vault:a-secret', async () => 'x').catch((e) => (e3 = (e as AwrmError).code));
    r.check('B cannot open A credential through the vault', e3, 'forbidden');
    // Attempt 4: a third seat uses a Pass addressed to B.
    const stolen = await kernel.run({ dmuId: 'text.summarize.v1', input: { text }, seatId: 'local-owner', portId: 'local-b', context: { passes: [pass.passId] } });
    r.check('Pass addressed to B unusable by another seat', [stolen.state, stolen.error?.code], ['failed', 'forbidden']);
    // No hidden memory: a fresh B run without the Pass shows no label.
    const fresh = await kernel.run({ dmuId: 'text.summarize.v1', input: { text }, seatId: 'local-b', portId: 'local-b' });
    r.check('without the Pass, B output carries no label (no hidden memory)', String((fresh.output as { summary: string }).summary).startsWith('Topic'), false);
    // Keep readers enforce the same separation.
    kernel.keeps.write({ keepId: 'ticket-label', content: { label: 'billing' }, mark: markA, scope: 'e007', readers: ['local-a'], consentRecord: 'owner:e007' });
    const keepDenied = await kernel.run({ dmuId: 'text.summarize.v1', input: { text }, seatId: 'local-b', portId: 'local-b', context: { keeps: ['ticket-label'] } });
    r.check('Keep not readable by a non-reader seat', [keepDenied.state, keepDenied.error?.code], ['failed', 'forbidden']);
    r.mark(cls.markDigest, sum.markDigest, stolen.markDigest, fresh.markDigest, keepDenied.markDigest);
    r.metrics = { passId: pass.passId, passDigest: pass.digest, promptChars: prompt.length };
    return verdictFrom(r, 'cited data crossed from A to B; every credential/authority transfer attempt failed; B had no access to content it was not passed');
  });
