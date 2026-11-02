"""Render local, static map images from cached OpenStreetMap Overpass extracts.

Usage: python scripts/build-guangzhou-region-images.py <extract-directory>
Requires Shapely. No map API or network request is used by the page.
"""
import html
import json
import math
import pathlib
import re
import sys

from shapely.geometry import LineString, Polygon, box
from shapely.ops import polygonize, unary_union

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'dist/assets/guangzhou-2026/maps'
DATA = ROOT / 'dist/guangzhou-region-maps.json'
CACHE = pathlib.Path(sys.argv[1])
OUTPUT.mkdir(parents=True, exist_ok=True)
data = json.loads(DATA.read_text(encoding='utf-8'))


def path_data(geometry, transform):
    if geometry.is_empty:
        return ''
    if geometry.geom_type == 'Polygon':
        return ' '.join(path_data(ring, transform) + ' Z' for ring in [geometry.exterior, *geometry.interiors])
    if hasattr(geometry, 'geoms'):
        return ' '.join(path_data(part, transform) for part in geometry.geoms)
    coordinates = [transform(x, y) for x, y in geometry.coords]
    return 'M ' + ' L '.join(f'{x:.1f},{y:.1f}' for x, y in coordinates)


def join_rings(members):
    lines = [LineString([(p['lon'], p['lat']) for p in member['geometry']]) for member in members if len(member.get('geometry', [])) > 1]
    return list(polygonize(unary_union(lines))) if lines else []


def features(region, extract):
    latitude = sum(p['lat'] for p in region['places']) / len(region['places'])
    x_factor = 111195 * math.cos(math.radians(latitude))
    def project(lng, lat):
        return (lng * x_factor, lat * 111195)
    def projected_ring(ring):
        return [project(x, y) for x, y in ring.coords]
    result = []
    for element in extract['elements']:
        tags = element.get('tags', {})
        if element['type'] == 'way' and len(element.get('geometry', [])) > 1:
            coordinates = [project(p['lon'], p['lat']) for p in element['geometry']]
            is_area = tags.get('natural') in ['water', 'wood'] or tags.get('leisure') == 'park' or 'landuse' in tags
            shape = Polygon(coordinates) if is_area and coordinates[0] == coordinates[-1] else LineString(coordinates)
            result.append((shape.buffer(0) if not shape.is_valid else shape, tags))
        elif element['type'] == 'relation' and tags.get('natural') == 'water':
            outer = join_rings([member for member in element.get('members', []) if member.get('role') == 'outer'])
            inner = join_rings([member for member in element.get('members', []) if member.get('role') == 'inner'])
            for polygon in outer:
                holes = [projected_ring(hole.exterior) for hole in inner if polygon.covers(hole.representative_point())]
                shape = Polygon(projected_ring(polygon.exterior), holes)
                result.append((shape.buffer(0) if not shape.is_valid else shape, tags))
    return project, result


def render(region, route, index, project, geographic_features):
    places = region['places'] if route is None else [next(p for p in region['places'] if p['id'] == id_) for id_ in route['stops']]
    width, height = 1000, 740
    if route is None:
        height = {'guangzhou': 820, 'shunde': 600, 'macao': 1000}[region['id']]
    points = [(place, *project(place['lng'], place['lat'])) for place in places]
    xs, ys = [p[1] for p in points], [p[2] for p in points]
    center_x, center_y = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    minimum = 3600 if len(points) == 1 else 1700
    span_x = max(max(xs) - min(xs), minimum) * 1.35
    span_y = max(max(ys) - min(ys), minimum * .75) * 1.35
    scale = min((width - 200) / span_x, (height - 180) / span_y)
    transform = lambda x, y: (width / 2 + (x - center_x) * scale, height / 2 - (y - center_y) * scale)
    frame = box(center_x - width / scale / 2, center_y - height / scale / 2, center_x + width / scale / 2, center_y + height / scale / 2)
    features_in_frame = [(shape.intersection(frame), tags) for shape, tags in geographic_features if shape.intersects(frame)]
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">', '<style>text{font-family:system-ui,"Microsoft YaHei","PingFang SC",sans-serif}path{stroke-linecap:round;stroke-linejoin:round}</style>', f'<rect width="{width}" height="{height}" fill="#f3f1e8"/>']
    def shape_path(shape, attributes):
        path = path_data(shape.simplify(.65 / scale, preserve_topology=True), transform)
        if path:
            parts.append(f'<path d="{path}" {attributes}/>')
    coast = [shape for shape, tags in geographic_features if tags.get('natural') == 'coastline']
    if coast:
        parts.append(f'<rect width="{width}" height="{height}" fill="#c4dee5"/>')
        faces = list(polygonize(unary_union([frame.boundary, *[line.intersection(frame) for line in coast if line.intersects(frame)]])))
        for face in faces:
            point = face.representative_point()
            shore = min(coast, key=lambda line: line.distance(point))
            along = shore.project(point)
            before, after = shore.interpolate(max(0, along - 2)), shore.interpolate(min(shore.length, along + 2))
            if (after.x - before.x) * (point.y - before.y) - (after.y - before.y) * (point.x - before.x) > 0:
                shape_path(face, 'fill="#f3f1e8" stroke="none"')
    for shape, tags in features_in_frame:
        if shape.geom_type not in ['Polygon', 'MultiPolygon']:
            continue
        if tags.get('natural') == 'water':
            shape_path(shape, 'fill="#c4dee5" fill-rule="evenodd" stroke="none"')
        elif tags.get('natural') == 'wood' or tags.get('leisure') == 'park' or 'landuse' in tags:
            shape_path(shape, 'fill="#d9e4c9" stroke="none"')
    for shape, tags in features_in_frame:
        if 'waterway' in tags:
            shape_path(shape, f'fill="none" stroke="#b2d2dd" stroke-width="{4 if tags["waterway"] == "river" else 1.8}"')
    roads = [(shape, tags) for shape, tags in features_in_frame if 'highway' in tags]
    major = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']
    for shape, tags in sorted(roads, key=lambda feature: feature[1]['highway'] in major):
        kind = tags['highway'].replace('_link', '')
        road_width = {'motorway': 5, 'trunk': 4.5, 'primary': 3.8, 'secondary': 3, 'tertiary': 2.4}.get(kind, 1.2)
        if kind in major:
            shape_path(shape, f'fill="none" stroke="#d2cbbb" stroke-width="{road_width + 1.3}"')
        color = '#ead9af' if kind in ['motorway', 'trunk', 'primary'] else '#fdfcf7'
        shape_path(shape, f'fill="none" stroke="{color}" stroke-width="{road_width}"')
    road_labels = {}
    for shape, tags in roads:
        name = tags.get('name:zh') or tags.get('name', '')
        if name and shape.geom_type == 'LineString' and shape.length * scale > 130 and len(name) < 15:
            if name not in road_labels or shape.length > road_labels[name].length:
                road_labels[name] = shape
    label_boxes = []
    for name, shape in sorted(road_labels.items(), key=lambda item: -item[1].length):
        point = shape.interpolate(.5, normalized=True)
        x, y = transform(point.x, point.y)
        if not (90 < x < width - 90 and 90 < y < height - 70):
            continue
        if any(abs(x - a) < 120 and abs(y - b) < 70 for a, b in label_boxes):
            continue
        parts.append(f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="middle" fill="#838a82" font-size="19" stroke="#f3f1e8" stroke-width="3" paint-order="stroke">{html.escape(name)}</text>')
        label_boxes.append((x, y))
        if len(label_boxes) >= 18:
            break
    plotted = [(place, *transform(x, y)) for place, x, y in points]
    if route:
        for (_, x1, y1), (_, x2, y2) in zip(plotted, plotted[1:]):
            parts.append(f'<path d="M {x1:.1f},{y1:.1f} L {x2:.1f},{y2:.1f}" fill="none" stroke="#296957" stroke-width="3" stroke-dasharray="9 7"/>')
            x, y = x1 * .4 + x2 * .6, y1 * .4 + y2 * .6
            angle = math.atan2(y2 - y1, x2 - x1)
            arrow = [(x, y), (x - 16 * math.cos(angle - .45), y - 16 * math.sin(angle - .45)), (x - 16 * math.cos(angle + .45), y - 16 * math.sin(angle + .45))]
            parts.append('<path d="M ' + ' L '.join(f'{a:.1f},{b:.1f}' for a, b in arrow) + '" fill="none" stroke="#296957" stroke-width="3"/>')
    occupied = []
    for place, x, y in plotted:
        name = re.sub(r'（.*?）', '', place['name']).split(' · ')[0]
        label_width, label_height = 64 + len(name) * 31, 58
        candidates = [(x + dx, y + dy) for dx, dy in [(24, -70), (24, 14), (-label_width - 24, -70), (-label_width - 24, 14), (-label_width / 2, -110), (-label_width / 2, 60), (35, -165), (-label_width - 35, -165), (35, 105), (-label_width - 35, 105), (-label_width / 2, 160), (-label_width / 2, -220)]]
        def score(candidate):
            left, top = candidate
            overflow = max(16 - left, 0) + max(left + label_width - width + 16, 0) + max(76 - top, 0) + max(top + label_height - height + 56, 0)
            overlap = sum(max(0, min(left + label_width, a + w) - max(left, a)) * max(0, min(top + label_height, b + h) - max(top, b)) for a, b, w, h in occupied)
            return overflow * 100000 + overlap * 100 + math.hypot(left + label_width / 2 - x, top + label_height / 2 - y)
        left, top = min(candidates, key=score)
        if region['id'] == 'macao' and route is None:
            # Keep close labels on their geographic side, especially the three hotels.
            offsets = {
                'st-paul': (28, -80), 'st-dominic': (28, -8),
                'senado': (-label_width - 28, 30), 'a-ma': (-label_width - 28, 30),
                'taipa': (-label_width - 28, -80), 'venetian': (-label_width - 28, -58),
                'parisian': (-label_width - 28, 25), 'wynn-palace': (28, -29)
            }
            dx, dy = offsets[place['id']]
            left, top = x + dx, y + dy
        occupied.append((left - 5, top - 5, label_width + 10, label_height + 10))
        end_x, end_y = max(left, min(x, left + label_width)), max(top, min(y, top + label_height))
        parts.append(f'<path d="M {x:.1f},{y:.1f} L {end_x:.1f},{end_y:.1f}" stroke="#296957" stroke-width="1.7" fill="none"/><circle cx="{x:.1f}" cy="{y:.1f}" r="6" fill="#296957" stroke="#fdfcf7" stroke-width="2"/>')
        parts.append(f'<rect x="{left:.1f}" y="{top:.1f}" width="{label_width}" height="{label_height}" rx="10" fill="#fffdf7" stroke="#aebfb1" stroke-width="1.5"/><circle cx="{left + 29:.1f}" cy="{top + 29:.1f}" r="19" fill="#215c50"/><text x="{left + 29:.1f}" y="{top + 39:.1f}" text-anchor="middle" fill="#fffdf7" font-size="29" font-weight="600">{place["number"]}</text><text x="{left + 58:.1f}" y="{top + 40:.1f}" fill="#213c35" font-size="31" font-weight="550">{html.escape(name)}</text>')
    title = region['name'] + ' · ' + (route['name'] if route else '景点分布')
    parts.append(f'<rect width="{width}" height="65" fill="#fffdf7" fill-opacity=".93"/><text x="24" y="44" fill="#213c35" font-size="31" font-weight="600">{html.escape(title)}</text><path d="M {width - 36},53 V 18 l -7,10 m 7,-10 l 7,10" stroke="#526e62" stroke-width="2" fill="none"/><text x="{width - 62}" y="43" fill="#526e62" font-size="22">北</text>')
    scale_meters = max(value for value in [50, 100, 200, 500, 1000, 2000, 5000] if value * scale < 170)
    scale_y = height - 42
    parts.append(f'<rect x="0" y="{height - 55}" width="{width}" height="55" fill="#fffdf7" fill-opacity=".93"/><path d="M 24,{scale_y - 7} V {scale_y} H {24 + scale_meters * scale:.1f} V {scale_y - 7}" fill="none" stroke="#526e62" stroke-width="2"/><text x="24" y="{height - 14}" fill="#526e62" font-size="19">{str(scale_meters) + " 米" if scale_meters < 1000 else str(scale_meters // 1000) + " 公里"}</text><text x="{width - 18}" y="{height - 17}" text-anchor="end" fill="#526e62" font-size="18">© OpenStreetMap contributors</text></svg>')
    filename = f'{region["id"]}-' + ('all' if route is None else f'route-{index}') + '.svg'
    (OUTPUT / filename).write_text('\n'.join(parts), encoding='utf-8')
    target = region if route is None else route
    target['image'] = f'assets/guangzhou-2026/maps/{filename}'
    target['imageWidth'], target['imageHeight'] = width, height
    print(filename, len(features_in_frame), 'features', flush=True)


for region in data['regions']:
    extract = json.loads((CACHE / f'map-features-{region["id"]}.json').read_text(encoding='utf-8'))
    for number, place in enumerate(region['places'], 1):
        place['number'] = number
    project, geographic_features = features(region, extract)
    render(region, None, 0, project, geographic_features)
    for index, route in enumerate(region['routes'], 1):
        render(region, route, index, project, geographic_features)
    for place in region['places']:
        del place['number']
DATA.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
