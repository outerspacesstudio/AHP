// Multi-tier criteria weighting tool (domain-agnostic prototype).
//
// Three-stage architecture:
//   1. Domain tier    — per-domain pairwise comparison of criteria + L/M/H
//                       threshold calibration on a shared 1–10 scale.
//   2. Mapping        — each domain is assigned to exactly one lens.
//   3. Leadership tier — pairwise comparison of the lenses themselves.
// Output: composite weight per criterion (domain-internal × lens weight),
// raw and normalized, plus L/M/H threshold breakpoints, as an exportable table.
//
// Weights use the geometric-mean approximation of the principal eigenvector
// (see src/ahp.js); consistency is checked independently per matrix.
// Project state (src/project.js) can be exported to / imported from JSON.

import React, { useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
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
import {
  DOMAIN_COLORS,
  makeCriterion,
  makeDomain,
  makeLens,
  nextColor,
  serializeProject,
  parseProject,
  sampleProject,
} from './project.js';

/* ---------------------------------------------------------------- helpers */

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
const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function Dot({ color }) {
  return <span className="dot" style={{ background: color }} aria-hidden="true" />;
}

/* ------------------------------------------------------------ initial data */

function initialState() {
  const domains = [];
  domains.push(
    makeDomain('Domain 1', ['Site Factor 1A', 'Site Factor 1B', 'Site Factor 1C'], DOMAIN_COLORS[0].hex),
    makeDomain('Domain 2', ['Site Factor 2A', 'Site Factor 2B', 'Site Factor 2C'], DOMAIN_COLORS[1].hex),
    makeDomain('Domain 3', ['Site Factor 3A', 'Site Factor 3B'], DOMAIN_COLORS[2].hex),
    makeDomain('Domain 4', ['Site Factor 4A', 'Site Factor 4B', 'Site Factor 4C'], DOMAIN_COLORS[3].hex),
  );
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
  return { domains, lenses, mapping, lensComparisons: {} };
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
  const { lowMed, medHigh, high } = criterion;
  const toPct = (v) => ((v - 1) / 9) * 100;
  // Per-handle clamps: handles can never cross or invert.
  const setLowMed = (v) => onChange(clampNum(v, 1, medHigh), medHigh, high);
  const setMedHigh = (v) => onChange(lowMed, clampNum(v, lowMed, high), high);
  const setHigh = (v) => onChange(lowMed, medHigh, clampNum(v, medHigh, 10));
  const capped = high < 10;
  return (
    <div className="threshold-block">
      <div className="threshold-head">
        <span className="threshold-name">{criterion.name}</span>
        <span className="threshold-readout">
          Low 1.0–{lowMed.toFixed(1)} · Medium {lowMed.toFixed(1)}–{medHigh.toFixed(1)} ·
          High {medHigh.toFixed(1)}–{high.toFixed(1)}
          {capped && ` · above ${high.toFixed(1)} caps at High`}
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
          <div className="band-high" style={{ width: `${toPct(high) - toPct(medHigh)}%` }}>
            {toPct(high) - toPct(medHigh) > 12 && <span>High</span>}
          </div>
          {capped && (
            <div className="band-cap" style={{ width: `${100 - toPct(high)}%` }}>
              {100 - toPct(high) > 16 && <span>caps at High</span>}
            </div>
          )}
        </div>
        <input
          type="range"
          min="1"
          max="10"
          step="0.5"
          value={lowMed}
          style={{ zIndex: lowMed > 7 ? 7 : 3 }}
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
        <input
          type="range"
          min="1"
          max="10"
          step="0.5"
          value={high}
          style={{ zIndex: 5 }}
          aria-label={`${criterion.name}: High upper boundary`}
          onChange={(e) => setHigh(Number(e.target.value))}
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
        <label>
          High upper boundary
          <input
            type="number"
            min="1"
            max="10"
            step="0.5"
            value={high}
            onChange={(e) => setHigh(Number(e.target.value))}
          />
        </label>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- step 1 UI */

function DefineStep({ domains, setDomains, mapping, setMapping, lenses }) {
  const addDomain = () => {
    const d = makeDomain(
      `Domain ${domains.length + 1}`,
      ['New Factor A', 'New Factor B'],
      nextColor(domains),
    );
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
  const patchDomain = (id, patch) =>
    setDomains(domains.map((d) => (d.id === id ? { ...d, ...patch } : d)));
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
        criteria (2–6 recommended) that team will weigh against each other, and
        pick a color — it identifies the domain on every later screen and in
        the results table.
      </p>
      <div className="card-grid">
        {domains.map((d) => (
          <div className="card domain-card" key={d.id} style={{ borderTopColor: d.color }}>
            <div className="card-head">
              <input
                className="name-input domain-name"
                aria-label="Domain name"
                value={d.name}
                onChange={(e) => patchDomain(d.id, { name: e.target.value })}
              />
              <button className="btn-ghost" onClick={() => removeDomain(d.id)}>
                Remove domain
              </button>
            </div>
            <div className="swatch-row" role="radiogroup" aria-label={`Color for ${d.name}`}>
              {DOMAIN_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  role="radio"
                  aria-checked={d.color === c.hex}
                  aria-label={`${c.name} color`}
                  className={`swatch ${d.color === c.hex ? 'selected' : ''}`}
                  style={{ background: c.hex }}
                  onClick={() => patchDomain(d.id, { color: c.hex })}
                />
              ))}
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

function CriteriaComparisonStep({ domains, setDomains }) {
  const setDomainComparison = (domainId, idA, idB, value) =>
    setDomains(
      domains.map((d) =>
        d.id === domainId
          ? { ...d, comparisons: setComparison(d.comparisons, idA, idB, value) }
          : d,
      ),
    );
  const setThresholds = (domainId, criterionId, lowMed, medHigh, high) =>
    setDomains(
      domains.map((d) =>
        d.id === domainId
          ? {
              ...d,
              criteria: d.criteria.map((c) =>
                c.id === criterionId ? { ...c, lowMed, medHigh, high } : c,
              ),
            }
          : d,
      ),
    );

  return (
    <section>
      <h2>2 · Criteria Comparison &amp; Threshold Calibration</h2>
      <p className="step-note">
        Each domain team compares its own criteria on the 1–9 scale, then sets
        Low/Medium, Medium/High, and High upper boundaries for every criterion
        on the shared 1–10 scale (values above the High upper boundary count as
        High). Each domain's consistency ratio is computed independently — no
        other domain's data can affect it.
      </p>
      {domains.map((d) => {
        const ids = d.criteria.map((c) => c.id);
        const matrix = buildMatrix(ids, d.comparisons);
        const analysis = analyzeMatrix(matrix);
        return (
          <div className="card domain-block" key={d.id} style={{ borderLeftColor: d.color }}>
            <h3>
              <Dot color={d.color} />
              {d.name}
            </h3>
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
                onChange={(lowMed, medHigh, high) =>
                  setThresholds(d.id, c.id, lowMed, medHigh, high)
                }
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
      <h2>3 · Domains → Lenses</h2>
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
                  <td>
                    <Dot color={d.color} />
                    {d.name}
                  </td>
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
                      <Dot color={d.color} />
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
  { key: 'domainName', label: 'Domain', width: 125 },
  { key: 'criterionName', label: 'Criterion', width: 125 },
  { key: 'domainWeight', label: 'Domain-Internal Weight', width: 105 },
  { key: 'lensName', label: 'Mapped Lens', width: 125 },
  { key: 'lensWeight', label: 'Lens Weight', width: 90 },
  { key: 'raw', label: 'Composite (raw)', width: 100 },
  { key: 'normalized', label: 'Composite (normalized)', width: 140 },
  { key: 'lowMed', label: 'Low/Med Threshold', width: 90 },
  { key: 'medHigh', label: 'Med/High Threshold', width: 90 },
  { key: 'high', label: 'High Upper Boundary', width: 90 },
];
const DEFAULT_WIDTHS = Object.fromEntries(COLUMNS.map((c) => [c.key, c.width]));
const MIN_COL_WIDTH = 64;

function ResultsStep({ rows, warnings }) {
  const [sort, setSort] = useState({ key: 'normalized', dir: 'desc' });
  const [copied, setCopied] = useState(false);
  const [colWidths, setColWidths] = useState(DEFAULT_WIDTHS);

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

  const startResize = (e, key) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = colWidths[key];
    const move = (ev) =>
      setColWidths((w) => ({
        ...w,
        [key]: Math.max(MIN_COL_WIDTH, startW + ev.clientX - startX),
      }));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const resetWidth = (key) =>
    setColWidths((w) => ({ ...w, [key]: DEFAULT_WIDTHS[key] }));
  const tableWidth = COLUMNS.reduce((s, c) => s + colWidths[c.key], 0);

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
      r.high.toFixed(1),
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
      color: r.color,
    }));
  const legendDomains = [];
  for (const r of rows) {
    if (r.normalized !== undefined && !legendDomains.some((d) => d.name === r.domainName)) {
      legendDomains.push({ name: r.domainName, color: r.color });
    }
  }
  const normalizedSum = rows.reduce((s, r) => s + (r.normalized ?? 0), 0);

  return (
    <section>
      <h2>5 · Results — Composite Weight Table</h2>
      <p className="step-note">
        The hand-off deliverable: one row per criterion with its
        domain-internal weight, its lens's leadership weight, the composite of
        the two (raw and normalized), and its threshold boundaries on the
        shared 1–10 scale. Click a column header to sort; drag a header's right
        edge to resize (double-click the edge to reset).
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
        <table
          className="results-table"
          style={{ tableLayout: 'fixed', width: tableWidth }}
        >
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} style={{ width: colWidths[c.key] }}>
                  <button className="sort-btn" onClick={() => toggleSort(c.key)}>
                    {c.label}
                    {sort.key === c.key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ''}
                  </button>
                  <span
                    className="col-resize"
                    role="separator"
                    aria-label={`Resize ${c.label} column`}
                    onPointerDown={(e) => startResize(e, c.key)}
                    onDoubleClick={() => resetWidth(c.key)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.criterionId}>
                <td>
                  <Dot color={r.color} />
                  {r.domainName}
                </td>
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
                <td className="num">{r.high.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="inline-note">
        Raw composite = domain-internal weight × mapped lens weight; raw values
        are relative and need not sum to 1. Normalized composite = raw ÷ sum of
        all raw composites (currently sums to {normalizedSum.toFixed(4)}).
        Values above a criterion's High upper boundary are treated as High.
      </p>
      {chartData.length > 0 && (
        <div className="card">
          <h3>Criteria ranked by normalized composite weight</h3>
          <div className="chart-legend" aria-label="Domain color legend">
            {legendDomains.map((d) => (
              <span key={d.name}>
                <Dot color={d.color} />
                {d.name}
              </span>
            ))}
          </div>
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
              <Bar dataKey="value" barSize={16} radius={[0, 4, 4, 0]}>
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Bar>
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
  'Criteria Comparison',
  'Domains → Lenses',
  'Leadership Comparison',
  'Results',
];

export default function WeightingTool() {
  const [initial] = useState(initialState);
  const [domains, setDomains] = useState(initial.domains);
  const [lenses, setLenses] = useState(initial.lenses);
  const [mapping, setMapping] = useState(initial.mapping);
  const [lensComparisons, setLensComparisons] = useState(initial.lensComparisons);
  const [step, setStep] = useState(0);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef(null);

  const applyProject = (state) => {
    setDomains(state.domains);
    setLenses(state.lenses);
    setMapping(state.mapping);
    setLensComparisons(state.lensComparisons);
    setImportError('');
  };

  const exportProject = () => {
    const json = serializeProject({ domains, lenses, mapping, lensComparisons });
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weighting-project-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importProject = async (file) => {
    if (!file) return;
    try {
      applyProject(parseProject(await file.text()));
    } catch (err) {
      setImportError(`Import failed: ${err.message}`);
    }
  };

  const loadSample = () => {
    if (
      window.confirm(
        'Replace the current project with the built-in sample project? Unsaved work will be lost.',
      )
    ) {
      applyProject(sampleProject());
    }
  };

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
        color: domain.color,
        criterionName: criterion.name,
        lensName: r.lensId ? lensById[r.lensId]?.name : undefined,
        lowMed: criterion.lowMed,
        medHigh: criterion.medHigh,
        high: criterion.high,
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
        <div className="project-bar">
          <button className="btn-secondary" onClick={exportProject}>
            Export project
          </button>
          <button className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
            Import project
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            aria-label="Import project file"
            style={{ display: 'none' }}
            onChange={(e) => {
              importProject(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button className="btn-secondary" onClick={loadSample}>
            Load sample project
          </button>
          {importError && (
            <span className="import-error" role="alert">
              {importError}
            </span>
          )}
        </div>
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
        {step === 1 && <CriteriaComparisonStep domains={domains} setDomains={setDomains} />}
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
          prototype only, state is in-memory — use Export project to save your
          work to a file.
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
.app-header p { margin: 0 0 12px; color: var(--ink-2); max-width: 72ch; }
h2 { font-size: 18px; margin: 8px 0 4px; }
h3 { font-size: 15px; margin: 0 0 10px; display: flex; align-items: center; gap: 8px; }
h4 { font-size: 13px; margin: 18px 0 8px; color: var(--ink-2); text-transform: uppercase; letter-spacing: 0.05em; }
.step-note { color: var(--ink-2); margin: 0 0 18px; max-width: 78ch; }
.inline-note { color: var(--ink-2); font-size: 13px; margin: 8px 0; max-width: 78ch; }

.project-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 18px; }
.import-error { color: #b4232a; font-size: 13px; font-weight: 600; }

.dot {
  display: inline-block; width: 10px; height: 10px; border-radius: 3px;
  margin-right: 7px; vertical-align: baseline; flex-shrink: 0;
}

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
.domain-card { border-top: 4px solid transparent; }
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; margin-bottom: 16px; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.two-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.domain-block { margin-bottom: 20px; border-left: 4px solid transparent; }

.swatch-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.swatch {
  width: 22px; height: 22px; border-radius: 6px; border: 2px solid transparent;
  padding: 0; cursor: pointer; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.08);
}
.swatch.selected { border-color: var(--ink); box-shadow: 0 0 0 2px #fff inset; }
.swatch:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

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
.band span { font-size: 11px; font-weight: 700; white-space: nowrap; }
.band-low { background: #dbe9fd; color: #1e4ea8; }
.band-med { background: #93bdf5; color: #12336e; }
.band-high { background: #2563eb; color: #ffffff; }
.band-cap {
  background: repeating-linear-gradient(45deg, #eef1f6, #eef1f6 5px, #dde3ec 5px, #dde3ec 10px);
  color: var(--ink-2);
}
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
  padding: 4px 10px; border-radius: 99px; display: inline-flex; align-items: center;
}
.lens-group-empty { font-size: 13px; color: var(--ink-3); font-style: italic; }
.lens-group-note { font-size: 12px; color: #8a5a13; }

.results-actions { display: flex; gap: 10px; margin-bottom: 12px; }
.results-table th { background: var(--surface); padding: 0; position: relative; }
.sort-btn {
  background: none; border: none; font: inherit; font-weight: 700; font-size: 12.5px;
  color: var(--ink); padding: 8px 10px; width: 100%; text-align: left;
  white-space: normal; line-height: 1.25;
}
.sort-btn:hover { color: var(--accent-dark); }
.col-resize {
  position: absolute; top: 0; right: -4px; width: 9px; height: 100%;
  cursor: col-resize; z-index: 2; touch-action: none;
}
.col-resize:hover { background: rgba(37, 99, 235, 0.25); }
.results-table { margin-bottom: 10px; }
.results-table td { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.results-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.results-table .pct { color: var(--ink-3); font-size: 12px; }

.chart-legend { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; font-size: 13px; color: var(--ink-2); }
.chart-legend > span { display: inline-flex; align-items: center; }

.app-footer { margin-top: 28px; border-top: 1px solid var(--line); padding-top: 14px; }
.footer-nav { display: flex; justify-content: space-between; margin-bottom: 12px; }
.app-footer p { color: var(--ink-3); font-size: 12px; max-width: 90ch; }

@media (max-width: 760px) {
  .pair-row { grid-template-columns: 1fr; gap: 4px; }
  .pair-left { text-align: left; }
}
`;
