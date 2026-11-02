const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../dist/ledger.js'), 'utf8');

function harness() {
  const handlers = {};
  const root = {
    dataset: {}, innerHTML: '', setAttribute() {}, removeAttribute() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener(type, handler) { handlers[type] = handler; },
    contains() { return true; }, dispatchEvent() {}
  };
  const context = vm.createContext({
    console, window: {}, location: { hash: '', pathname: '/guangzhou-ledger.html' },
    document: { querySelector: () => root, addEventListener() {} },
    CustomEvent: class {},
    FormData: class {
      constructor(form) { this.values = form.values; }
      get(key) { return this.values[key] ?? ''; }
      getAll(key) { return this.values[key] || []; }
    }
  });
  vm.runInContext(source, context);
  let data = {
    settings: { baseCurrency: 'CNY', commonCurrencies: ['JPY'], lastCurrency: 'JPY' },
    travelers: [{ id: 'a', name: '测试甲' }, { id: 'b', name: '测试乙' }], bills: []
  };
  const repository = { mode: 'local', load: () => data, save: value => { data = value; } };
  return { root, handlers, api: context.window.TravelLedger, repository };
}

test('Guangzhou bills use CNY cents and split odd cents without introducing foreign currency', async () => {
  const h = harness();
  await h.api.init({ root: h.root, config: {}, tripId: 'guangzhou-shunde-macao-2026', fixedCurrency: 'CNY', repository: h.repository });
  const settings = h.api.getSnapshot().settings;
  assert.equal(settings.baseCurrency, 'CNY');
  assert.equal(settings.lastCurrency, 'CNY');
  assert.equal(settings.commonCurrencies.length, 0);
  assert.doesNotMatch(h.root.innerHTML, /data-ledger-dialog="settings"|data-ledger-dialog="currency"/);
  const form = {
    dataset: { ledgerForm: 'bill' }, elements: {}, querySelector: () => null,
    values: { currency: 'JPY', originalAmount: '100.01', payerId: 'a', participantIds: ['a', 'b'], category: '餐饮', note: '测试晚餐' },
    closest() { return this; }
  };
  await h.handlers.submit({ target: form, preventDefault() {} });
  const bill = h.api.getSnapshot().bills[0];
  assert.equal(bill.currency, 'CNY');
  assert.equal(bill.baseAmountCents, 10001);
  assert.equal(bill.originalAmountCents, 10001);
  h.api.setActiveTab('stats', { updateHash: false });
  assert.match(h.root.innerHTML, /50\.00/);
  assert.match(h.root.innerHTML, /50\.01/);
  const fresh = harness();
  await fresh.api.init({ root: fresh.root, config: {}, tripId: 'guangzhou-shunde-macao-2026', fixedCurrency: 'CNY', repository: h.repository });
  assert.equal(fresh.api.getSnapshot().bills[0].baseAmountCents, 10001);
});

test('existing trips retain their currency picker unless CNY-only mode is requested', async () => {
  const h = harness();
  await h.api.init({ root: h.root, config: {}, tripId: 'shanghai-japan-2026', repository: h.repository });
  assert.equal(h.api.getSnapshot().settings.lastCurrency, 'JPY');
  assert.match(h.root.innerHTML, /data-ledger-dialog="settings"/);
});

test('Guangzhou and Japan local ledgers keep separate records', async () => {
  const h = harness();
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const japan = h.api.createLocalStorageAdapter('shanghai-japan-2026', { storage });
  const guangzhou = h.api.createLocalStorageAdapter('guangzhou-shunde-macao-2026', { storage });
  await japan.save({ settings: {}, travelers: [{ id: 'j', name: '日本测试' }], bills: [] });
  const before = JSON.stringify(await japan.load());
  await guangzhou.save({ settings: {}, travelers: [{ id: 'g', name: '广州测试' }], bills: [] });
  assert.equal(JSON.stringify(await japan.load()), before);
  assert.equal((await guangzhou.load()).travelers[0].id, 'g');
});
