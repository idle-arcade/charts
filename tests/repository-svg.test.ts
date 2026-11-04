import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRepositorySvg } from '../src/repository-svg.ts';

test('identical repository geometry with floating-point jitter produces identical SVG without rewriting labels', () => {
  const a =
    '<svg><g transform="translate(388.62688107599, 563.6121403545865)"><circle r="341.2139508479326"/><text>version-1.23456789.ts</text></g></svg>';
  const b =
    '<svg><g transform="translate(388.62688107598996, 563.6121403545862)"><circle r="341.2139508479327"/><text>version-1.23456789.ts</text></g></svg>';
  assert.equal(normalizeRepositorySvg(a), normalizeRepositorySvg(b));
  assert.ok(normalizeRepositorySvg(a).includes('version-1.23456789.ts'));
  assert.equal(
    normalizeRepositorySvg(normalizeRepositorySvg(a)),
    normalizeRepositorySvg(a),
  );
});
