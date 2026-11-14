import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { distanceMeters } from '../../dist/guangzhou-region-maps.js';

test('region distances use geographic meters, including short walking clusters', () => {
  assert.ok(Math.abs(distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 111195) < 1);
  assert.equal(distanceMeters({ lat: 23, lng: 113 }, { lat: 23, lng: 113 }), 0);
  const data = JSON.parse(readFileSync(new URL('../../dist/guangzhou-region-maps.json', import.meta.url)));
  const macao = data.regions.find(region => region.id === 'macao');
  const [senado, dominic, paul] = macao.routes[0].stops.map(id => macao.places.find(place => place.id === id));
  assert.ok(distanceMeters(senado, dominic) < 200);
  assert.ok(distanceMeters(dominic, paul) > 250 && distanceMeters(dominic, paul) < 400);
});

test('maps cover fixed catalog locations and every route references its own region', () => {
  const data = JSON.parse(readFileSync(new URL('../../dist/guangzhou-region-maps.json', import.meta.url)));
  const html = readFileSync(new URL('../../dist/guangzhou-2026.html', import.meta.url), 'utf8');
  const sightIds = [
    ...html.matchAll(/src="assets\/guangzhou-2026\/([\w-]+)\.jpg"/g),
    ...html.matchAll(/data-sight-id="([\w-]+)"/g)
  ].map(match => match[1]);
  const mappedIds = data.regions.flatMap(region => region.places.map(place => place.id));
  assert.deepEqual(data.regions.map(region => region.id), ['guangzhou', 'shunde', 'macao']);
  assert.equal(data.coordinateSystem, 'WGS84');
  assert.deepEqual(sightIds.filter(id => !mappedIds.includes(id)).sort(), ['cotai', 'pearl-river']);
  assert.deepEqual(mappedIds.filter(id => !sightIds.includes(id)), ['huacheng']);
  for (const region of data.regions) {
    const ids = region.places.map(place => place.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const place of region.places) {
      assert.ok(place.lat > 22 && place.lat < 24 && place.lng > 113 && place.lng < 114);
      assert.ok(place.source.startsWith('https://'));
    }
    for (const route of region.routes) {
      assert.ok(route.stops.length > 0);
      assert.equal(new Set(route.stops).size, route.stops.length);
      assert.ok(route.stops.every(id => ids.includes(id)));
    }
  }
});

test('all map views use bundled static images with geographic attribution', () => {
  const data = JSON.parse(readFileSync(new URL('../../dist/guangzhou-region-maps.json', import.meta.url)));
  for (const region of data.regions) {
    for (const view of [region, ...region.routes]) {
      assert.ok(view.image.startsWith('assets/guangzhou-2026/maps/'));
      const image = new URL(`../../dist/${view.image}`, import.meta.url);
      assert.ok(existsSync(image));
      const svg = readFileSync(image, 'utf8');
      assert.ok(svg.includes('OpenStreetMap contributors'));
      assert.ok(svg.includes(region.name));
      assert.ok(!svg.includes('<script') && !svg.includes('<image'));
      assert.ok(view.imageWidth > 0 && view.imageHeight > 0);
    }
  }
});
