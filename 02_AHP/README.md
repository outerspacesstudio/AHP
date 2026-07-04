# Multi-Tier Criteria Weighting Tool

A standalone, domain-agnostic prototype for structured criteria weighting in
spatial / routing-type decision analysis. Three tiers: independent domain-team
pairwise comparison, 1:1 domain-to-lens mapping, and a board-level lens
comparison — producing a composite weight per criterion plus its
Low/Medium/High threshold breakpoints, as an exportable table. The tool stops
at that table (no mapping or alternatives-scoring functionality).

## Run

```bash
npm install
npm run dev        # local dev server
npm run build      # production build
node tests/ahp.test.mjs   # math validation suite
```

## Method notes

**Eigenvector method.** Weights use the geometric-mean (logarithmic
least-squares) approximation of the principal eigenvector: each item's weight
is the geometric mean of its matrix row, normalized to sum to 1. For the
matrix sizes this tool allows (n ≤ 6) it tracks the true eigenvector closely,
is deterministic, and is exact for perfectly consistent matrices. The test
suite validates it against a widely published 4-criteria textbook example
(priorities 0.547 / 0.127 / 0.270 / 0.056, CR ≈ 0.044, matched within 0.01)
and cross-checks against an independent power-iteration eigenvector
computation.

**Two-tier consistency independence.** Every matrix is analyzed by a pure
function that sees only that matrix: each domain's CR is computed from that
domain's comparisons alone, and the leadership-tier CR from the lens
comparisons alone. There is no shared mutable state between analyses. The two
tiers use visually distinct warnings (amber "Domain tier" vs. violet
"Leadership tier"). λ_max is estimated from the geometric-mean weights
(mean of (Aw)_i / w_i), CI = (λ_max − n)/(n − 1), CR = CI / RI (Saaty's
random indices); CR > 0.10 triggers a warning that lists the pairwise
judgments deviating most (in log space) from the ratios the computed weights
imply. Matrices with n < 3 are perfectly consistent by construction (CR = 0).

**Comparison storage.** Judgments are stored sparsely — one entry per
unordered pair, keyed by item ids — so adding, removing, or renaming a
criterion/domain/lens never disturbs unrelated comparisons; new pairs default
to "equal importance."

## Known limitations vs. a production version

- **Strict 1:1 domain-to-lens mapping.** A domain cannot split across lenses.
  Many-to-one (several domains sharing a lens) is permitted but each mapped
  domain receives the lens's *full* weight — a production version would need
  a rule for splitting or renormalizing a lens's weight across its domains
  (the normalized composite column compensates for total scale, not for the
  relative advantage shared lenses gain).
- Lens weights are computed over **all defined lenses**, mapped or not; a
  lens with no mapped domain carries unused weight (the UI flags this and
  advises re-running the leadership comparison after removing or mapping it).
- Geometric-mean weights are an approximation of the principal eigenvector
  (they diverge slightly on inconsistent matrices; exact on consistent ones).
- State is in-memory only and resets on reload — no persistence, sessions,
  multi-user elicitation, or audit trail.
- Thresholds are two breakpoints on a fixed shared 1–10 scale; no
  per-criterion units, direction (benefit vs. cost), or value functions.

## Output table

Domain | Criterion | Domain-Internal Weight | Mapped Lens | Lens Weight |
Composite (raw) | Composite (normalized) | Low/Med Threshold | Med/High
Threshold — sortable by any column (defaults to normalized composite,
descending), copyable as TSV and downloadable as CSV. Raw composite =
domain-internal weight × mapped lens weight; normalized composite = raw ÷ sum
of all raw composites (sums to 1 across the full criteria set).
