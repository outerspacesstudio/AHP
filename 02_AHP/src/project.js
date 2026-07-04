// Project-state model: factories, domain color palette, save/load
// serialization, and the built-in sample project. Pure JS (no JSX) so the
// node test suite can validate it directly.

import { setComparison } from './ahp.js';

export const APP_ID = 'multi-tier-criteria-weighting-tool';
export const FILE_VERSION = 2;

// 10 categorical swatches, CVD-validated as an ordered set (worst adjacent
// ΔE 24.2 under protanopia simulation). Order matters — assign in sequence.
export const DOMAIN_COLORS = [
  { hex: '#2a78d6', name: 'Blue' },
  { hex: '#1baf7a', name: 'Green-teal' },
  { hex: '#eda100', name: 'Amber' },
  { hex: '#008300', name: 'Green' },
  { hex: '#4a3aa7', name: 'Violet' },
  { hex: '#e34948', name: 'Red' },
  { hex: '#e87ba4', name: 'Pink' },
  { hex: '#eb6834', name: 'Orange' },
  { hex: '#0d94ba', name: 'Teal' },
  { hex: '#9d5c0d', name: 'Brown' },
];

export const newId = (prefix) =>
  `${prefix}${Math.random().toString(36).slice(2, 10)}`;

// Threshold invariant: 1 ≤ lowMed ≤ medHigh ≤ high ≤ 10. Values above `high`
// are capped at High (no separate zone). Applied on every edit and on import.
export function clampThresholds(lowMed, medHigh, high) {
  const clamp = (v, lo, hi, fallback) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  const h = clamp(high, 1, 10, 10);
  const m = clamp(medHigh, 1, h, Math.min(7, h));
  const l = clamp(lowMed, 1, m, Math.min(4, m));
  return { lowMed: l, medHigh: m, high: h };
}

export const makeCriterion = (name) => ({
  id: newId('c'),
  name,
  lowMed: 4,
  medHigh: 7,
  high: 10,
});

export const makeDomain = (name, criterionNames, color) => ({
  id: newId('d'),
  name,
  color,
  criteria: criterionNames.map(makeCriterion),
  comparisons: {},
});

export const makeLens = (name) => ({ id: newId('l'), name });

// First palette color not already used by a domain (falls back to cycling).
export function nextColor(domains) {
  const used = new Set(domains.map((d) => d.color));
  const free = DOMAIN_COLORS.find((c) => !used.has(c.hex));
  return free ? free.hex : DOMAIN_COLORS[domains.length % DOMAIN_COLORS.length].hex;
}

/* ------------------------------------------------------------- save / load */

export function serializeProject({ domains, lenses, mapping, lensComparisons }) {
  return JSON.stringify(
    {
      app: APP_ID,
      version: FILE_VERSION,
      savedAt: new Date().toISOString(),
      state: { domains, lenses, mapping, lensComparisons },
    },
    null,
    2,
  );
}

const isStr = (v) => typeof v === 'string' && v.length > 0;

function sanitizeComparisons(raw, validIds) {
  const out = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [key, value] of Object.entries(raw)) {
    const ids = key.split('|');
    if (ids.length !== 2) continue;
    if (!validIds.has(ids[0]) || !validIds.has(ids[1])) continue;
    const v = Number(value);
    if (!Number.isFinite(v) || v < 1 / 9 - 1e-9 || v > 9 + 1e-9) continue;
    out[key] = v;
  }
  return out;
}

// Parses and validates a saved project file. Throws Error with a readable
// message on anything unusable; silently repairs what it safely can
// (thresholds re-clamped, unknown comparison keys and mappings dropped,
// missing colors auto-assigned).
export function parseProject(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not a valid JSON file.');
  }
  if (data?.app !== APP_ID) {
    throw new Error('This file was not exported by this tool.');
  }
  if (typeof data.version !== 'number' || data.version > FILE_VERSION) {
    throw new Error(
      `Unsupported file version ${data.version} (this build reads up to ${FILE_VERSION}).`,
    );
  }
  const s = data.state;
  if (!s || !Array.isArray(s.domains) || !Array.isArray(s.lenses)) {
    throw new Error('File is missing domain or lens data.');
  }
  if (s.domains.length === 0) throw new Error('File contains no domains.');
  if (s.lenses.length === 0) throw new Error('File contains no lenses.');

  const seenIds = new Set();
  const uniqueId = (id, kind) => {
    if (!isStr(id) || seenIds.has(id)) {
      throw new Error(`File contains a ${kind} with a missing or duplicate id.`);
    }
    seenIds.add(id);
    return id;
  };

  const domains = s.domains.map((d, i) => {
    if (!Array.isArray(d?.criteria) || d.criteria.length < 1) {
      throw new Error(`Domain ${i + 1} has no criteria.`);
    }
    const criteria = d.criteria.map((c) => ({
      id: uniqueId(c?.id, 'criterion'),
      name: isStr(c?.name) ? c.name : 'Unnamed criterion',
      ...clampThresholds(Number(c?.lowMed), Number(c?.medHigh), Number(c?.high)),
    }));
    const criterionIds = new Set(criteria.map((c) => c.id));
    return {
      id: uniqueId(d?.id, 'domain'),
      name: isStr(d?.name) ? d.name : `Domain ${i + 1}`,
      color: isStr(d?.color) && /^#[0-9a-fA-F]{6}$/.test(d.color)
        ? d.color
        : DOMAIN_COLORS[i % DOMAIN_COLORS.length].hex,
      criteria,
      comparisons: sanitizeComparisons(d?.comparisons, criterionIds),
    };
  });

  const lenses = s.lenses.map((l, i) => ({
    id: uniqueId(l?.id, 'lens'),
    name: isStr(l?.name) ? l.name : `Priority Group ${i + 1}`,
  }));
  const lensIds = new Set(lenses.map((l) => l.id));
  const domainIds = new Set(domains.map((d) => d.id));

  const mapping = {};
  if (typeof s.mapping === 'object' && s.mapping !== null) {
    for (const [dId, lId] of Object.entries(s.mapping)) {
      if (domainIds.has(dId) && lensIds.has(lId)) mapping[dId] = lId;
    }
  }

  return {
    domains,
    lenses,
    mapping,
    lensComparisons: sanitizeComparisons(s.lensComparisons, lensIds),
  };
}

/* --------------------------------------------------------- sample project */

// Fully populated generic demo state: varied judgments (every matrix CR
// within the 0.10 threshold), varied thresholds including a capped High,
// and all four palette-assigned colors.
export function sampleProject() {
  const domains = [
    makeDomain(
      'Sample Domain 1',
      ['Factor 1A', 'Factor 1B', 'Factor 1C'],
      DOMAIN_COLORS[0].hex,
    ),
    makeDomain(
      'Sample Domain 2',
      ['Factor 2A', 'Factor 2B', 'Factor 2C', 'Factor 2D'],
      DOMAIN_COLORS[1].hex,
    ),
    makeDomain('Sample Domain 3', ['Factor 3A', 'Factor 3B'], DOMAIN_COLORS[2].hex),
    makeDomain(
      'Sample Domain 4',
      ['Factor 4A', 'Factor 4B', 'Factor 4C'],
      DOMAIN_COLORS[3].hex,
    ),
  ];

  const pairs = (d, entries) => {
    for (const [i, j, v] of entries) {
      d.comparisons = setComparison(d.comparisons, d.criteria[i].id, d.criteria[j].id, v);
    }
  };
  pairs(domains[0], [
    [0, 1, 3],
    [0, 2, 5],
    [1, 2, 2],
  ]);
  pairs(domains[1], [
    [0, 1, 2],
    [0, 2, 4],
    [0, 3, 6],
    [1, 2, 2],
    [1, 3, 3],
    [2, 3, 2],
  ]);
  pairs(domains[2], [[0, 1, 3]]);
  pairs(domains[3], [
    [0, 1, 1 / 2],
    [0, 2, 2],
    [1, 2, 4],
  ]);

  const thresholds = {
    'Factor 1A': [3, 6, 9],
    'Factor 1B': [4, 7, 10],
    'Factor 1C': [2, 5, 8],
    'Factor 2A': [4, 6, 8],
    'Factor 2B': [3, 5.5, 9],
    'Factor 2C': [4, 7, 10],
    'Factor 2D': [5, 7, 9],
    'Factor 3A': [2.5, 5, 7.5],
    'Factor 3B': [4, 6.5, 10],
    'Factor 4A': [3, 6, 10],
    'Factor 4B': [4, 7, 9],
    'Factor 4C': [3.5, 6, 8.5],
  };
  for (const d of domains) {
    d.criteria = d.criteria.map((c) => {
      const [lowMed, medHigh, high] = thresholds[c.name];
      return { ...c, lowMed, medHigh, high };
    });
  }

  const lenses = [
    makeLens('Priority Group 1'),
    makeLens('Priority Group 2'),
    makeLens('Priority Group 3'),
    makeLens('Priority Group 4'),
  ];
  let lensComparisons = {};
  const lensPairs = [
    [0, 1, 2],
    [0, 2, 3],
    [0, 3, 5],
    [1, 2, 2],
    [1, 3, 3],
    [2, 3, 2],
  ];
  for (const [i, j, v] of lensPairs) {
    lensComparisons = setComparison(lensComparisons, lenses[i].id, lenses[j].id, v);
  }

  const mapping = {};
  domains.forEach((d, i) => {
    mapping[d.id] = lenses[i].id;
  });

  return { domains, lenses, mapping, lensComparisons };
}
