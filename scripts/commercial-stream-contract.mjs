import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { execFileSync } from 'node:child_process';

function harness(source) {
  const start = source.indexOf('    let active = true;');
  const end = source.indexOf('\n  }, [section]);', start);
  assert.ok(start >= 0 && end > start, 'production stream effect must exist');
  const intervals = new Map(), timeouts = new Map(), streams = [], listeners = new Map();
  let sequence = 0, refreshes = 0;
  const document = { visibilityState: 'visible', addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) };
  const window = {
    location: { pathname: '/' },
    setInterval: fn => { const id = ++sequence; intervals.set(id, fn); return id; },
    clearInterval: id => intervals.delete(id),
    setTimeout: fn => { const id = ++sequence; timeouts.set(id, fn); return id; },
    clearTimeout: id => timeouts.delete(id),
  };
  class EventSource {
    constructor() { this.closed = false; streams.push(this); }
    addEventListener(event, fn) { this[event] = fn; }
    close() { this.closed = true; }
  }
  const ctx = vm.createContext({ window, document, EventSource, setLiveState() {}, setLastSyncAt() {}, Date, refreshRef: { current: async () => { refreshes++; } } });
  const code = transform('function effect(){\n' + source.slice(start, end) + '\n}; effect()', { loader: 'ts', format: 'cjs' });
  return Promise.resolve(code).then(({ code }) => {
    const dispose = vm.runInContext(code, ctx);
    return { intervals, timeouts, streams, listeners, document, dispose, refreshes: () => refreshes, reconnect() { const entries = [...timeouts]; timeouts.clear(); for (const [, fn] of entries) fn(); } };
  });
}

const baseline = execFileSync('git', ['show', '843495cc6cd5b9fe5665b70452a527cedb86eb6c:src/CommercialWorkspace.tsx'], { encoding: 'utf8' });
const before = await harness(baseline);
before.streams[0].onerror(); before.reconnect(); before.streams.at(-1).onopen();
assert.equal(before.intervals.size, 1, 'before: recovered EventSource retains fallback interval');
before.dispose();

const after = await harness(await fs.readFile('src/CommercialWorkspace.tsx', 'utf8'));
for (let cycle = 0; cycle < 100; cycle++) {
  after.streams.at(-1).onerror();
  assert.equal(after.intervals.size, 1, 'one fallback only');
  assert.equal(after.timeouts.size, 1, 'one reconnect only');
  after.reconnect();
  after.streams.at(-1).onopen();
  assert.equal(after.intervals.size, 0, 'recovery stops fallback polling');
  assert.equal(after.timeouts.size, 0, 'recovery stops reconnect timer');
  assert.equal(after.streams.filter(stream => !stream.closed).length, 1, 'one live stream only');
}
after.streams.at(-1).onerror();
after.listeners.get('visibilitychange')();
assert.equal(after.timeouts.size, 0, 'visible reconnect cancels delayed reconnect');
after.streams.at(-1).onopen();
after.dispose();
assert.equal(after.intervals.size, 0);
assert.equal(after.timeouts.size, 0);
assert.equal(after.listeners.size, 0);
assert.ok(after.streams.every(stream => stream.closed));
console.log('BEFORE_EVENTSOURCE_RECOVERED_FALLBACK_COUNT=1');
console.log('AFTER_EVENTSOURCE_RECOVERED_FALLBACK_COUNT=0');
console.log('EVENTSOURCE_RECOVERY_STOPS_FALLBACK_POLLING=PASS');
console.log('NO_DUPLICATE_POLLING=PASS');
console.log('NO_TIMER_LEAK=PASS');
