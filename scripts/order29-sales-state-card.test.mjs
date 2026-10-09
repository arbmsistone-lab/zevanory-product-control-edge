import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const code = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.match(code,/api\.get\('\/api\/sales\/state'\)/);
assert.match(code,/setSalesStateLabel\('Estado indisponível'\)/);
assert.doesNotMatch(code,/<span>Vendas pausadas · modo teste<\/span>/);
console.log('ORDER29_SALES_STATE_CARD=PASS');
