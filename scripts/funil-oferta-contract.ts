import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { funilOfertaTiles, ROTULOS_OFERTA, type FunilOferta } from '../src/funil-oferta.ts';

// Saída REAL gravada pelo snapshot (zevanory-public-mirror #1061, teste "painel recebe"): 3 chegadas, 2 cliques, 1+1 de diagnóstico.
const real = JSON.parse(readFileSync(new URL('../tests/fixtures/snapshot-funil-oferta.json', import.meta.url), 'utf8')) as FunilOferta;
const [abriu, clicou, diag] = funilOfertaTiles(real, '2026-11-15T21:00:00Z');
assert.equal(abriu.label, 'Abriu a página da oferta'); assert.equal(abriu.value, '3'); assert.equal(abriu.integrity, 'aggregated');
assert.match(abriu.definition, /sem testes de diagnóstico/);
assert.equal(clicou.label, 'Clicou para ir ao checkout'); assert.equal(clicou.value, '2'); assert.match(clicou.definition, /confirmação da Hotmart/);
assert.equal(diag.label, ROTULOS_OFERTA.diagnostico); assert.equal(diag.value, '1 chegadas · 1 cliques'); assert.match(diag.definition, /não somam/);

// Snapshot antigo (sem funnel.oferta) ou leitura ausente: nunca inventa número.
for (const t of funilOfertaTiles(undefined, null)) { assert.equal(t.value, '—'); assert.equal(t.integrity, 'missing'); }
const semValor = funilOfertaTiles({ ...real, abriuOferta: { ...real.abriuOferta, value: null, integrity: 'missing' } }, null);
assert.equal(semValor[0].value, '—'); assert.equal(semValor[0].integrity, 'missing'); assert.equal(semValor[1].value, '2');
// Valor corrompido (negativo, fracionário, texto) não vira número no painel.
for (const bad of [-1, 1.5, '3' as unknown as number]) assert.equal(funilOfertaTiles({ ...real, clicouCheckout: { ...real.clicouCheckout, value: bad } }, null)[1].value, '—');

// O card "Funil" do painel usa estes blocos (sem rótulo escrito à mão no componente).
const cc = readFileSync(new URL('../src/CommandCenter.tsx', import.meta.url), 'utf8');
assert.match(cc, /funilOfertaTiles\(s\.funnel\.oferta, s\.generatedAt\)\.map\(/);
assert.match(cc, /oferta\?: FunilOferta/);
console.log('funil-oferta contract: ok');
