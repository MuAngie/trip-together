const radians = value => value * Math.PI / 180;

export function distanceMeters(a, b) {
  const lat = Math.sin(radians(b.lat - a.lat) / 2);
  const lng = Math.sin(radians(b.lng - a.lng) / 2);
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(lat * lat + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * lng * lng)));
}

function formatDistance(meters) {
  return meters < 1000 ? `约 ${Math.round(meters / 50) * 50} 米` : `约 ${(meters / 1000).toFixed(meters < 5000 ? 1 : 0)} 公里`;
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function drawMap(region, places, route) {
  const source = route || region;
  const image = make('img');
  image.src = source.image;
  image.width = source.imageWidth;
  image.height = source.imageHeight;
  image.loading = 'lazy';
  image.alt = `${region.name}${route ? route.name : '景点分布'}静态地图，含街道、河流与景点标注：${places.map(place => place.name).join('、')}。`;
  const link = make('a', 'map-image');
  link.href = source.image;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `查看${region.name}${route ? route.name : '景点分布'}地图大图（新窗口）`);
  link.append(image);
  return link;
}

function mountMap(region) {
  const panel = document.getElementById(`sights-${region.id}`);
  if (!panel) return;
  region.places.forEach((place, index) => { place.number = index + 1; });
  const root = make('details', 'region-map');
  root.open = true;
  const summary = make('summary', '', '景点位置与顺游');
  summary.append(make('span', '', '区域示意'));
  const content = make('div', 'region-map-content');
  const controls = make('div', 'map-groups');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', `${region.name}顺游小组`);
  const scene = make('div', 'map-scene');
  const info = make('div', 'map-route-info');
  info.setAttribute('aria-live', 'polite');
  const groups = [null, ...region.routes];
  const buttons = groups.map(route => {
    const button = make('button', '', route ? route.name : '全部景点');
    button.type = 'button';
    button.addEventListener('click', () => render(route));
    controls.append(button);
    return button;
  });
  function render(route) {
    buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(groups[index] === route)));
    const places = route ? route.stops.map(id => region.places.find(place => place.id === id)) : region.places;
    const key = make('ol', `map-key${route ? ' map-key-route' : ''}`);
    key.setAttribute('aria-label', route ? '建议游览顺序与直线距离' : '图中地点，点击打开高德地图');
    places.forEach((place, index) => {
      const item = make('li');
      const link = make('a');
      link.href = `https://uri.amap.com/search?keyword=${encodeURIComponent(place.name.replace(/（.*?）/g, ''))}&city=${encodeURIComponent(region.name)}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.append(make('span', 'map-key-number', String(place.number)), make('span', '', place.name.replace(/（.*?）/g, '')), make('span', 'map-key-link', '↗'));
      item.append(link);
      if (route && index < places.length - 1) item.append(make('small', 'map-distance', `↓ ${formatDistance(distanceMeters(place, places[index + 1]))} · 直线`));
      key.append(item);
    });
    scene.replaceChildren(drawMap(region, places, route), key);
    info.replaceChildren();
    if (route) info.append(make('p', 'map-route-mode', route.mode), make('p', '', route.tip));
    else info.append(make('p', '', region.overview));
  }
  const caption = make('p', 'map-caption', '点地图查看大图。虚线仅示意串联顺序，距离为直线估算，实际路程以导航为准。');
  const notes = make('details', 'map-notes');
  notes.append(make('summary', '', '位置说明与资料来源'), make('p', '', region.note));
  const sources = make('p', 'map-sources');
  [...region.places.map(place => ({ label: `${place.number} ${place.name}`, url: place.source })), ...region.references].forEach(source => {
    const link = make('a', '', source.label);
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    sources.append(link);
  });
  notes.append(sources);
  const credit = make('p', 'map-credit', '地图数据 © ');
  const copyright = make('a', '', 'OpenStreetMap contributors');
  copyright.href = 'https://www.openstreetmap.org/copyright';
  copyright.target = '_blank';
  copyright.rel = 'noopener noreferrer';
  credit.append(copyright);
  content.append(controls, scene, info, caption, credit, notes);
  root.append(summary, content);
  panel.querySelector('h3').after(root);
  render(null);
}

if (typeof document !== 'undefined') {
  fetch('guangzhou-region-maps.json?v=20261102-2')
    .then(response => { if (!response.ok) throw new Error('Map data unavailable'); return response.json(); })
    .then(data => data.regions.forEach(mountMap))
    .catch(() => {
      document.querySelectorAll('#catalog-sights > .region-panel > h3').forEach(heading => heading.after(make('p', 'map-caption', '位置示意图暂未载入，请刷新后重试。')));
    });
}
