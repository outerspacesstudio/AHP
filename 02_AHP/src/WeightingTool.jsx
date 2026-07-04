// Multi-tier criteria weighting tool (domain-agnostic prototype).
//
// Three-stage architecture:
//   1. Domain tier    — per-domain pairwise comparison of criteria + L/M/H
//                       threshold calibration on a shared 1–10 scale.
//   2. Mapping        — each domain is assigned to exactly one board-level lens.
//   3. Leadership tier — pairwise comparison of the lenses themselves.
// Output: composite weight per criterion (domain-internal × lens weight),
// raw and normalized, plus L/M/H threshold breakpoints, as an exportable table.
//
// Weights use the geometric-mean approximation of the principal eigenvector
// (see src/ahp.js); consistency is checked independently per matrix.

import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import {
  CR_THRESHOLD,
  analyzeMatrix,
  buildMatrix,
  getComparison,
  setComparison,
  computeComposites,
  worstComparisons,
} from './ahp.js';

/* ---------------------------------------------------------------- helpers */

let uidCounter = 0;
const newId = (prefix) =>
  `${prefix}${(++uidCounter).toString(36).padStart(6, '0')}`;

const makeCriterion = (name) => ({ id: newId('c'), name, lowMed: 4, medHigh: 7 });
const makeDomain = (name, criterionNames) => ({
  id: newId('d'),
  name,
  criteria: criterionNames.map(makeCriterion),
  comparisons: {},
});
const makeLens = (name) => ({ id: newId('l'), name });

const INTENSITY_WORDS = {
  1: 'equal importance',
  2: 'slightly more important',
  3: 'moderately more important',
  4: 'moderately-to-strongly more important',
  5: 'strongly more important',
  6: 'strongly-to-very-strongly more important',
  7: 'very strongly more important',
  8: 'very-to-extremely more important',
  9: 'extremely more important',
};

function formatSaaty(v) {
  if (v >= 0.999) return String(Math.round(v));
  return `1/${Math.round(1 / v)}`;
}

const fmt = (v, digits = 4) => (v === undefined ? '—' : v.toFixed(digits));
const pct = (v) => (v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);

/* ------------------------------------------------------------ initial data */

function initialState() {
  const domains = [
    makeDomain('Domain 1', ['Site Factor 1A', 'Site Factor 1B', 'Site Factor 1C']),
    makeDomain('Domain 2', ['Site Factor 2A', 'Site Factor 2B', 'Site Factor 2C']),
    makeDomain('Domain 3', ['Site Factor 3A', 'Site Factor 3B']),
    makeDomain('Domain 4', ['Site Factor 4A', 'Site Factor 4B', 'Site Factor 4C']),
  ];
  const lenses = [
    makeLens('Priority Group 1'),
    makeLens('Priority Group 2'),
    makeLens('Priority Group 3'),
    makeLens('Priority Group 4'),
  ];
  const mapping = {};
  domains.forEach((d, i) => {
    mapping[d.id] = lenses[i % lenses.length].id;
  });
  return { domains, lenses, mapping };
}

/* ------------------------------------------------------- pairwise controls */

function PairwiseRow({ a, b, comparisons, onChange }) {
  const options = [];
  for (let v = 9; v >= 2; v--) {
    options.push({ value: v, label: `"${a.name}" is ${INTENSITY_WORDS[v]} (${v})` });
  }
  options.push({ value: 1, label: 'Both are of equal importance (1)' });
  for (let v = 2; v <= 9; v++) {
    options.push({ value: 1 / v, label: `"${b.name}" is ${INTENSITY_WORDS[v]} (${v})` });
  }
  const current = getComparison(comparisons, a.id, b.id);
  const selectedIndex = options.reduce(
    (best, o, i) =>
      Math.abs(o.value - current) < Math.abs(options[best].value - current) ? i : best,
    0,
  );
  return (
    <div className="pair-row">
      <span className={`pair-name pair-left ${current > 1.001 ? 'favored' : ''}`}>
        {a.name}
      </span>
      <select
        aria-label={`Relative importance: ${a.name} versus ${b.name}`}
        value={selectedIndex}
        onChange={(e) => onChange(a.id, b.id, options[Number(e.target.value)].value)}
      >
        {options.map((o, i) => (
          <option key={i} value={i}>
            {o.label}
          </option>
        ))}
      </select>
      <span className={`pair-name pair-right ${current < 0.999 ? 'favored' : ''}`}>
        {b.name}
      </span>
    </div>
  );
}

function MatrixPreview({ items, matrix, weights }) {
  return (
    <div className="table-scroll">
      <table className="matrix-table">
        <thead>
          <tr>
            <th aria-label="Row item" />
            {items.map((it) => (
              <th key={it.id}>{it.name}</th>
            ))}
            <th className="weight-col">Weight</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id}>
              <th>{it.name}</th>
              {items.map((jt, j) => (
                <td key={jt.id} className={i === j ? 'diag' : ''}>
                  {formatSaaty(matrix[i][j])}
                </td>
              ))}
              <td className="weight-col">{weights[i].toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConsistencyPanel({ tier, analysis, matrix, items }) {
  const tag = tier === 'lens' ? 'Leadership tier' : 'Domain tier';
  const cls = tier === 'lens' ? 'cr-lens' : 'cr-domain';
  if (analysis.n < 3) {
    return (
      <div className={`cr-panel cr-ok ${cls}`}>
        <span className="cr-tag">{tag}</span>
        Consistency: with fewer than 3 items a reciprocal comparison matrix is
        perfectly consistent by construction (CR = 0).
      </div>
    );
  }
  const bad = analysis.cr > CR_THRESHOLD;
  const worst = bad ? worstComparisons(matrix, analysis.weights, 3) : [];
  return (
    <div className={`cr-panel ${bad ? `cr-warn ${cls}` : 'cr-ok'} ${cls}`}>
      <span className="cr-tag">{tag}</span>
      <span>
        λ<sub>max</sub> = {analysis.lambdaMax.toFixed(3)} · CI ={' '}
        {analysis.ci.toFixed(3)} · <strong>CR = {analysis.cr.toFixed(3)}</strong>{' '}
        {bad
          ? '— above the 0.10 threshold. Judgments are inconsistent; revisit the comparisons below.'
          : '— within the 0.10 threshold.'}
      </span>
      {bad && (
        <ul className="cr-worst">
          {worst.map((w) => (
            <li key={`${w.i}-${w.j}`}>
              “{items[w.i].name}” vs “{items[w.j].name}”: entered{' '}
              {formatSaaty(w.entered)}, but the computed weights imply ≈{' '}
              {w.implied >= 1 ? w.implied.toFixed(2) : `1/${(1 / w.implied).toFixed(2)}`}.
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------- threshold slider */

function ThresholdSlider({ criterion, onChange }) {
  const { lowMed, medHigh } = criterion;
  const toPct = (v) => ((v - 1) / 9) * 100;
  const setLowMed = (v) => onChange(Math.min(Math.max(1, v), medHigh), medHigh);
  const setMedHigh = (v) => onChange(lowMed, Math.max(Math.min(10, v), lowMed));
  return (
    <div className="threshold-block">
      <div className="threshold-head">
        <span className="threshold-name">{criterion.name}</span>
        <span className="threshold-readout">
          Low 1.0–{lowMed.toFixed(1)} · Medium {lowMed.toFixed(1)}–{medHigh.toFixed(1)} ·
          High {medHigh.toFixed(1)}–10.0
        </span>
      </div>
      <div className="dual-slider">
        <div className="band" aria-hidden="true">
          <div className="band-low" style={{ width: `${toPct(lowMed)}%` }}>
            {toPct(lowMed) > 12 && <span>Low</span>}
          </div>
          <div className="band-med" style={{ width: `${toPct(medHigh) - toPct(lowMed)}%` }}>
            {toPct(medHigh) - toPct(lowMed) > 12 && <span>Medium</span>}
          </div>
          <div className="band-high" style={{ width: `${100 - toPct(medHigh)}%` }}>
            {100 - toPct(medHigh) > 12 && <span>High</span>}
          </div>
        </div>
        <input
          type="range"
          min="1"
          max="10"
          step="0.5"
          value={lowMed}
          style={{ zIndex: lowMed > 7 ? 5 : 3 }}
          aria-label={`${criterion.name}: Low/Medium boundary`}
          onChange={(e) => setLowMed(Number(e.target.value))}
        />
        <input
          type="range"
          min="1"
          max="10"
          step="0.5"
          value={medHigh}
          style={{ zIndex: 4 }}
          aria-label={`${criterion.name}: Medium/High boundary`}
          onChange={(e) => setMedHigh(Number(e.target.value))}
        />
      </div>
      <div className="threshold-inputs">
        <label>
          Low/Medium boundary
          <input
            type="number"
            min="1"
            max="10"
            step="0.5"
            value={lowMed}
            onChange={(e) => setLowMed(Number(e.target.value))}
          />
        </label>
        <label>
          Medium/High boundary
          <input
            type="number"
            min="1"
            max="10"
            step="0.5"
            value={medHigh}
            onChange={(e) => setMedHigh(Number(e.target.value))}
          />
        </label>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- step 1 UI */

function DefineStep({ domains, setDomains, mapping, setMapping, lenses }) {
  const addDomain = () => {
    const d = makeDomain(`Domain ${domains.length + 1}`, [
      'New Factor A',
      'New Factor B',
    ]);
    setDomains([...domains, d]);
    if (lenses.length > 0) {
      setMapping({ ...mapping, [d.id]: lenses[0].id });
    }
  };
  const removeDomain = (id) => {
    setDomains(domains.filter((d) => d.id !== id));
    const next = { ...mapping };
    delete next[id];
    setMapping(next);
  };
  const renameDomain = (id, name) =>
    setDomains(domains.map((d) => (d.id === id ? { ...d, name } : d)));
  const addCriterion = (domainId) =>
    setDomains(
      domains.map((d) =>
        d.id === domainId
          ? {
              ...d,
              criteria: [
                ...d.criteria,
                makeCriterion(`New Factor ${String.fromCharCode(65 + d.criteria.length)}`),
              ],
            }
          : d,
      ),
    );
  const removeCriterion = (domainId, criterionId) =>
    setDomains(
      domains.map((d) =>
        d.id === domainId
          ? { ...d, criteria: d.criteria.filter((c) => c.id !== criterionId) }
          : d,
      ),
    );
  const renameCriterion = (domainId, criterionId, name) =>
    setDomains(
      domains.map((d) =>
        d.id === domainId
          ? {
              ...d,
              criteria: d.criteria.map((c) =>
                c.id === criterionId ? { ...c, name } : c,
              ),
            }
          : d,
      ),
    );

  return (
    <section>
      <h2>1 · Define Domains &amp; Criteria</h2>
      <p className="step-note">
        Each domain represents one independent subject-matter team. Add the
        criteria (2–6 recommended) that team will weigh against each other.
        Comparisons never cross domain boundaries.
      </p>
      <div className="card-grid">
        {domains.map((d) => (
          <div className="card" key={d.id}>
            <div className="card-head">
              <input
                className="name-input domain-name"
                aria-label="Domain name"
                value={d.name}
                onChange={(e) => renameDomain(d.id, e.target.value)}
              />
              <button className="btn-ghost" onClick={() => removeDomain(d.id)}>
                Remove domain
              </button>
            </div>
            {d.criteria.length < 2 && (
              <p className="inline-note">
                Single-criterion domain: its criterion automatically receives a
                domain-internal weight of 1.0 (no pairwise grid needed), but
                threshold calibration in Step 2 still applies.
              </p>
            )}
            <ul className="criteria-list">
              {d.criteria.map((c) => (
                <li key={c.id}>
                  <input
                    className="name-input"
                    aria-label={`Criterion name in ${d.name}`}
                    value={c.name}
                    onChange={(e) => renameCriterion(d.id, c.id, e.target.value)}
                  />
                  <button
                    className="btn-ghost"
                    disabled={d.criteria.length <= 1}
                    onClick={() => removeCriterion(d.id, c.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <button
              className="btn-secondary"
              disabled={d.criteria.length >= 6}
              onClick={() => addCriterion(d.id)}
            >
              + Add criterion{d.criteria.length >= 6 ? ' (max 6)' : ''}
            </button>
          </div>
        ))}
      </div>
      <button className="btn-primary" onClick={addDomain}>
        + Add domain
      </button>
    </section>
  );
}

/* -------------------------------------------------------------- step 2 UI */

function DomainComparisonStep({ domains, setDomains }) {
  const setDomainComparison = (domainId, idA, idB, value) =>
    setDomains(
      domains.map((d) =>
        d.id === domainId
          ? { ...d, comparisons: setComparison(d.comparisons, idA, idB, value) }
          : d,
      ),
    );
  const setThresholds = (domainId, criterionId, lowMed, medHigh) =>
    setDomains(
      domains.map((d) =>
        d.id === domainId
          ? {
              ...d,
              criteria: d.criteria.map((c) =>
                c.id === criterionId ? { ...c, lowMed, medHigh } : c,
              ),
            }
          : d,
      ),
    );

  return (
    <section>
      <h2>2 · Domain Pairwise Comparison &amp; Threshold Calibration</h2>
      <p className="step-note">
        Each domain team compares its own criteria on the 1–9 scale, then sets
        Low/Medium and Medium/High breakpoints for every criterion on the shared
        1–10 scale. Each domain's consistency ratio is computed independently —
        no other domain's data can affect it.
      </p>
      {domains.map((d) => {
        const ids = d.criteria.map((c) => c.id);
        const matrix = buildMatrix(ids, d.comparisons);
        const analysis = analyzeMatrix(matrix);
        return (
          <div className="card domain-block" key={d.id}>
            <h3>{d.name}</h3>
            {d.criteria.length === 1 ? (
              <p className="inline-note">
                Single criterion — domain-internal weight is fixed at 1.0000; no
                pairwise comparison needed.
              </p>
            ) : (
              <>
                <div className="pair-list">
                  {d.criteria.map((a, i) =>
                    d.criteria.slice(i + 1).map((b) => (
                      <PairwiseRow
                        key={`${a.id}-${b.id}`}
                        a={a}
                        b={b}
                        comparisons={d.comparisons}
                        onChange={(idA, idB, v) => setDomainComparison(d.id, idA, idB, v)}
                      />
                    )),
                  )}
                </div>
                <MatrixPreview items={d.criteria} matrix={matrix} weights={analysis.weights} />
                <ConsistencyPanel
                  tier="domain"
                  analysis={analysis}
                  matrix={matrix}
                  items={d.criteria}
                />
              </>
            )}
            <h4>Low / Medium / High threshold calibration (shared 1–10 scale)</h4>
            {d.criteria.map((c) => (
              <ThresholdSlider
                key={c.id}
                criterion={c}
                onChange={(lowMed, medHigh) => setThresholds(d.id, c.id, lowMed, medHigh)}
              />
            ))}
          </div>
        );
      })}
    </section>
  );
}

/* -------------------------------------------------------------- step 3 UI */

function LensMappingStep({
  domains,
  lenses,
  setLenses,
  mapping,
  setMapping,
  lensComparisons,
  setLensComparisons,
}) {
  const leadershipTouched = Object.keys(lensComparisons).length > 0;

  const addLens = () =>
    setLenses([...lenses, makeLens(`Priority Group ${lenses.length + 1}`)]);
  const removeLens = (id) => {
    setLenses(lenses.filter((l) => l.id !== id));
    const nextMap = {};
    for (const [dId, lId] of Object.entries(mapping)) {
      if (lId !== id) nextMap[dId] = lId;
    }
    setMapping(nextMap);
    const nextComparisons = {};
    for (const [key, v] of Object.entries(lensComparisons)) {
      if (!key.split('|').includes(id)) nextComparisons[key] = v;
    }
    setLensComparisons(nextComparisons);
  };
  const renameLens = (id, name) =>
    setLenses(lenses.map((l) => (l.id === id ? { ...l, name } : l)));

  const unmappedLenses = lenses.filter(
    (l) => !domains.some((d) => mapping[d.id] === l.id),
  );

  return (
    <section>
      <h2>3 · Define &amp; Map Lenses</h2>
      <p className="step-note">
        Lenses are the board-level perspectives leadership will weigh in Step 4.
        Assign each domain to exactly one lens (a domain cannot split across
        lenses in this version).
      </p>
      <div className="two-col">
        <div className="card">
          <h3>Lenses</h3>
          <ul className="criteria-list">
            {lenses.map((l) => (
              <li key={l.id}>
                <input
                  className="name-input"
                  aria-label="Lens name"
                  value={l.name}
                  onChange={(e) => renameLens(l.id, e.target.value)}
                />
                <button
                  className="btn-ghost"
                  disabled={lenses.length <= 2}
                  onClick={() => removeLens(l.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <button className="btn-secondary" disabled={lenses.length >= 6} onClick={addLens}>
            + Add lens{lenses.length >= 6 ? ' (max 6)' : ''}
          </button>
        </div>
        <div className="card">
          <h3>Domain → Lens assignment</h3>
          <table className="mapping-table">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Mapped lens</th>
              </tr>
            </thead>
            <tbody>
              {domains.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>
                    <select
                      aria-label={`Lens assignment for ${d.name}`}
                      value={mapping[d.id] ?? ''}
                      onChange={(e) => setMapping({ ...mapping, [d.id]: e.target.value })}
                    >
                      <option value="" disabled>
                        — choose a lens —
                      </option>
                      {lenses.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Mapping overview</h3>
        <div className="lens-groups">
          {lenses.map((l) => {
            const mapped = domains.filter((d) => mapping[d.id] === l.id);
            return (
              <div className="lens-group" key={l.id}>
                <span className="lens-group-name">{l.name}</span>
                {mapped.length === 0 ? (
                  <span className="lens-group-empty">no domain mapped</span>
                ) : (
                  mapped.map((d) => (
                    <span className="lens-group-domain" key={d.id}>
                      {d.name}
                    </span>
                  ))
                )}
                {mapped.length > 1 && (
                  <span className="lens-group-note">
                    Multiple domains share this lens's full weight — see the
                    normalization note in Results.
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p className="inline-note">
          Re-assigning a domain between <em>existing</em> lenses does not
          invalidate the Step 4 leadership comparison — that comparison is
          between the lenses themselves, not the domains behind them.
        </p>
        {leadershipTouched && unmappedLenses.length > 0 && (
          <div className="banner banner-lens">
            <strong>Leadership tier needs revisiting:</strong> the leadership
            comparison has been completed, but{' '}
            {unmappedLenses.map((l) => `“${l.name}”`).join(', ')} now{' '}
            {unmappedLenses.length === 1 ? 'has' : 'have'} no mapped domain. Its
            weight is allocated but unused, which distorts the effective lens
            set. Map a domain to it or remove it, then redo Step 4.
          </div>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- step 4 UI */

function LeadershipStep({ lenses, lensComparisons, setLensComparisons }) {
  const ids = lenses.map((l) => l.id);
  const matrix = buildMatrix(ids, lensComparisons);
  const analysis = analyzeMatrix(matrix);
  return (
    <section>
      <h2>4 · Leadership Pairwise Comparison</h2>
      <p className="step-note">
        Leadership compares the lenses against one another on the same 1–9
        scale. Lens weights sum to 1 across all lenses. This tier's consistency
        ratio is entirely separate from every domain-level check.
      </p>
      <div className="card">
        <div className="pair-list">
          {lenses.map((a, i) =>
            lenses.slice(i + 1).map((b) => (
              <PairwiseRow
                key={`${a.id}-${b.id}`}
                a={a}
                b={b}
                comparisons={lensComparisons}
                onChange={(idA, idB, v) =>
                  setLensComparisons(setComparison(lensComparisons, idA, idB, v))
                }
              />
            )),
          )}
        </div>
        <MatrixPreview items={lenses} matrix={matrix} weights={analysis.weights} />
        <ConsistencyPanel tier="lens" analysis={analysis} matrix={matrix} items={lenses} />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- step 5 UI */

const COLUMNS = [
  { key: 'domainName', label: 'Domain' },
  { key: 'criterionName', label: 'Criterion' },
  { key: 'domainWeight', label: 'Domain-Internal Weight' },
  { key: 'lensName', label: 'Mapped Lens' },
  { key: 'lensWeight', label: 'Lens Weight' },
  { key: 'raw', label: 'Composite (raw)' },
  { key: 'normalized', label: 'Composite (normalized)' },
  { key: 'lowMed', label: 'Low/Med Threshold' },
  { key: 'medHigh', label: 'Med/High Threshold' },
];

function ResultsStep({ rows, warnings }) {
  const [sort, setSort] = useState({ key: 'normalized', dir: 'desc' });
  const [copied, setCopied] = useState(false);

  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      let cmp;
      if (typeof va === 'string' || typeof vb === 'string') {
        cmp = String(va ?? '').localeCompare(String(vb ?? ''));
      } else {
        cmp = (va ?? -Infinity) - (vb ?? -Infinity);
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [rows, sort]);

  const toggleSort = (key) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' },
    );

  const exportRows = () =>
    sorted.map((r) => [
      r.domainName,
      r.criterionName,
      fmt(r.domainWeight),
      r.lensName ?? '—',
      fmt(r.lensWeight),
      fmt(r.raw),
      fmt(r.normalized),
      r.lowMed.toFixed(1),
      r.medHigh.toFixed(1),
    ]);

  const copyTable = async () => {
    const lines = [COLUMNS.map((c) => c.label), ...exportRows()];
    const tsv = lines.map((l) => l.join('\t')).join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy the table below:', tsv);
    }
  };

  const downloadCsv = () => {
    const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [COLUMNS.map((c) => c.label), ...exportRows()];
    const csv = lines.map((l) => l.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'composite-criteria-weights.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const chartData = rows
    .filter((r) => r.normalized !== undefined)
    .sort((a, b) => b.normalized - a.normalized)
    .map((r) => ({
      name: `${r.domainName} · ${r.criterionName}`,
      value: r.normalized,
    }));
  const normalizedSum = rows.reduce((s, r) => s + (r.normalized ?? 0), 0);

  return (
    <section>
      <h2>5 · Results — Composite Weight Table</h2>
      <p className="step-note">
        The hand-off deliverable: one row per criterion with its
        domain-internal weight, its lens's leadership weight, the composite of
        the two (raw and normalized), and its Low/Medium/High breakpoints on
        the shared 1–10 scale. Click a column header to sort.
      </p>
      {warnings.map((w, i) => (
        <div key={i} className={`banner ${w.tier === 'lens' ? 'banner-lens' : 'banner-domain'}`}>
          {w.text}
        </div>
      ))}
      <div className="results-actions">
        <button className="btn-primary" onClick={copyTable}>
          {copied ? '✓ Copied' : 'Copy table (TSV)'}
        </button>
        <button className="btn-secondary" onClick={downloadCsv}>
          Download CSV
        </button>
      </div>
      <div className="table-scroll">
        <table className="results-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key}>
                  <button className="sort-btn" onClick={() => toggleSort(c.key)}>
                    {c.label}
                    {sort.key === c.key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.criterionId}>
                <td>{r.domainName}</td>
                <td>{r.criterionName}</td>
                <td className="num">{fmt(r.domainWeight)}</td>
                <td>{r.lensName ?? '— unmapped —'}</td>
                <td className="num">{fmt(r.lensWeight)}</td>
                <td className="num">{fmt(r.raw)}</td>
                <td className="num">
                  {fmt(r.normalized)}
                  {r.normalized !== undefined && (
                    <span className="pct"> ({pct(r.normalized)})</span>
                  )}
                </td>
                <td className="num">{r.lowMed.toFixed(1)}</td>
                <td className="num">{r.medHigh.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="inline-note">
        Raw composite = domain-internal weight × mapped lens weight; raw values
        are relative and need not sum to 1. Normalized composite = raw ÷ sum of
        all raw composites (currently sums to {normalizedSum.toFixed(4)}).
      </p>
      {chartData.length > 0 && (
        <div className="card">
          <h3>Criteria ranked by normalized composite weight</h3>
          <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 36 + 40)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 8 }}>
              <CartesianGrid horizontal={false} stroke="#e6eaf0" />
              <XAxis
                type="number"
                tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                tick={{ fill: '#5a6b7f', fontSize: 12 }}
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={210}
                tick={{ fill: '#1a2332', fontSize: 12 }}
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
              />
              <Tooltip
                formatter={(v) => [`${(v * 100).toFixed(2)}%`, 'Normalized composite weight']}
                cursor={{ fill: 'rgba(37, 99, 235, 0.06)' }}
              />
              <Bar dataKey="value" fill="#2563eb" barSize={16} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------- root */

const STEPS = [
  'Domains & Criteria',
  'Domain Comparison',
  'Lenses & Mapping',
  'Leadership Comparison',
  'Results',
];

export default function WeightingTool() {
  const [initial] = useState(initialState);
  const [domains, setDomains] = useState(initial.domains);
  const [lenses, setLenses] = useState(initial.lenses);
  const [mapping, setMapping] = useState(initial.mapping);
  const [lensComparisons, setLensComparisons] = useState({});
  const [step, setStep] = useState(0);

  const domainAnalyses = useMemo(() => {
    const out = {};
    for (const d of domains) {
      const matrix = buildMatrix(d.criteria.map((c) => c.id), d.comparisons);
      out[d.id] = analyzeMatrix(matrix);
    }
    return out;
  }, [domains]);

  const lensAnalysis = useMemo(() => {
    const matrix = buildMatrix(lenses.map((l) => l.id), lensComparisons);
    return analyzeMatrix(matrix);
  }, [lenses, lensComparisons]);

  const rows = useMemo(() => {
    const domainWeightsById = {};
    for (const d of domains) domainWeightsById[d.id] = domainAnalyses[d.id].weights;
    const lensWeightsById = {};
    lenses.forEach((l, i) => {
      lensWeightsById[l.id] = lensAnalysis.weights[i];
    });
    const composites = computeComposites(domains, domainWeightsById, mapping, lensWeightsById);
    const domainById = Object.fromEntries(domains.map((d) => [d.id, d]));
    const lensById = Object.fromEntries(lenses.map((l) => [l.id, l]));
    return composites.map((r) => {
      const domain = domainById[r.domainId];
      const criterion = domain.criteria.find((c) => c.id === r.criterionId);
      return {
        ...r,
        domainName: domain.name,
        criterionName: criterion.name,
        lensName: r.lensId ? lensById[r.lensId]?.name : undefined,
        lowMed: criterion.lowMed,
        medHigh: criterion.medHigh,
      };
    });
  }, [domains, lenses, mapping, domainAnalyses, lensAnalysis]);

  const warnings = useMemo(() => {
    const out = [];
    const unmapped = domains.filter((d) => !mapping[d.id] || !lenses.some((l) => l.id === mapping[d.id]));
    if (unmapped.length > 0) {
      out.push({
        tier: 'domain',
        text: `Unmapped domain${unmapped.length > 1 ? 's' : ''}: ${unmapped
          .map((d) => `“${d.name}”`)
          .join(', ')} — assign a lens in Step 3; unmapped criteria are excluded from composite weights.`,
      });
    }
    for (const d of domains) {
      if (domainAnalyses[d.id].cr > CR_THRESHOLD) {
        out.push({
          tier: 'domain',
          text: `Domain tier: “${d.name}” has CR = ${domainAnalyses[d.id].cr.toFixed(
            3,
          )} (> 0.10). Revisit its comparisons in Step 2.`,
        });
      }
    }
    if (lensAnalysis.cr > CR_THRESHOLD) {
      out.push({
        tier: 'lens',
        text: `Leadership tier: lens comparison has CR = ${lensAnalysis.cr.toFixed(
          3,
        )} (> 0.10). Revisit Step 4.`,
      });
    }
    const emptyLenses = lenses.filter((l) => !domains.some((d) => mapping[d.id] === l.id));
    if (emptyLenses.length > 0 && Object.keys(lensComparisons).length > 0) {
      out.push({
        tier: 'lens',
        text: `Lens${emptyLenses.length > 1 ? 'es' : ''} ${emptyLenses
          .map((l) => `“${l.name}”`)
          .join(', ')} carr${emptyLenses.length > 1 ? 'y' : 'ies'} leadership weight but ha${
          emptyLenses.length > 1 ? 've' : 's'
        } no mapped domain — that weight is unused. Remove or map the lens, then redo Step 4.`,
      });
    }
    const shared = lenses.filter((l) => domains.filter((d) => mapping[d.id] === l.id).length > 1);
    if (shared.length > 0) {
      out.push({
        tier: 'domain',
        text: `Note: ${shared
          .map((l) => `“${l.name}”`)
          .join(', ')} ${shared.length > 1 ? 'have' : 'has'} multiple mapped domains. Each mapped domain receives the lens's full weight (this prototype does not split a lens's weight across its domains) — the normalized composite column already accounts for the resulting scale difference.`,
      });
    }
    return out;
  }, [domains, lenses, mapping, domainAnalyses, lensAnalysis, lensComparisons]);

  return (
    <div className="app">
      <style>{CSS}</style>
      <header className="app-header">
        <h1>Multi-Tier Criteria Weighting Tool</h1>
        <p>
          Structured weighting for spatial / routing-type decision analysis:
          domain-level pairwise comparison, board-level lens prioritization,
          and a composite weight table ready for spatial-overlay hand-off.
        </p>
      </header>
      <nav className="step-nav" aria-label="Workflow steps">
        {STEPS.map((label, i) => (
          <button
            key={label}
            className={`step-btn ${step === i ? 'active' : ''}`}
            onClick={() => setStep(i)}
          >
            <span className="step-num">{i + 1}</span>
            {label}
          </button>
        ))}
      </nav>
      <main>
        {step === 0 && (
          <DefineStep
            domains={domains}
            setDomains={setDomains}
            mapping={mapping}
            setMapping={setMapping}
            lenses={lenses}
          />
        )}
        {step === 1 && <DomainComparisonStep domains={domains} setDomains={setDomains} />}
        {step === 2 && (
          <LensMappingStep
            domains={domains}
            lenses={lenses}
            setLenses={setLenses}
            mapping={mapping}
            setMapping={setMapping}
            lensComparisons={lensComparisons}
            setLensComparisons={setLensComparisons}
          />
        )}
        {step === 3 && (
          <LeadershipStep
            lenses={lenses}
            lensComparisons={lensComparisons}
            setLensComparisons={setLensComparisons}
          />
        )}
        {step === 4 && <ResultsStep rows={rows} warnings={warnings} />}
      </main>
      <footer className="app-footer">
        <div className="footer-nav">
          <button className="btn-secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>
            ← Back
          </button>
          <button
            className="btn-primary"
            disabled={step === STEPS.length - 1}
            onClick={() => setStep(step + 1)}
          >
            Next →
          </button>
        </div>
        <p>
          Weights: geometric-mean approximation of the principal eigenvector ·
          consistency checked independently per matrix (CR threshold 0.10) ·
          prototype only, state is in-memory and resets on reload.
        </p>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ style */

const CSS = `
:root {
  --ink: #1a2332;
  --ink-2: #5a6b7f;
  --ink-3: #8794a3;
  --line: #dde3ec;
  --surface: #f5f7fa;
  --card: #ffffff;
  --accent: #2563eb;
  --accent-dark: #1d4ed8;
  --accent-soft: #eff4fe;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--surface); }
.app {
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  color: var(--ink);
  max-width: 1180px;
  margin: 0 auto;
  padding: 24px 28px 48px;
  line-height: 1.45;
}
.app-header h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -0.01em; }
.app-header p { margin: 0 0 20px; color: var(--ink-2); max-width: 72ch; }
h2 { font-size: 18px; margin: 8px 0 4px; }
h3 { font-size: 15px; margin: 0 0 10px; }
h4 { font-size: 13px; margin: 18px 0 8px; color: var(--ink-2); text-transform: uppercase; letter-spacing: 0.05em; }
.step-note { color: var(--ink-2); margin: 0 0 18px; max-width: 78ch; }
.inline-note { color: var(--ink-2); font-size: 13px; margin: 8px 0; max-width: 78ch; }

.step-nav { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
.step-btn {
  display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--line); background: var(--card); color: var(--ink-2);
  padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600;
}
.step-btn.active { border-color: var(--accent); color: var(--accent-dark); background: var(--accent-soft); }
.step-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 50%; font-size: 11px;
  background: var(--line); color: var(--ink-2);
}
.step-btn.active .step-num { background: var(--accent); color: #fff; }

.card {
  background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  padding: 16px 18px; margin-bottom: 16px;
}
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; margin-bottom: 16px; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.two-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.domain-block { margin-bottom: 20px; }

.name-input {
  font: inherit; color: var(--ink); border: 1px solid var(--line); border-radius: 6px;
  padding: 6px 10px; width: 100%; background: #fff;
}
.name-input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.domain-name { font-weight: 700; }
.criteria-list { list-style: none; padding: 0; margin: 0 0 10px; display: flex; flex-direction: column; gap: 8px; }
.criteria-list li { display: flex; gap: 8px; align-items: center; }

button { font: inherit; cursor: pointer; }
button:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-primary {
  background: var(--accent); color: #fff; border: 1px solid var(--accent-dark);
  border-radius: 8px; padding: 8px 16px; font-weight: 600;
}
.btn-primary:hover:not(:disabled) { background: var(--accent-dark); }
.btn-secondary {
  background: #fff; color: var(--accent-dark); border: 1px solid var(--line);
  border-radius: 8px; padding: 8px 14px; font-weight: 600;
}
.btn-ghost {
  background: none; border: none; color: var(--ink-3); font-size: 12px;
  padding: 4px 6px; border-radius: 6px; white-space: nowrap;
}
.btn-ghost:hover:not(:disabled) { color: #b4232a; background: #fbeaea; }

.pair-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.pair-row {
  display: grid; grid-template-columns: minmax(110px, 1fr) minmax(260px, 2fr) minmax(110px, 1fr);
  gap: 10px; align-items: center;
}
.pair-name { font-size: 13px; color: var(--ink-2); }
.pair-left { text-align: right; }
.pair-name.favored { color: var(--accent-dark); font-weight: 700; }
.pair-row select, .mapping-table select {
  font: inherit; font-size: 13px; width: 100%; padding: 6px 8px;
  border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--ink);
}

.table-scroll { overflow-x: auto; }
.matrix-table, .results-table, .mapping-table { border-collapse: collapse; font-size: 13px; width: 100%; }
.matrix-table { width: auto; margin-bottom: 12px; }
.matrix-table th, .matrix-table td, .results-table th, .results-table td,
.mapping-table th, .mapping-table td {
  border: 1px solid var(--line); padding: 6px 10px; text-align: left;
}
.matrix-table td { text-align: center; min-width: 52px; font-variant-numeric: tabular-nums; }
.matrix-table td.diag { color: var(--ink-3); background: var(--surface); }
.matrix-table th { background: var(--surface); font-weight: 600; }
.weight-col { background: var(--accent-soft); font-weight: 700; }
.mapping-table td, .mapping-table th { border-left: none; border-right: none; }

.cr-panel {
  border-radius: 8px; padding: 10px 14px; font-size: 13px; margin-top: 4px;
  display: flex; flex-direction: column; gap: 6px;
}
.cr-tag {
  align-self: flex-start; font-size: 10px; font-weight: 800; letter-spacing: 0.08em;
  text-transform: uppercase; padding: 2px 8px; border-radius: 99px;
}
.cr-ok { background: #eef6ef; color: #23593a; }
.cr-ok .cr-tag { background: #d3e8d8; color: #23593a; }
.cr-warn.cr-domain { background: #fdf3e0; color: #8a5a13; border: 1px solid #eccf96; }
.cr-warn.cr-domain .cr-tag { background: #f2ddb0; color: #8a5a13; }
.cr-warn.cr-lens { background: #f2ecfd; color: #55329c; border: 1px solid #cebff0; }
.cr-warn.cr-lens .cr-tag { background: #ded1f6; color: #55329c; }
.cr-ok.cr-lens .cr-tag { background: #ded1f6; color: #55329c; }
.cr-worst { margin: 0; padding-left: 18px; }

.banner { border-radius: 8px; padding: 10px 14px; font-size: 13px; margin-bottom: 10px; }
.banner-domain { background: #fdf3e0; color: #8a5a13; border: 1px solid #eccf96; }
.banner-lens { background: #f2ecfd; color: #55329c; border: 1px solid #cebff0; }

.threshold-block { border-top: 1px solid var(--line); padding: 12px 0 6px; }
.threshold-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
.threshold-name { font-weight: 600; font-size: 14px; }
.threshold-readout { font-size: 13px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.dual-slider { position: relative; height: 34px; }
.band {
  position: absolute; top: 6px; left: 0; right: 0; height: 22px;
  display: flex; border-radius: 6px; overflow: hidden; border: 1px solid var(--line);
}
.band > div { display: flex; align-items: center; justify-content: center; }
.band span { font-size: 11px; font-weight: 700; }
.band-low { background: #dbe9fd; color: #1e4ea8; }
.band-med { background: #93bdf5; color: #12336e; }
.band-high { background: #2563eb; color: #ffffff; }
.dual-slider input[type=range] {
  position: absolute; top: 0; left: 0; width: 100%; height: 34px; margin: 0;
  -webkit-appearance: none; appearance: none; background: none; pointer-events: none;
}
.dual-slider input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; pointer-events: auto;
  width: 18px; height: 30px; border-radius: 5px; background: #fff;
  border: 2px solid var(--accent-dark); box-shadow: 0 1px 3px rgba(16, 32, 64, 0.3); cursor: ew-resize;
}
.dual-slider input[type=range]::-moz-range-thumb {
  pointer-events: auto; width: 14px; height: 26px; border-radius: 5px; background: #fff;
  border: 2px solid var(--accent-dark); box-shadow: 0 1px 3px rgba(16, 32, 64, 0.3); cursor: ew-resize;
}
.dual-slider input[type=range]::-moz-range-track { background: none; }
.threshold-inputs { display: flex; gap: 18px; margin-top: 6px; flex-wrap: wrap; }
.threshold-inputs label { font-size: 12px; color: var(--ink-2); display: flex; flex-direction: column; gap: 4px; }
.threshold-inputs input {
  font: inherit; width: 90px; padding: 5px 8px; border: 1px solid var(--line);
  border-radius: 6px; color: var(--ink);
}

.lens-groups { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
.lens-group { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lens-group-name {
  font-weight: 700; font-size: 13px; background: var(--accent-soft); color: var(--accent-dark);
  padding: 4px 10px; border-radius: 99px;
}
.lens-group-domain {
  font-size: 13px; background: var(--surface); border: 1px solid var(--line);
  padding: 4px 10px; border-radius: 99px;
}
.lens-group-empty { font-size: 13px; color: var(--ink-3); font-style: italic; }
.lens-group-note { font-size: 12px; color: #8a5a13; }

.results-actions { display: flex; gap: 10px; margin-bottom: 12px; }
.results-table th { background: var(--surface); padding: 0; }
.sort-btn {
  background: none; border: none; font: inherit; font-weight: 700; font-size: 12.5px;
  color: var(--ink); padding: 8px 10px; width: 100%; text-align: left; white-space: nowrap;
}
.sort-btn:hover { color: var(--accent-dark); }
.results-table { margin-bottom: 10px; }
.results-table td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.results-table .pct { color: var(--ink-3); font-size: 12px; }

.app-footer { margin-top: 28px; border-top: 1px solid var(--line); padding-top: 14px; }
.footer-nav { display: flex; justify-content: space-between; margin-bottom: 12px; }
.app-footer p { color: var(--ink-3); font-size: 12px; max-width: 90ch; }

@media (max-width: 760px) {
  .pair-row { grid-template-columns: 1fr; gap: 4px; }
  .pair-left { text-align: left; }
}
`;
