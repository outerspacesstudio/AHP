// Pairwise-comparison math for the multi-tier criteria weighting tool.
// Weights use the geometric-mean (logarithmic least squares) approximation of
// the principal eigenvector; consistency uses Saaty's CR = CI / RI.

// Random Index values (Saaty), indexed by matrix size n.
export const RANDOM_INDEX = {
  1: 0, 2: 0, 3: 0.58, 4: 0.9, 5: 1.12, 6: 1.24, 7: 1.32, 8: 1.41, 9: 1.45, 10: 1.49,
};

export const CR_THRESHOLD = 0.1;

// Comparisons are stored sparsely: one entry per unordered pair, keyed by the
// lexicographically smaller id first, valued as (importance of smaller-id item
// over larger-id item). Reciprocals are derived, never stored, so adding or
// removing items can never corrupt unrelated pairs.
export function pairKey(idA, idB) {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

export function getComparison(comparisons, idA, idB) {
  if (idA === idB) return 1;
  const stored = comparisons[pairKey(idA, idB)];
  const v = stored === undefined ? 1 : stored;
  return idA < idB ? v : 1 / v;
}

export function setComparison(comparisons, idA, idB, value) {
  return {
    ...comparisons,
    [pairKey(idA, idB)]: idA < idB ? value : 1 / value,
  };
}

// Full reciprocal matrix (diagonal 1) for the given item ids.
export function buildMatrix(ids, comparisons) {
  return ids.map((a) => ids.map((b) => getComparison(comparisons, a, b)));
}

// Geometric-mean weights: w_i ∝ (∏_j a_ij)^(1/n), normalized to sum to 1.
export function geometricMeanWeights(matrix) {
  const n = matrix.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  const gms = matrix.map((row) =>
    Math.pow(row.reduce((p, v) => p * v, 1), 1 / n),
  );
  const sum = gms.reduce((s, v) => s + v, 0);
  return gms.map((g) => g / sum);
}

export function lambdaMax(matrix, weights) {
  const n = matrix.length;
  const aw = matrix.map((row) =>
    row.reduce((s, v, j) => s + v * weights[j], 0),
  );
  return aw.reduce((s, v, i) => s + v / weights[i], 0) / n;
}

// Weights + consistency for one matrix. For n < 3 a reciprocal matrix is
// always perfectly consistent, so CR is 0 by definition.
export function analyzeMatrix(matrix) {
  const n = matrix.length;
  const weights = geometricMeanWeights(matrix);
  if (n < 3) {
    return { n, weights, lambdaMax: n, ci: 0, cr: 0 };
  }
  const lm = lambdaMax(matrix, weights);
  const ci = (lm - n) / (n - 1);
  const cr = ci / RANDOM_INDEX[n];
  return { n, weights, lambdaMax: lm, ci, cr };
}

// The pairs whose entered judgment deviates most (in log space) from the
// ratio implied by the computed weights — the top contributors to a high CR.
export function worstComparisons(matrix, weights, count = 3) {
  const out = [];
  for (let i = 0; i < matrix.length; i++) {
    for (let j = i + 1; j < matrix.length; j++) {
      const implied = weights[i] / weights[j];
      const error = Math.abs(Math.log(matrix[i][j] / implied));
      out.push({ i, j, entered: matrix[i][j], implied, error });
    }
  }
  return out.sort((a, b) => b.error - a.error).slice(0, count);
}

// Composite weights: for every criterion,
//   raw = domain-internal weight × lens weight of its domain's mapped lens.
// Raw values are relative; normalized = raw / Σ raw so the set sums to 1.
export function computeComposites(domains, domainWeightsById, mapping, lensWeightsById) {
  const rows = [];
  for (const domain of domains) {
    const lensId = mapping[domain.id];
    const lensWeight = lensId !== undefined ? lensWeightsById[lensId] : undefined;
    const weights = domainWeightsById[domain.id] || [];
    domain.criteria.forEach((criterion, i) => {
      const domainWeight = weights[i];
      rows.push({
        domainId: domain.id,
        criterionId: criterion.id,
        domainWeight,
        lensId,
        lensWeight,
        raw: lensWeight === undefined ? undefined : domainWeight * lensWeight,
      });
    });
  }
  const total = rows.reduce((s, r) => s + (r.raw ?? 0), 0);
  for (const row of rows) {
    row.normalized = row.raw === undefined || total === 0 ? undefined : row.raw / total;
  }
  return rows;
}
