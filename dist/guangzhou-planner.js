(() => {
  const make = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  const button = (text, action) => {
    const node = make('button', 'planner-button', text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  const days = [...document.querySelectorAll('.day-panel')].map(panel => ({
    id: panel.id, panel,
    date: panel.querySelector('time').dateTime.slice(5).replace('-', '/'),
    city: panel.querySelector('.day-route').textContent
  }));
  const sights = new Map([...document.querySelectorAll('.sight-card')].map(card => {
    const img = card.querySelector('img');
    return [img.getAttribute('src').split('/').pop().replace('.jpg', ''), {
      card, img, name: card.querySelector('h4').textContent,
      description: card.querySelector('.sight-copy p').textContent
    }];
  }));
  const storageKey = 'guangzhou-2026-itinerary-v1';
  const saveNote = make('p', 'planner-save-note', '自动保存在此浏览器，其他设备不会同步。');
  document.getElementById('itinerary-title').after(saveNote);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; }
  catch { saveNote.textContent = '暂时无法读取已保存的安排，请保留此页面。'; }
  const plan = Object.fromEntries(days.map(day => {
    const seen = new Set();
    const entries = (Array.isArray(saved[day.id]) ? saved[day.id] : []).filter(entry => {
      if (!entry || !sights.has(entry.id) || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    }).map(entry => ({ id: entry.id, time: /^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time) ? entry.time : '' }));
    return [day.id, entries];
  }));
  let activeDay = days[0];
  let removed = null;
  const notice = make('div', 'planner-notice');
  notice.hidden = true;
  const message = make('span');
  message.setAttribute('role', 'status');
  const undo = button('撤销', () => {
    if (!removed) return;
    const { day, entry, index } = removed;
    if (!plan[day.id].some(item => item.id === entry.id)) plan[day.id].splice(index, 0, entry);
    removed = null;
    refresh();
    announce(`已恢复到 ${day.date}`);
    undo.hidden = true;
    showDay(day);
    day.panel.querySelector('.plan-list').focus();
  });
  undo.hidden = true;
  const dismiss = button('关闭', () => { notice.hidden = true; });
  notice.append(message, undo, dismiss);
  document.querySelector('main').append(notice);
  function announce(text) {
    notice.hidden = false;
    message.textContent = text;
    undo.hidden = true;
  }
  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(plan));
      saveNote.textContent = '已保存在此浏览器，其他设备不会同步。';
    } catch {
      saveNote.textContent = '保存失败，刷新或关闭页面会丢失本次修改。';
    }
  }
  const dateTabs = document.querySelector('.date-tabs');
  days.forEach(day => {
    const tab = button(day.date, () => {});
    tab.id = `tab-${day.id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', day.id);
    tab.append(make('span', '', day.city));
    dateTabs.append(tab);
    day.tab = tab;
    const timeline = day.panel.querySelector('.day-timeline');
    const flight = day.id === 'day-1126' ? '去程 · 上海直飞广州，航班时间待补充。' : day.id === 'day-1203' ? '返程 · 13:30 澳门返回上海' : '';
    if (flight) timeline.before(make('p', 'plan-transport', flight));
    day.list = make('ol', 'plan-list');
    day.list.tabIndex = -1;
    day.list.setAttribute('aria-label', `${day.date} 的景点安排`);
    timeline.replaceWith(day.list);
    day.add = button('＋ 添加景点', () => {
      const region = day.city.includes('澳门') ? 'macao' : day.city.includes('顺德') ? 'shunde' : 'guangzhou';
      document.getElementById(`tab-${region}`).click();
      const heading = document.getElementById('sights-title');
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'start' });
    });
    day.add.classList.add('plan-add');
    day.panel.append(day.add);
  });
  document.getElementById('sights-title').tabIndex = -1;
  const catalogContext = make('div', 'catalog-context');
  const targetLabel = make('span');
  catalogContext.append(targetLabel, button('查看当天 ↑', () => {
    activeDay.panel.scrollIntoView({ block: 'start' });
    activeDay.list.focus({ preventScroll: true });
  }));
  document.getElementById('sights-title').after(catalogContext);
  sights.forEach((sight, id) => {
    sight.add = button('', () => {
      if (plan[activeDay.id].some(entry => entry.id === id)) return;
      plan[activeDay.id].push({ id, time: '' });
      refresh();
      announce(`${sight.name}已加入 ${activeDay.date}`);
    });
    sight.add.classList.add('sight-add');
    sight.card.querySelector('.sight-copy').append(sight.add);
  });
  function renderDay(day) {
    day.list.replaceChildren();
    if (!plan[day.id].length) day.list.append(make('li', 'plan-empty', '还未安排景点，从下方挑选加入。'));
    plan[day.id].forEach((entry, index) => {
      const sight = sights.get(entry.id);
      const row = make('li', 'plan-stop');
      const photo = sight.img.cloneNode();
      photo.alt = '';
      const content = make('div', 'plan-stop-copy');
      const heading = make('h4', '', sight.name);
      heading.tabIndex = -1;
      const timeLabel = make('label', 'plan-time', '时间（选填）');
      const time = make('input');
      time.type = 'time';
      time.value = entry.time;
      time.setAttribute('aria-label', `${sight.name}的时间（选填）`);
      time.addEventListener('change', () => { entry.time = time.value; save(); });
      timeLabel.append(time);
      content.append(heading, make('p', '', sight.description));
      const actions = make('details', 'plan-actions');
      const summary = make('summary', '', '操作');
      summary.setAttribute('aria-label', `${sight.name}的操作`);
      actions.append(summary);
      const tools = make('div', 'plan-tools');
      const order = make('div', 'plan-order');
      [-1, 1].forEach(offset => {
        const control = button(offset < 0 ? '上移' : '下移', () => {
          const entries = plan[day.id];
          [entries[index], entries[index + offset]] = [entries[index + offset], entries[index]];
          refresh();
          day.list.children[index + offset].querySelector('summary').focus();
          announce(`${sight.name}已${offset < 0 ? '上移' : '下移'}`);
        });
        control.disabled = index + offset < 0 || index + offset >= plan[day.id].length;
        order.append(control);
      });
      const moveLabel = make('label', 'plan-move', '改日期');
      const select = make('select');
      select.setAttribute('aria-label', `将${sight.name}移到其他日期`);
      const placeholder = make('option', '', '选择日期');
      placeholder.value = '';
      select.append(placeholder);
      days.filter(target => target !== day).forEach(target => {
        const exists = plan[target.id].some(item => item.id === entry.id);
        const option = make('option', '', `${target.date} ${target.city}${exists ? '（已添加）' : ''}`);
        option.value = target.id;
        option.disabled = exists;
        select.append(option);
      });
      select.addEventListener('change', () => {
        const target = days.find(item => item.id === select.value);
        if (!target || plan[target.id].some(item => item.id === entry.id)) return;
        plan[day.id].splice(index, 1);
        plan[target.id].push(entry);
        refresh();
        day.add.focus();
        announce(`${sight.name}已移到 ${target.date}`);
      });
      moveLabel.append(select);
      tools.append(order, moveLabel, timeLabel);
      actions.append(tools);
      const remove = button('移除', () => {
        removed = { day, entry, index };
        plan[day.id].splice(index, 1);
        refresh();
        announce(`已从 ${day.date} 移除${sight.name}`);
        undo.hidden = false;
        day.add.focus();
      });
      remove.classList.add('plan-remove');
      row.append(photo, content, actions, remove);
      day.list.append(row);
    });
  }
  function updateCatalog() {
    targetLabel.textContent = `添加到 ${activeDay.date} · ${activeDay.city}`;
    sights.forEach((sight, id) => {
      const added = plan[activeDay.id].some(entry => entry.id === id);
      sight.add.textContent = added ? '✓ 当天已添加' : `＋ 加入 ${activeDay.date}`;
      sight.add.setAttribute('aria-disabled', String(added));
    });
  }
  function refresh() { days.forEach(renderDay); updateCatalog(); save(); }
  function showDay(day) { day.tab.click(); }
  document.querySelectorAll('[role="tablist"]').forEach(tablist => {
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    function selectTab(selected) {
      tabs.forEach(tab => {
        const active = tab === selected;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
      });
      if (tablist === dateTabs) {
        activeDay = days.find(day => day.tab === selected);
        updateCatalog();
      }
    }
    tabs.forEach((tab, index) => {
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panel.tabIndex = 0;
      tab.addEventListener('click', () => selectTab(tab));
      tab.addEventListener('keydown', event => {
        const targets = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 };
        if (!(event.key in targets)) return;
        event.preventDefault();
        selectTab(tabs[targets[event.key]]);
        tabs[targets[event.key]].focus();
      });
    });
    selectTab(tabs[0]);
    tablist.hidden = false;
  });
  days.forEach(renderDay);
})();
