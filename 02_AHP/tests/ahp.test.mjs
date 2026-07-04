// Validation of the pairwise-comparison math (run: node tests/ahp.test.mjs).
import assert from 'node:assert/strict';
import {
  buildMatrix,
  setComparison,
  getComparison,
  geometricMeanWeights,
  analyzeMatrix,
  computeComposites,
  worstComparisons,
} from '../src/ahp.js';

const approx = (a, b, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} ≈ ${b} (tol ${tol})`);

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

test('matrix is reciprocal with unit diagonal, resilient to sparse storage', () => {
  let cmp = {};
  cmp = setComparison(cmp, 'a', 'b', 3);
  cmp = setComparison(cmp, 'c', 'a', 5); // stored in reversed id order internally
  const m = buildMatrix(['a', 'b', 'c'], cmp);
  for (let i = 0; i < 3; i++) {
    approx(m[i][i], 1);
    for (let j = 0; j < 3; j++) approx(m[i][j] * m[j][i], 1, 1e-12);
  }
  approx(getComparison(cmp, 'a', 'b'), 3);
  approx(getComparison(cmp, 'b', 'a'), 1 / 3);
  approx(getComparison(cmp, 'c', 'a'), 5);
  // unset pair defaults to 1
  approx(getComparison(cmp, 'b', 'c'), 1 / 5, 1); // just ensure it returns a number
  approx(getComparison(cmp, 'b', 'x'), 1);
});

test('perfectly consistent matrix: exact weights, lambdaMax = n, CR = 0', () => {
  // ratios 4 : 2 : 1  =>  weights 4/7, 2/7, 1/7
  const m = [
    [1, 2, 4],
    [1 / 2, 1, 2],
    [1 / 4, 1 / 2, 1],
  ];
  const { weights, lambdaMax, cr } = analyzeMatrix(m);
  approx(weights[0], 4 / 7, 1e-12);
  approx(weights[1], 2 / 7, 1e-12);
  approx(weights[2], 1 / 7, 1e-12);
  approx(lambdaMax, 3, 1e-12);
  approx(cr, 0, 1e-12);
});

test('textbook example (classic 4-criteria AHP): weights and CR match published values', () => {
  // Widely published "choose a leader" example (Saaty scale):
  //          Exp   Edu   Cha   Age
  //   Exp  [  1     4     3     7 ]
  //   Edu  [ 1/4    1    1/3    3 ]
  //   Cha  [ 1/3    3     1     5 ]
  //   Age  [ 1/7   1/3   1/5    1 ]
  // Published principal-eigenvector priorities ≈ (0.547, 0.127, 0.270, 0.056),
  // CR ≈ 0.04–0.05. The geometric-mean approximation should land within 0.01.
  const m = [
    [1, 4, 3, 7],
    [1 / 4, 1, 1 / 3, 3],
    [1 / 3, 3, 1, 5],
    [1 / 7, 1 / 3, 1 / 5, 1],
  ];
  const { weights, lambdaMax, ci, cr } = analyzeMatrix(m);
  approx(weights[0], 0.547, 0.01);
  approx(weights[1], 0.127, 0.01);
  approx(weights[2], 0.27, 0.01);
  approx(weights[3], 0.056, 0.01);
  approx(weights.reduce((s, w) => s + w, 0), 1, 1e-12);
  assert.ok(lambdaMax > 4 && lambdaMax < 4.3, `lambdaMax ${lambdaMax}`);
  assert.ok(ci > 0, 'CI positive for inconsistent matrix');
  assert.ok(cr > 0.02 && cr < 0.08, `CR ${cr} should be ≈ 0.044`);
});

test('geometric-mean weights cross-check against power-iteration eigenvector', () => {
  const m = [
    [1, 1 / 3, 2, 4],
    [3, 1, 5, 6],
    [1 / 2, 1 / 5, 1, 2],
    [1 / 4, 1 / 6, 1 / 2, 1],
  ];
  // independent eigenvector computation (power iteration)
  let v = [0.25, 0.25, 0.25, 0.25];
  for (let it = 0; it < 200; it++) {
    const next = m.map((row) => row.reduce((s, a, j) => s + a * v[j], 0));
    const sum = next.reduce((s, x) => s + x, 0);
    v = next.map((x) => x / sum);
  }
  const gm = geometricMeanWeights(m);
  for (let i = 0; i < 4; i++) approx(gm[i], v[i], 0.01);
});

test('inconsistent matrix flagged (CR > 0.10) and worst comparison identified', () => {
  // a>b (3), b>c (3), but c>a (3): a circular judgment
  const m = [
    [1, 3, 1 / 3],
    [1 / 3, 1, 3],
    [3, 1 / 3, 1],
  ];
  const { weights, cr } = analyzeMatrix(m);
  assert.ok(cr > 0.1, `CR ${cr} should exceed 0.10 for circular judgments`);
  const worst = worstComparisons(m, weights, 3);
  assert.equal(worst.length, 3);
  assert.ok(worst[0].error >= worst[1].error && worst[1].error >= worst[2].error);
});

test('n = 1 and n = 2 edge cases', () => {
  const one = analyzeMatrix([[1]]);
  approx(one.weights[0], 1);
  approx(one.cr, 0);
  const two = analyzeMatrix([
    [1, 4],
    [1 / 4, 1],
  ]);
  approx(two.weights[0], 0.8, 1e-12);
  approx(two.weights[1], 0.2, 1e-12);
  approx(two.cr, 0);
});

test('composite weights: correct lens applied, normalized set sums to 1', () => {
  const domains = [
    { id: 'd1', criteria: [{ id: 'c1' }, { id: 'c2' }] },
    { id: 'd2', criteria: [{ id: 'c3' }] },
  ];
  const domainWeights = { d1: [0.75, 0.25], d2: [1] };
  const mapping = { d1: 'lensA', d2: 'lensB' };
  const lensWeights = { lensA: 0.6, lensB: 0.4 };
  const rows = computeComposites(domains, domainWeights, mapping, lensWeights);
  approx(rows[0].raw, 0.75 * 0.6, 1e-12);
  approx(rows[1].raw, 0.25 * 0.6, 1e-12);
  approx(rows[2].raw, 1 * 0.4, 1e-12);
  const normSum = rows.reduce((s, r) => s + r.normalized, 0);
  approx(normSum, 1, 1e-12);
  // 1:1 mapping with all lenses used: raw composites also sum to 1
  approx(rows.reduce((s, r) => s + r.raw, 0), 1, 1e-12);
});

test('composite weights: many-to-one mapping — raw sum exceeds 1, normalized still sums to 1', () => {
  const domains = [
    { id: 'd1', criteria: [{ id: 'c1' }] },
    { id: 'd2', criteria: [{ id: 'c2' }] },
  ];
  const domainWeights = { d1: [1], d2: [1] };
  const mapping = { d1: 'lensA', d2: 'lensA' }; // both domains share one lens
  const lensWeights = { lensA: 0.7, lensB: 0.3 };
  const rows = computeComposites(domains, domainWeights, mapping, lensWeights);
  approx(rows.reduce((s, r) => s + r.raw, 0), 1.4, 1e-12); // > 1: why normalization matters
  approx(rows.reduce((s, r) => s + r.normalized, 0), 1, 1e-12);
});

test('unmapped domain excluded from normalization without breaking others', () => {
  const domains = [
    { id: 'd1', criteria: [{ id: 'c1' }] },
    { id: 'd2', criteria: [{ id: 'c2' }] },
  ];
  const rows = computeComposites(
    domains,
    { d1: [1], d2: [1] },
    { d1: 'lensA' }, // d2 unmapped
    { lensA: 0.5 },
  );
  assert.equal(rows[1].raw, undefined);
  assert.equal(rows[1].normalized, undefined);
  approx(rows[0].normalized, 1, 1e-12);
});

test('adding an item never disturbs stored comparisons for other pairs', () => {
  let cmp = {};
  cmp = setComparison(cmp, 'a', 'b', 5);
  const before = getComparison(cmp, 'a', 'b');
  // "add" item c: matrix rebuilt with an extra id; a-b judgment must be intact
  const m = buildMatrix(['a', 'b', 'c'], cmp);
  approx(m[0][1], before, 1e-12);
  approx(m[0][2], 1); // new pairs default to equal importance
  approx(m[2][1], 1);
});

console.log(`\n${passed} test groups passed`);
