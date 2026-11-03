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
  return { root, handlers, api: context.window.TravelLedger, repository, context };
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

const standaloneSource = fs.readFileSync(path.join(__dirname, '../../dist/guangzhou-ledger.js'), 'utf8');
const storageSource = fs.readFileSync(path.join(__dirname, '../../dist/runtime-storage.js'), 'utf8');
const standaloneBundle = JSON.parse(fs.readFileSync(path.join(__dirname, '../../dist/guangzhou-ledger-config.json'), 'utf8'));
const guangzhouTripId = 'guangzhou-shunde-macao-2026';
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}
async function loadStandalone(storage) {
  const h = harness();
  h.context.localStorage = storage;
  h.context.fetch = async () => ({ ok: true, json: async () => standaloneBundle });
  h.context.document.getElementById = id => id === 'guangzhou-ledger-status' ? { textContent: '' } : h.root;
  vm.runInContext(storageSource, h.context);
  h.context.TravelRuntimeStorage = h.context.window.TravelRuntimeStorage;
  await vm.runInContext(standaloneSource, h.context);
  return h.api;
}

test('a fresh published local ledger starts with five aliases and the two flight bills', async () => {
  assert.equal(standaloneBundle.config.persistence.mode, 'local');
  const api = await loadStandalone(memoryStorage());
  const snapshot = api.getSnapshot();
  assert.equal(api.getPersistenceMode(), 'local');
  assert.deepEqual(Array.from(snapshot.travelers, person => person.name), ['1', '2', '3', '4', '5']);
  assert.deepEqual(Array.from(snapshot.bills, bill => bill.baseAmountCents).sort((a, b) => a - b), [322000, 380000]);
  const payer = snapshot.travelers.find(person => person.name === '1');
  assert.ok(snapshot.bills.every(bill => bill.payerId === payer.id && bill.participantIds.length === 5 && bill.currency === 'CNY'));
  assert.equal(snapshot.bills.reduce((sum, bill) => sum + bill.baseAmountCents, 0), 702000);
});

test('reopening the published ledger preserves names, bill edits, and existing identities', async () => {
  const storage = memoryStorage();
  const first = await loadStandalone(storage);
  const edited = first.getSnapshot();
  edited.travelers[0].name = '新名字';
  edited.bills[0].note = '修改后的备注';
  const adapter = first.createLocalStorageAdapter(guangzhouTripId, { storage });
  await adapter.save(edited);
  const reopened = (await loadStandalone(storage)).getSnapshot();
  assert.equal(reopened.travelers[0].name, '新名字');
  assert.equal(reopened.travelers[0].id, edited.travelers[0].id);
  assert.equal(reopened.bills[0].note, '修改后的备注');
  assert.equal(reopened.bills.length, 2);
});

test('deleting all local records does not restore the initial flight bills on reload', async () => {
  const storage = memoryStorage();
  const first = await loadStandalone(storage);
  const cleared = { ...first.getSnapshot(), travelers: [], bills: [] };
  await first.createLocalStorageAdapter(guangzhouTripId, { storage }).save(cleared);
  const reopened = (await loadStandalone(storage)).getSnapshot();
  assert.equal(reopened.travelers.length, 0);
  assert.equal(reopened.bills.length, 0);
});
