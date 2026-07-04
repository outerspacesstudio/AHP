// Validation of project-state serialization, threshold clamping, and the
// sample project (run: node tests/project.test.mjs).
import assert from 'node:assert/strict';
import {
  DOMAIN_COLORS,
  clampThresholds,
  serializeProject,
  parseProject,
  sampleProject,
  nextColor,
  makeDomain,
} from '../src/project.js';
import { buildMatrix, analyzeMatrix, CR_THRESHOLD } from '../src/ahp.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

test('palette has 10 unique swatches', () => {
  assert.equal(DOMAIN_COLORS.length, 10);
  assert.equal(new Set(DOMAIN_COLORS.map((c) => c.hex)).size, 10);
  for (const c of DOMAIN_COLORS) assert.match(c.hex, /^#[0-9a-f]{6}$/);
});

test('clampThresholds enforces 1 ≤ lowMed ≤ medHigh ≤ high ≤ 10', () => {
  assert.deepEqual(clampThresholds(4, 7, 10), { lowMed: 4, medHigh: 7, high: 10 });
  // crossing values are pulled back into order
  assert.deepEqual(clampThresholds(9, 7, 8), { lowMed: 7, medHigh: 7, high: 8 });
  assert.deepEqual(clampThresholds(2, 9, 5), { lowMed: 2, medHigh: 5, high: 5 });
  // out-of-scale and non-numeric input repaired
  assert.deepEqual(clampThresholds(-3, 12, 42), { lowMed: 1, medHigh: 10, high: 10 });
  const t = clampThresholds(NaN, undefined, 'x');
  assert.deepEqual(t, { lowMed: 4, medHigh: 7, high: 10 });
});

test('serialize → parse round-trips the full project state', () => {
  const state = sampleProject();
  const restored = parseProject(serializeProject(state));
  assert.deepEqual(restored.domains, state.domains);
  assert.deepEqual(restored.lenses, state.lenses);
  assert.deepEqual(restored.mapping, state.mapping);
  assert.deepEqual(restored.lensComparisons, state.lensComparisons);
});

test('parseProject rejects unusable files with readable messages', () => {
  assert.throws(() => parseProject('not json {'), /valid JSON/);
  assert.throws(() => parseProject('{"app":"other-tool"}'), /not exported by this tool/);
  assert.throws(
    () => parseProject(JSON.stringify({ app: 'multi-tier-criteria-weighting-tool', version: 99, state: {} })),
    /Unsupported file version/,
  );
  assert.throws(
    () =>
      parseProject(
        JSON.stringify({
          app: 'multi-tier-criteria-weighting-tool',
          version: 2,
          state: { domains: [], lenses: [] },
        }),
      ),
    /no domains/,
  );
});

test('parseProject repairs what it safely can', () => {
  const state = sampleProject();
  const raw = JSON.parse(serializeProject(state));
  const d = raw.state.domains[0];
  d.color = 'not-a-color';
  d.criteria[0].lowMed = 99; // out of scale
  d.comparisons['ghost|pair'] = 5; // unknown ids
  raw.state.mapping['ghost-domain'] = raw.state.lenses[0].id; // unknown domain
  const restored = parseProject(JSON.stringify(raw));
  assert.match(restored.domains[0].color, /^#[0-9a-fA-F]{6}$/);
  const c = restored.domains[0].criteria[0];
  assert.ok(c.lowMed >= 1 && c.lowMed <= c.medHigh && c.medHigh <= c.high && c.high <= 10);
  assert.ok(!('ghost|pair' in restored.domains[0].comparisons));
  assert.ok(!('ghost-domain' in restored.mapping));
});

test('sample project: every matrix consistent, all domains mapped, varied thresholds', () => {
  const { domains, lenses, mapping, lensComparisons } = sampleProject();
  for (const d of domains) {
    const analysis = analyzeMatrix(buildMatrix(d.criteria.map((c) => c.id), d.comparisons));
    assert.ok(
      analysis.cr <= CR_THRESHOLD,
      `sample domain "${d.name}" CR ${analysis.cr} exceeds threshold`,
    );
    assert.ok(Math.abs(analysis.weights.reduce((s, w) => s + w, 0) - 1) < 1e-9);
    for (const c of d.criteria) {
      assert.ok(1 <= c.lowMed && c.lowMed <= c.medHigh && c.medHigh <= c.high && c.high <= 10);
    }
  }
  const lensAnalysis = analyzeMatrix(buildMatrix(lenses.map((l) => l.id), lensComparisons));
  assert.ok(lensAnalysis.cr <= CR_THRESHOLD, `sample lens CR ${lensAnalysis.cr}`);
  for (const d of domains) assert.ok(lenses.some((l) => l.id === mapping[d.id]));
  // at least one criterion demonstrates a capped High boundary
  assert.ok(domains.some((d) => d.criteria.some((c) => c.high < 10)));
});

test('nextColor picks the first unused swatch', () => {
  const d1 = makeDomain('A', ['x'], DOMAIN_COLORS[0].hex);
  const d2 = makeDomain('B', ['y'], DOMAIN_COLORS[2].hex);
  assert.equal(nextColor([d1, d2]), DOMAIN_COLORS[1].hex);
  assert.equal(nextColor([]), DOMAIN_COLORS[0].hex);
});

console.log(`\n${passed} test groups passed`);
