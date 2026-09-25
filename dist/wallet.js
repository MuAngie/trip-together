(() => {
  "use strict";

  const INITIALIZED_ID = "wallet-initialized-v1";
  const KINDS = { expense: "集体支出", contribution: "家庭缴款", refund: "商家退款", return: "退还家庭" };
  const CATEGORIES = ["餐饮", "交通", "住宿", "门票", "购物", "其他"];
  const money = (amount) => `${amount.toLocaleString("zh-CN")} 日元`;
  const escape = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);

  function validateEntry(entry, families) {
    if (!Object.hasOwn(KINDS, entry.kind)) throw new Error("请选择收支类型。");
    if (entry.currency !== "JPY" || !Number.isSafeInteger(entry.amountYen) || entry.amountYen <= 0) {
      throw new Error("请输入大于 0 的整数日元金额。");
    }
    if (["contribution", "return"].includes(entry.kind) && !families.some((family) => family.id === entry.familyId)) {
      throw new Error("请选择缴款或收款的家庭。");
    }
    if (typeof entry.note !== "string" || entry.note.length > 160) throw new Error("用途请控制在 160 字以内。");
    if (typeof entry.date !== "string" || (entry.date && (
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || Number.isNaN(Date.parse(entry.date))
      || new Date(entry.date).toISOString().slice(0, 10) !== entry.date
    ))) throw new Error("请填写有效日期，未知日期可留空。");
    return entry;
  }

  function calculate(entries, families) {
    const totals = { contribution: 0, expense: 0, refund: 0, return: 0 };
    const members = families.map((family) => ({ ...family, contributed: 0, returned: 0 }));
    for (const entry of entries) {
      if (entry.id === INITIALIZED_ID) continue;
      validateEntry(entry, families);
      totals[entry.kind] += entry.amountYen;
      const member = members.find((family) => family.id === entry.familyId);
      if (entry.kind === "contribution") member.contributed += entry.amountYen;
      if (entry.kind === "return") member.returned += entry.amountYen;
    }
    const netExpense = totals.expense - totals.refund;
    const baseShare = Math.floor(netExpense / families.length);
    const remainder = netExpense - baseShare * families.length;
    members.forEach((member, index) => {
      member.share = baseShare + (index < remainder ? 1 : 0);
      member.remaining = member.contributed - member.returned - member.share;
    });
    return { ...totals, netExpense, balance: totals.contribution - netExpense - totals.return, members };
  }

  async function initializeLocal(adapter, entries) {
    const snapshot = await adapter.load();
    if (!snapshot.walletEntries.some((entry) => entry.id === INITIALIZED_ID)) {
      const existingIds = new Set(snapshot.walletEntries.map((entry) => entry.id));
      snapshot.walletEntries.push(...entries.filter((entry) => !existingIds.has(entry.id)));
      await adapter.save(snapshot);
    }
    return snapshot;
  }

  async function init({ data, config }) {
    const root = document.querySelector("#wallet-root");
    if (!root || !data.walletSeed) return;
    const families = data.walletSeed.families;
    const shared = config.persistence.mode === "d1" && config.persistence.sharedCollections.includes("ledger");
    const adapter = window.TravelRuntimeStorage.createAdapter({
      tripId: data.metadata.tripId, mode: shared ? "d1" : "local",
      apiBase: config.persistence.apiBase, collections: ["walletEntries"]
    });
    let entries = [];
    let editingId = null;
    let draftId = `wallet-${crypto.randomUUID()}`;
    let loaded = false;
    let busy = false;
    let notice = "";
    const familyName = (id) => families.find((family) => family.id === id)?.name || "";
    const today = () => new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());

    function acceptSnapshot(snapshot) {
      if (!snapshot.walletEntries.some((entry) => entry.id === INITIALIZED_ID)) {
        throw new Error("初始缴款记录尚未就绪，请联系管理者完成设置后刷新。行前费用仍可查看。");
      }
      calculate(snapshot.walletEntries, families);
      entries = snapshot.walletEntries;
      loaded = true;
    }

    function render() {
      const recordsOpen = root.querySelector(".wallet-records")?.open || false;
      const stats = loaded ? calculate(entries, families) : null;
      const editing = entries.find((entry) => entry.id === editingId);
      const records = entries.filter((entry) => entry.id !== INITIALIZED_ID)
        .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      root.innerHTML = `
        <section class="wallet" aria-labelledby="wallet-title">
          <header class="wallet-header"><h2 id="wallet-title">资金概览</h2>
            <button type="button" data-wallet-action="refresh">刷新</button></header>
          <p class="wallet-mode">${shared ? "团队共享账本" : "本机预览 · 修改仅保存在当前浏览器"} · 日元专用</p>
          <p class="wallet-notice" role="status">${escape(notice)}</p>
          ${stats ? `
            <dl class="wallet-totals">
              <div class="wallet-balance"><dt>公共资金余额</dt><dd>${money(stats.balance)}</dd></div>
              <div><dt>累计缴款</dt><dd>${money(stats.contribution)}</dd></div>
              <div><dt>集体支出（扣除退款）</dt><dd>${money(stats.netExpense)}</dd></div>
              ${stats.return ? `<div><dt>已退还家庭</dt><dd>${money(stats.return)}</dd></div>` : ""}
            </dl>
            ${stats.balance < 0 ? '<p class="wallet-warning">账面余额不足，请核对流水或登记追加缴款。</p>' : ""}
            <form id="wallet-form" class="wallet-form">
              <h2>${editing ? "修改这笔收支" : "记一笔"}</h2>
              <label>类型<select name="kind">${Object.entries(KINDS).map(([kind, label]) => `<option value="${kind}" ${kind === (editing?.kind || "expense") ? "selected" : ""}>${label}</option>`).join("")}</select></label>
              <label>金额（日元）<input name="amount" type="text" inputmode="numeric" autocomplete="off" placeholder="例如 18000" required value="${editing?.amountYen || ""}"></label>
              <label data-wallet-family>家庭<select name="familyId">${families.map((family) => `<option value="${escape(family.id)}" ${family.id === editing?.familyId ? "selected" : ""}>${escape(family.name)} 家</option>`).join("")}</select></label>
              <label data-wallet-category>分类<select name="category">${CATEGORIES.map((category) => `<option ${category === editing?.category ? "selected" : ""}>${category}</option>`).join("")}</select></label>
              <label>用途 / 备注<input name="note" maxlength="160" placeholder="例如：京都集体晚餐" value="${escape(editing?.note || "")}"></label>
              <label>日期（未知可留空）<input name="date" type="date" value="${escape(editing ? editing.date : today())}"></label>
              <p class="wallet-help" data-wallet-help></p>
              <p class="wallet-error" role="alert"></p>
              <div class="wallet-actions"><button class="wallet-primary" type="submit">${editing ? "保存修改" : "保存这笔收支"}</button>
                ${editing ? '<button type="button" data-wallet-action="cancel">取消</button>' : ""}</div>
            </form>
            <details class="wallet-details"><summary>家庭缴款与结余</summary>
              <p class="wallet-help">所有公共支出由三家均摊。以下为按当前支出估算的应退 / 应补金额，实际退钱需另记“退还家庭”。不足 3 日元的尾数按家庭显示顺序分配。</p>
              ${stats.members.map((member) => `<div class="wallet-family"><h3>${escape(member.name)} 家</h3><dl>
                <div><dt>已缴款</dt><dd>${money(member.contributed)}</dd></div>
                <div><dt>已分摊支出</dt><dd>${money(member.share)}</dd></div>
                <div><dt>已退还</dt><dd>${money(member.returned)}</dd></div>
                <div><dt>${member.remaining >= 0 ? "预计可退" : "预计需补"}</dt><dd>${money(Math.abs(member.remaining))}</dd></div>
              </dl></div>`).join("")}
            </details>
            <details class="wallet-records" ${recordsOpen ? "open" : ""}><summary>收支明细 <small>${records.length} 笔</small></summary>
              ${records.length ? records.map((entry) => `<article class="wallet-record">
                <div><strong>${escape(entry.note || KINDS[entry.kind])}</strong><p>${escape(KINDS[entry.kind])}${entry.familyId ? ` · ${escape(familyName(entry.familyId))} 家` : ""}${entry.category ? ` · ${escape(entry.category)}` : ""}</p><p>${escape(entry.date || "日期待补充")}</p></div>
                <div class="wallet-record-amount"><b>${["contribution", "refund"].includes(entry.kind) ? "+" : "−"}${money(entry.amountYen)}</b>
                  <div class="wallet-actions"><button type="button" data-wallet-action="edit" data-id="${escape(entry.id)}" aria-label="修改${escape(entry.note || KINDS[entry.kind])}">修改</button><button type="button" data-wallet-action="delete" data-id="${escape(entry.id)}" aria-label="删除${escape(entry.note || KINDS[entry.kind])}">删除</button></div>
                </div></article>`).join("") : '<p class="wallet-help">还没有收支记录。</p>'}
            </details>` : '<p class="wallet-help">余额暂不可用。请刷新重试，当前无法新增收支。</p>'}
        </section>`;
      updateFields();
    }

    function updateFields() {
      const form = root.querySelector("#wallet-form");
      if (!form) return;
      const kind = form.elements.kind.value;
      const familyTransaction = ["contribution", "return"].includes(kind);
      form.querySelector("[data-wallet-family]").hidden = !familyTransaction;
      form.querySelector("[data-wallet-category]").hidden = kind !== "expense";
      form.querySelector("[data-wallet-help]").textContent = {
        expense: "从公共钱包扣款，默认三家均摊。人民币行前费用请在下方独立记账。",
        contribution: "家庭交入公共钱包的钱，增加余额，不算旅行消费。",
        refund: "商家实际退回公共钱包的钱，增加余额并冲减集体支出。",
        return: "实际退还给某一家的钱，减少余额，不重复计入消费。"
      }[kind];
    }

    function lock(value) {
      busy = value;
      root.setAttribute("aria-busy", String(value));
      root.querySelectorAll("button, input, select").forEach((element) => { element.disabled = value; });
    }

    async function refresh() {
      lock(true);
      try {
        acceptSnapshot(shared ? await adapter.load() : await initializeLocal(adapter, data.walletSeed.entries));
        notice = "已读取最新账目。";
      } catch (error) {
        loaded = false;
        notice = `读取失败：${error.message}`;
      } finally {
        render();
        lock(false);
      }
    }

    root.addEventListener("change", updateFields);
    root.addEventListener("submit", async (event) => {
      if (event.target.id !== "wallet-form") return;
      event.preventDefault();
      if (busy || !loaded) return;
      const form = event.target;
      const fields = new FormData(form);
      const old = entries.find((entry) => entry.id === editingId);
      const kind = fields.get("kind");
      const amountText = String(fields.get("amount")).trim().replace(/,/g, "");
      const entry = {
        id: editingId || draftId, kind, currency: "JPY",
        amountYen: /^\d+$/.test(amountText) ? Number(amountText) : NaN,
        familyId: ["contribution", "return"].includes(kind) ? fields.get("familyId") : "",
        category: kind === "expense" ? fields.get("category") : "",
        note: String(fields.get("note")).trim(), date: fields.get("date"),
        createdAt: old?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      try {
        validateEntry(entry, families);
        lock(true);
        acceptSnapshot(await adapter.applyChange("walletEntries", entry));
        editingId = null;
        draftId = `wallet-${crypto.randomUUID()}`;
        notice = "已保存，公共钱包余额已更新。";
        render();
      } catch (error) {
        form.querySelector(".wallet-error").textContent = `未保存：${error.message}`;
      } finally {
        lock(false);
      }
    });

    root.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-wallet-action]");
      if (!button || busy) return;
      const action = button.dataset.walletAction;
      if (action === "refresh") {
        const form = root.querySelector("#wallet-form");
        if (form?.elements.amount.value && !window.confirm("刷新会清除尚未保存的输入，继续吗？")) return;
        editingId = null;
        await refresh();
      } else if (action === "edit" || action === "cancel") {
        editingId = action === "edit" ? button.dataset.id : null;
        render();
        root.querySelector('[name="amount"]').focus();
      } else if (action === "delete") {
        const entry = entries.find((record) => record.id === button.dataset.id);
        if (!window.confirm(`删除“${entry.note || KINDS[entry.kind]}” ${money(entry.amountYen)}？余额将重新计算。`)) return;
        lock(true);
        try {
          acceptSnapshot(await adapter.applyChange("walletEntries", entry.id, "delete"));
          editingId = null;
          notice = "已删除，公共钱包余额已更新。";
          render();
        } catch (error) {
          root.querySelector(".wallet-notice").textContent = `删除失败：${error.message}`;
        } finally {
          lock(false);
        }
      }
    });
    await refresh();
  }

  const api = { calculate, validateEntry, initializeLocal, init };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.TravelWallet = api;
})();
