import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../scripts/creative-auto-decision.mjs';
const catalog = { products: [{ slug: 'lucro-e-caixa', name: 'Lucro & Caixa', price: 247 }, { slug: 'ia-na-pratica', name: 'IA na Prática', price: 197 }] };

test('approves a creative that matches the official catalog', () => {
  const r = decide({ title: 'Criativo · Lucro & Caixa · entrega', detail: 'Lucro & Caixa custa R$ 247,00 (preço de tabela). https://vendas.zevanory.api.br/lucro-e-caixa' }, catalog);
  assert.equal(r.action, 'approve');
});
test('requests changes on wrong price, missing link or forbidden claims, with reasons', () => {
  const r = decide({ title: 'IA na Prática', detail: 'Só hoje por R$ 97! Grátis bônus' }, catalog);
  assert.equal(r.action, 'request-changes');
  assert.ok(r.reasons.some((x) => x.includes('preço')) && r.reasons.some((x) => x.includes('link')) && r.reasons.some((x) => x.includes('proibido')));
});
