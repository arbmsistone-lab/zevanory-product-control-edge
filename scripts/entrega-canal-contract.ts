import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { linhaEntrega } from '../src/entrega-canal.ts';

// Formato produzido pelo computePublications do zevanory-public-mirror (#1065).
assert.equal(linhaEntrega({ expected: 2, published: 2, falhas: [] }), '2 de 2 confirmadas', 'blog desde a ativação: 2/2, sem falhas');
assert.equal(
  linhaEntrega({ expected: 3, published: 2, falhas: [{ dia: '2026-11-18', status: 'erro', code: 'rejected:duplicado,fonte_ausente' }] }),
  '2 de 3 confirmadas · falhou 18/11: rejected:duplicado,fonte_ausente', 'o motivo (code, formato do motor) aparece na tela');
// cron que não gravou nada depois do horário (snapshot #1065): "sem_registro"
assert.equal(linhaEntrega({ expected: 3, published: 1, falhas: [{ dia: '2026-11-16', status: 'erro', code: 'rejected:duplicado' }, { dia: '2026-11-18', status: null, code: 'sem_registro' }] }), '1 de 3 confirmadas · falhou 16/11: rejected:duplicado · falhou 18/11: sem_registro');
assert.equal(linhaEntrega({ expected: 1, published: 0, falhas: [{ dia: '2026-11-18', status: 'erro', code: null }] }), '0 de 1 confirmadas · falhou 18/11: erro');
assert.equal(linhaEntrega({ expected: 1, published: 0, falhas: [{ dia: '2026-11-18', status: null, code: null }] }), '0 de 1 confirmadas · falhou 18/11: sem motivo registrado');
// snapshot antigo (sem o campo falhas): só a contagem
assert.equal(linhaEntrega({ expected: 3, published: 2 }), '2 de 3 confirmadas');
const cc = readFileSync(new URL('../src/CommandCenter.tsx', import.meta.url), 'utf8');
assert.match(cc, /<span>\{linhaEntrega\(v\)\}<\/span>/);
console.log('entrega-canal contract: ok');
