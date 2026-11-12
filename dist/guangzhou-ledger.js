(async () => {
  const status = document.getElementById('guangzhou-ledger-status');
  try {
    const response = await fetch('guangzhou-ledger-config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('记账配置读取失败，请刷新重试。');
    const { config, ledgerSeed } = await response.json();
    const tripId = 'guangzhou-shunde-macao-2026';
    const syncButton = document.getElementById('guangzhou-ledger-sync');
    let repository;
    let pendingSync = false;
    const sharedStatus = '团队共享账本 · 人民币结算，编辑时使用与日本旅行相同的团队密码。';
    if (config.persistence.mode === 'd1') {
      const dialog = document.getElementById('guangzhou-editor-password');
      const password = dialog.querySelector('input');
      dialog.querySelector('button').addEventListener('click', () => dialog.close('cancel'));
      const prompt = message => new Promise(resolve => {
        dialog.querySelector('p').textContent = message;
        dialog.returnValue = '';
        password.value = '';
        dialog.onclose = () => {
          const value = dialog.returnValue === 'confirm' ? password.value : '';
          password.value = '';
          resolve(value);
        };
        dialog.showModal();
      });
      const cloud = window.TravelRuntimeStorage.createD1Adapter({
        tripId, apiBase: config.persistence.apiBase,
        collections: ['settings', 'travelers', 'bills'], prompt
      });
      const remote = await cloud.load();
      const local = await window.TravelRuntimeStorage.createLocalAdapter({
        tripId, collections: ['settings', 'travelers', 'bills']
      }).load();
      const marker = `${tripId}:shared-initialized`;
      const hasRecords = data => data.travelers.length || data.bills.length;
      const rememberShared = () => {
        try { localStorage.setItem(marker, '1'); } catch {}
      };
      let initialized = false;
      try { initialized = localStorage.getItem(marker) === '1'; } catch {}
      if (hasRecords(remote)) rememberShared();
      const candidate = local.settings || hasRecords(local) ? local : ledgerSeed;
      pendingSync = !hasRecords(remote) && !initialized && Boolean(candidate && hasRecords(candidate));
      repository = {
        mode: 'd1',
        load: async () => pendingSync ? candidate : remote,
        async save(next) {
          try {
            if (pendingSync && hasRecords(await cloud.load())) {
              throw new Error('共享账本已有数据，请刷新后查看；未覆盖云端账目。');
            }
            const saved = await cloud.save(next);
            pendingSync = false;
            rememberShared();
            syncButton.hidden = true;
            status.textContent = sharedStatus;
            return saved;
          } catch (error) {
            status.textContent = error.message || '共享账本保存失败，请重试。';
            throw error;
          }
        }
      };
      syncButton.hidden = !pendingSync;
      syncButton.textContent = hasRecords(local) ? '同步本机账目' : '初始化共享账本';
      syncButton.addEventListener('click', async () => {
        syncButton.disabled = true;
        try { await repository.save(window.TravelLedger.getSnapshot()); }
        catch { /* Keep the original local snapshot and allow retry. */ }
        finally { syncButton.disabled = false; }
      });
    }
    if (config.persistence.mode === 'local' && ledgerSeed) {
      const adapter = window.TravelRuntimeStorage.createLocalAdapter({
        tripId, collections: ['settings', 'travelers', 'bills']
      });
      const saved = await adapter.load();
      if (!saved.settings && !saved.travelers.length && !saved.bills.length) {
        await adapter.save({ ...saved, ...ledgerSeed });
      }
    }
    await window.TravelLedger.init({
      root: '#ledger-root', tripId,
      fixedCurrency: 'CNY', config, ...(repository ? { repository } : {})
    });
    document.getElementById('ledger-root').addEventListener('travel-ledger:changed', event => {
      if (!['bill-added', 'bill-updated'].includes(event.detail.reason)) return;
      const entry = document.querySelector('#ledger-root [data-ledger-fold="entry"]');
      if (entry) entry.open = false;
    });
    const shared = window.TravelLedger.getPersistenceMode() === 'd1';
    status.textContent = shared
      ? pendingSync ? '账目尚未同步，输入团队密码后可同步到共享账本。本机原账目保留。' : sharedStatus
      : '本机账本 · 人民币结算，账目保存在当前浏览器。';
  } catch (error) {
    status.textContent = error.message || '账本暂时无法载入，请刷新重试。';
    document.getElementById('ledger-root').removeAttribute('aria-busy');
  }
})();
