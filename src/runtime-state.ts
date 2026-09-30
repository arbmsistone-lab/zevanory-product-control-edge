export const MAX_STATE_AGE_MS = 120000;

export function shouldEndSession(cause: unknown): boolean {
  return (cause as { response?: { status?: number } })?.response?.status === 401;
}

type TrustInput = {
  state: string;
  sha: string | null;
  evidenceRoot: string | null;
  checkedAt: string | null;
  quorum: { passed: number; required: number; conflicts: number };
  zea10: { proven: number; partial: number; blocked: number };
  engines: Array<{ id: string; state: string }>;
};

export function trustPresentation(input: TrustInput | null, now: number, observedAt: number) {
  if (!input) return { approved: false, state: 'UNKNOWN', freshness: 'OFFLINE', reason: 'Autoridade indisponível. Atualize o painel.' };
  const generatedAt = Date.parse(input.checkedAt ?? '');
  const fresh = Number.isFinite(generatedAt) && generatedAt <= now + 30000 &&
    now - generatedAt <= MAX_STATE_AGE_MS && observedAt > 0 && now - observedAt <= MAX_STATE_AGE_MS;
  if (!fresh) return { approved: false, state: 'BLOCKED', freshness: 'STALE', reason: 'A evidência expirou ou não possui data válida. Consulte novamente a autoridade.' };
  const approved = input.state === 'GREEN' && /^[a-f0-9]{40}$/i.test(input.sha ?? '') &&
    /^[a-f0-9]{64}$/i.test(input.evidenceRoot ?? '') &&
    Number.isSafeInteger(input.quorum?.required) && input.quorum?.required > 0 &&
    Number.isSafeInteger(input.quorum?.passed) && input.quorum?.passed >= input.quorum?.required &&
    input.quorum?.conflicts === 0 && input.zea10?.proven === 10 && input.zea10?.partial === 0 && input.zea10?.blocked === 0 &&
    Array.isArray(input.engines) && ['zees16-core', 'zea10-evaluator', 'control-core'].every(id => input.engines.some(engine => engine.id === id && engine.state === 'GREEN'));
  return { approved, state: approved ? 'PASS' : 'BLOCKED', freshness: 'LIVE', reason: approved ? 'A autoridade atual comprovou os gates.' : 'Gates incompletos na autoridade atual. Consulte ZEES-16 / Governança e Operações técnicas.' };
}
