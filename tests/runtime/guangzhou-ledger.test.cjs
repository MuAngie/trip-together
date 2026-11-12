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
    contains() { return true; }, dispatchEvent(event) { handlers[event.type]?.(event); }
  };
  const context = vm.createContext({
    console, window: {}, location: { hash: '', pathname: '/guangzhou-ledger.html' },
    document: { querySelector: () => root, addEventListener() {} },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
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
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
async function loadStandalone(storage) {
  const h = harness();
  h.context.localStorage = storage;
  h.context.fetch = async () => ({ ok: true, json: async () => ({ ...standaloneBundle, config: { persistence: { mode: 'local' } } }) });
  h.context.document.getElementById = id => id === 'guangzhou-ledger-status' ? { textContent: '' } : h.root;
  vm.runInContext(storageSource, h.context);
  h.context.TravelRuntimeStorage = h.context.window.TravelRuntimeStorage;
  await vm.runInContext(standaloneSource, h.context);
  return h.api;
}

test('a fresh local ledger starts with five aliases and the two flight bills', async () => {
  const api = await loadStandalone(memoryStorage());
  const snapshot = api.getSnapshot();
  assert.equal(api.getPersistenceMode(), 'local');
  assert.deepEqual(Array.from(snapshot.travelers, person => person.name), ['1', '2', '3', '4', '5']);
  assert.deepEqual(Array.from(snapshot.bills, bill => bill.baseAmountCents).sort((a, b) => a - b), [322000, 380000]);
  const payer = snapshot.travelers.find(person => person.name === '1');
  assert.ok(snapshot.bills.every(bill => bill.payerId === payer.id && bill.participantIds.length === 5 && bill.currency === 'CNY'));
  assert.equal(snapshot.bills.reduce((sum, bill) => sum + bill.baseAmountCents, 0), 702000);
});

async function loadShared(storage, remote, passwords = []) {
  const h = harness();
  const events = {};
  const status = { textContent: '' };
  const sync = { hidden: true, addEventListener(type, fn) { events[type] = fn; } };
  const input = { value: '' };
  let prompts = 0;
  const dialog = {
    querySelector: selector => selector === 'input' ? input : selector === 'button' ? { addEventListener() {} } : { textContent: '' },
    showModal() {
      prompts += 1;
      input.value = passwords.shift() || '';
      this.returnValue = input.value ? 'confirm' : 'cancel';
      this.onclose();
    }
  };
  const writes = [];
  h.context.localStorage = storage;
  h.context.sessionStorage = memoryStorage();
  h.context.document.getElementById = id => ({
    'guangzhou-ledger-status': status, 'guangzhou-ledger-sync': sync,
    'guangzhou-editor-password': dialog, 'ledger-root': h.root
  })[id];
  h.context.fetch = async (url, init = {}) => {
    if (url === 'guangzhou-ledger-config.json') return { ok: true, json: async () => standaloneBundle };
    assert.match(url, /^\/api\/trip\/guangzhou-shunde-macao-2026\?/);
    if (remote.error) throw new Error('共享读取失败');
    if (init.method === 'POST') {
      writes.push(init);
      if (init.headers.authorization !== 'Bearer team-password') {
        return { ok: false, status: 401, json: async () => ({ error: '团队编辑密码不正确' }) };
      }
      for (const change of JSON.parse(init.body).changes) {
        remote[change.collection] = remote[change.collection].filter(row => row.id !== change.id);
        if (change.op === 'upsert') remote[change.collection].push(change.value);
      }
    }
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(remote)) };
  };
  vm.runInContext(storageSource, h.context);
  h.context.TravelRuntimeStorage = h.context.window.TravelRuntimeStorage;
  await vm.runInContext(standaloneSource, h.context);
  return { ...h, status, sync, events, writes, prompts: () => prompts };
}

test('shared Guangzhou ledger requires the server password before migrating actual local records', async () => {
  assert.equal(standaloneBundle.config.persistence.mode, 'd1');
  assert.deepEqual(standaloneBundle.config.persistence.sharedCollections, ['ledger']);
  const storage = memoryStorage();
  const local = await loadStandalone(storage);
  const edited = local.getSnapshot();
  edited.travelers[0].name = '保留姓名';
  edited.bills[0].note = '保留已修改的机票备注';
  const adapter = local.createLocalStorageAdapter(guangzhouTripId, { storage });
  await adapter.save(edited);
  const backup = JSON.stringify(await adapter.load());
  const remote = { settings: null, travelers: [], bills: [] };
  const h = await loadShared(storage, remote, ['wrong', 'team-password']);
  assert.equal(h.api.getPersistenceMode(), 'd1');
  assert.equal(h.api.getSnapshot().travelers[0].name, '保留姓名');
  assert.equal(h.writes.length, 0);
  assert.equal(h.sync.hidden, false);
  await h.events.click();
  assert.equal(h.prompts(), 2);
  assert.equal(h.writes.length, 2);
  assert.equal(h.sync.hidden, true);
  assert.equal(remote.travelers[0].name, '保留姓名');
  assert.equal(remote.bills[0].note, '保留已修改的机票备注');
  assert.equal(JSON.stringify(await adapter.load()), backup);
});

test('opening a shared ledger reads cloud records without prompting or overwriting them', async () => {
  const remote = { ...standaloneBundle.ledgerSeed, travelers: standaloneBundle.ledgerSeed.travelers.map(row => ({ ...row, name: '云端姓名' })) };
  const before = JSON.stringify(remote);
  const storage = memoryStorage();
  await loadStandalone(storage);
  const h = await loadShared(storage, remote);
  assert.equal(h.api.getSnapshot().travelers[0].name, '云端姓名');
  assert.equal(h.sync.hidden, true);
  assert.equal(h.prompts(), 0);
  assert.equal(h.writes.length, 0);
  assert.equal(JSON.stringify(remote), before);
});

test('Guangzhou bill entry collapses only after a successful save and stays closed on rerender', async () => {
  const remote = JSON.parse(JSON.stringify(standaloneBundle.ledgerSeed));
  const h = await loadShared(memoryStorage(), remote, ['team-password']);
  const entry = { open: true, dataset: { ledgerFold: 'entry' } };
  h.context.document.querySelector = () => entry;
  h.root.querySelectorAll = selector => selector === '[data-ledger-fold]' ? [entry] : [];
  const form = {
    dataset: { ledgerForm: 'bill' }, elements: {}, querySelector: () => null,
    values: { originalAmount: '100', payerId: remote.travelers[0].id,
      participantIds: remote.travelers.map(person => person.id), category: '餐饮', note: '测试晚餐' },
    closest() { return this; }
  };
  remote.error = true;
  await h.handlers.submit({ target: form, preventDefault() {} });
  assert.equal(entry.open, true);
  assert.equal(h.api.getSnapshot().bills.length, 2);
  delete remote.error;
  await h.handlers.submit({ target: form, preventDefault() {} });
  assert.equal(entry.open, false);
  assert.equal(h.api.getSnapshot().bills.length, 3);
  assert.match(h.root.innerHTML, /账单已保存/);
  h.api.setActiveTab('stats', { updateHash: false });
  assert.doesNotMatch(h.root.innerHTML, /data-ledger-fold="entry" open/);
});

test('cancelling password entry leaves shared and local records unchanged', async () => {
  const remote = { settings: null, travelers: [], bills: [] };
  const h = await loadShared(memoryStorage(), remote);
  await h.events.click();
  assert.equal(h.writes.length, 0);
  assert.equal(remote.bills.length, 0);
  assert.equal(h.sync.hidden, false);
  assert.match(h.status.textContent, /需要团队编辑密码/);
});

test('a cloud ledger populated after opening is not replaced by pending local migration', async () => {
  const remote = { settings: null, travelers: [], bills: [] };
  const h = await loadShared(memoryStorage(), remote, ['team-password']);
  remote.travelers = [{ id: 'new-cloud-person', name: '新云端成员' }];
  await h.events.click();
  assert.equal(h.writes.length, 0);
  assert.equal(remote.travelers[0].name, '新云端成员');
  assert.match(h.status.textContent, /未覆盖云端账目/);
});

test('cloud read failure does not open an editable local fallback', async () => {
  const h = await loadShared(memoryStorage(), { error: true });
  assert.equal(h.root.innerHTML, '');
  assert.match(h.status.textContent, /共享读取失败/);
  assert.equal(h.writes.length, 0);
});

test('clearing a previously shared ledger does not restore old local bills', async () => {
  const storage = memoryStorage();
  await loadStandalone(storage);
  storage.setItem(`${guangzhouTripId}:shared-initialized`, '1');
  const h = await loadShared(storage, { settings: null, travelers: [], bills: [] });
  assert.equal(h.api.getSnapshot().bills.length, 0);
  assert.equal(h.sync.hidden, true);
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
