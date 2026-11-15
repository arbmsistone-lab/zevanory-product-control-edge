import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { funilOfertaTiles, ROTULOS_OFERTA, type FunilOferta } from '../src/funil-oferta.ts';

// Saídas REAIS gravadas no KV pelo main() do snapshot (zevanory-public-mirror #1061, testes "painel recebe"), nos 4 estados.
type Casos = { leituraOk: FunilOferta; vazia: FunilOferta; falhou: FunilOferta; ausente: FunilOferta };
const casos = JSON.parse(readFileSync(new URL('../tests/fixtures/snapshot-funil-oferta.json', import.meta.url), 'utf8')) as Casos;
const valores = (o: FunilOferta | undefined) => funilOfertaTiles(o, '2026-11-15T21:00:00Z').map(t => [t.value, t.integrity]);

// 1) Leitura ok com eventos: 3 chegadas, 2 cliques (inclui origem fora do top 30), diagnóstico 1 + 1 à parte.
const [abriu, clicou, diag] = funilOfertaTiles(casos.leituraOk, '2026-11-15T21:00:00Z');
assert.equal(abriu.label, 'Abriu a página da oferta'); assert.equal(abriu.value, '3'); assert.equal(abriu.integrity, 'aggregated');
assert.match(abriu.definition, /sem testes de diagnóstico/);
assert.equal(clicou.label, 'Clicou para ir ao checkout'); assert.equal(clicou.value, '2'); assert.match(clicou.definition, /confirmação da Hotmart/);
assert.equal(diag.label, ROTULOS_OFERTA.diagnostico); assert.equal(diag.value, '1 chegadas · 1 cliques'); assert.equal(diag.integrity, 'real'); assert.match(diag.definition, /não somam/);
// 2) Consulta bem-sucedida e vazia: zero nos três blocos (dado real, não ausente).
assert.deepEqual(valores(casos.vazia), [['0', 'aggregated'], ['0', 'aggregated'], ['0 chegadas · 0 cliques', 'real']]);
// 3) Consulta falhou e 4) resumo ausente: "—" nos três blocos, inclusive no diagnóstico.
for (const k of ['falhou', 'ausente'] as const) assert.deepEqual(valores(casos[k]), [['—', 'missing'], ['—', 'missing'], ['—', 'missing']], k);
// 5) Snapshot antigo (sem funnel.oferta): "—" nos três.
assert.deepEqual(valores(undefined), [['—', 'missing'], ['—', 'missing'], ['—', 'missing']]);
// Diagnóstico parcial ou corrompido não vira número; indicador sem valor também não.
assert.equal(funilOfertaTiles({ ...casos.leituraOk, diagnostico: { abriuOferta: 1, clicouCheckout: null } }, null)[2].value, '—');
const semValor = funilOfertaTiles({ ...casos.leituraOk, abriuOferta: { ...casos.leituraOk.abriuOferta, value: null, integrity: 'missing' } }, null);
assert.equal(semValor[0].value, '—'); assert.equal(semValor[0].integrity, 'missing'); assert.equal(semValor[1].value, '2');
for (const bad of [-1, 1.5, '3' as unknown as number]) assert.equal(funilOfertaTiles({ ...casos.leituraOk, clicouCheckout: { ...casos.leituraOk.clicouCheckout, value: bad } }, null)[1].value, '—');

// O card "Funil" do painel usa estes blocos (sem rótulo escrito à mão no componente).
const cc = readFileSync(new URL('../src/CommandCenter.tsx', import.meta.url), 'utf8');
assert.match(cc, /funilOfertaTiles\(s\.funnel\.oferta, s\.generatedAt\)\.map\(/);
assert.match(cc, /oferta\?: FunilOferta/);
console.log('funil-oferta contract: ok');
