(async () => {
  const status = document.getElementById('guangzhou-ledger-status');
  try {
    const response = await fetch('guangzhou-ledger-config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('记账配置读取失败，请刷新重试。');
    const { config } = await response.json();
    await window.TravelLedger.init({
      root: '#ledger-root', tripId: 'guangzhou-shunde-macao-2026',
      fixedCurrency: 'CNY', config
    });
    const shared = window.TravelLedger.getPersistenceMode() === 'd1';
    status.textContent = shared
      ? '团队共享账本 · 人民币结算，编辑时使用团队密码。'
      : '本机预览 · 人民币结算，账目保存在当前浏览器。';
  } catch (error) {
    status.textContent = error.message || '账本暂时无法载入，请刷新重试。';
    document.getElementById('ledger-root').removeAttribute('aria-busy');
  }
})();
