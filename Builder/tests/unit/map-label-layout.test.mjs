import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  doorStrokeColor,
  layoutMapLabels,
  shortenMapLabel,
} from '../../dist/shared/map-label-layout.js';

test('shortenMapLabel strips reference kind suffixes', () => {
  assert.equal(shortenMapLabel('Damp stones — hazard reference'), 'Damp stones');
  assert.equal(shortenMapLabel('Wall sconce - lighting reference'), 'Wall sconce');
  assert.equal(shortenMapLabel('Rubble pile — cover reference'), 'Rubble pile');
  assert.equal(shortenMapLabel('Loophole Lantern'), 'Loophole Lantern');
});

test('doorStrokeColor distinguishes lock/open states', () => {
  assert.equal(doorStrokeColor('locked'), '#a33b2b');
  assert.equal(doorStrokeColor('unlocked'), '#3d8f6a');
  assert.equal(doorStrokeColor('open'), '#d4a017');
  assert.equal(doorStrokeColor('closed'), '#b86b2b');
});

test('layoutMapLabels keeps token and marker chips from overlapping', () => {
  const placements = layoutMapLabels(
    [
      {
        id: 'token:1',
        kind: 'token',
        x: 120,
        y: 120,
        obstacle: { x: 100, y: 100, w: 40, h: 40 },
        fullLabel: 'Loophole Lantern',
      },
      {
        id: 'marker:hazard',
        kind: 'marker',
        x: 130,
        y: 130,
        obstacle: { x: 123, y: 123, w: 14, h: 14 },
        fullLabel: 'Damp stones — hazard reference',
        referenceKind: 'hazard',
      },
      {
        id: 'marker:cover',
        kind: 'marker',
        x: 150,
        y: 110,
        obstacle: { x: 143, y: 103, w: 14, h: 14 },
        fullLabel: 'Rubble pile — cover reference',
        referenceKind: 'cover',
      },
    ],
    { mapWidth: 576, mapHeight: 384, pixelsPerSquare: 48, zoomScale: 1 },
  );

  assert.equal(placements.length, 3);
  assert.equal(placements.find((entry) => entry.id === 'marker:hazard')?.displayText, 'Damp stones');

  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      assert.ok(a);
      assert.ok(b);
      const overlap = !(
        a.x + a.width + 2 <= b.x ||
        b.x + b.width + 2 <= a.x ||
        a.y + a.height + 2 <= b.y ||
        b.y + b.height + 2 <= a.y
      );
      assert.equal(overlap, false, `${a.id} overlaps ${b.id}`);
    }
  }

  const tokenChip = placements.find((entry) => entry.kind === 'token');
  assert.ok(tokenChip);
  // Token chip must not cover the token obstacle box.
  const coversToken = !(
    tokenChip.x + tokenChip.width <= 100 ||
    140 <= tokenChip.x ||
    tokenChip.y + tokenChip.height <= 100 ||
    140 <= tokenChip.y
  );
  assert.equal(coversToken, false);
});
