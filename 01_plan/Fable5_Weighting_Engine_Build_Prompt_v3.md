# Build Prompt: Three-Tier Criteria Weighting Engine (v3 — SME-to-Lens Architecture, No Cost Model)

*Paste into Claude Fable 5 (Claude Code / agentic coding environment). Written as an autonomous build-test-iterate loop. This version is scoped to the weighting engine ONLY — no alternatives, no cost model. Output is a GIS-ready handoff table.*

---

## ROLE

You are a senior full-stack product engineer and decision-science specialist. Build a **standalone, domain-agnostic prototype**: a structured, multi-tier criteria weighting tool for spatial/routing-type decision analysis (e.g., corridor or pathway selection). No ties to any real client, company, or project. Generic labels only throughout.

## OBJECTIVE

Build a single-page React application implementing a **three-stage weighting architecture**:

1. **SME Domain Tier**: each of several independent domain teams defines its own criteria, pairwise-compares them, and calibrates Low/Medium/High thresholds for each criterion on a shared 1–10 scale.
2. **Domain-to-Lens Mapping**: each SME domain is mapped 1:1 to a board-level lens (e.g., "Risk," "Constructability," "Schedule," "Cost," "Community Impact" — use generic equivalents, not these exact real-world labels if they risk resembling a real program).
3. **Leadership Lens Tier**: leadership pairwise-compares the lenses against each other to set board-level priorities.

**Final output**: a composite weight per criterion (domain-internal weight × lens weight) plus that criterion's L/M/H threshold breakpoints — formatted as a clean, exportable table. This table is the deliverable; it represents what a GIS team would use to build a weighted spatial overlay. **Do not build any GIS, mapping, or alternatives-scoring functionality — the tool stops at this table.**

## CORE METHODOLOGY

### Stage 1 — SME Domain Tier (repeat structure for N domains, e.g., 4–5)
- User can add/name domains and, within each domain, add/name criteria (2–6 per domain)
- Pairwise comparison grid (Saaty 1–9 scale, reciprocal) among criteria *within* each domain only — never across domains
- Compute domain-internal weights (principal eigenvector or geometric mean approximation — state method and validate against a known textbook example)
- **Consistency Ratio check per domain**, independently. Warn visibly if CR > 0.10, identify largest contributing comparisons
- For each criterion, provide a **dual-handle slider** over a fixed 1–10 scale, letting the SME set the Low/Medium boundary and the Medium/High boundary (same scale used consistently across all domains and all criteria — no per-criterion custom scales)

### Stage 2 — Domain-to-Lens Mapping
- User defines a set of board-level lenses (e.g., 3–6)
- User assigns each SME domain to exactly one lens (1:1 mapping — a domain cannot split across two lenses in this version)
- Display this mapping clearly (e.g., a simple assignment table or grouped visual) before proceeding

### Stage 3 — Leadership Lens Tier
- Pairwise comparison grid among the lenses (same Saaty mechanics as Stage 1)
- Compute lens weights (sum to 1 across all lenses)
- **Independent Consistency Ratio check** for this tier, separate from any domain-level CR

### Composite Weight Calculation
- For every criterion: `Composite Weight = Domain-Internal Weight × (Lens Weight of that criterion's mapped lens)`
- Composite weights across the *entire* criteria set (all domains combined) should be understood as relative to one another, not necessarily summing to exactly 1 — display the raw composite value and also a normalized version (composite ÷ sum of all composites) so the output table is usable either way. Label both clearly.

### Final Output Table (the deliverable)
Columns: Domain | Criterion | Domain-Internal Weight | Mapped Lens | Lens Weight | Composite Weight (raw) | Composite Weight (normalized) | Low/Medium Threshold | Medium/High Threshold

- Sortable by composite weight (descending) to show criteria ranked by overall influence
- Exportable/copyable as a clean table (visual export is sufficient for this prototype — actual file download not required unless trivial to add)

## FUNCTIONAL FLOW (UI)

Tabbed/stepped structure:
1. **Define Domains & Criteria** — add domains, add criteria within each
2. **Domain Pairwise Comparison** — one comparison grid per domain, with live weight + CR display, and the L/M/H slider calibration per criterion on the same screen or an adjacent sub-step
3. **Define & Map Lenses** — create lenses, assign each domain to one lens
4. **Leadership Pairwise Comparison** — single comparison grid across lenses, live weight + CR display
5. **Results — Composite Weight Table** — the final GIS-handoff table described above, plus a simple bar chart showing criteria ranked by normalized composite weight

State must persist across all steps. React state only — no localStorage/sessionStorage.

## TECHNICAL REQUIREMENTS

- Single-file React component, default export, functional components + hooks
- Charting: `recharts` for the ranked composite-weight bar chart
- Clean, professional visual design — neutral/blue palette, strong typographic hierarchy, no cartoonish UI
- No branding, logos, or company names anywhere in code, comments, or labels
- Generic placeholder domain/lens/criteria names only (e.g., "Domain 1," "Site Factor A," "Lens: Priority Group 1") — never reference real clients, programs, or geographies, and avoid real SME discipline names (Geotech, Civil, Public, Constructability) verbatim in default/placeholder content
- Responsive for laptop-scale screens minimum

## AUTONOMOUS QA/QC & ITERATION PROTOCOL

Self-test against this checklist and fix failures before presenting:

**Math correctness**
- [ ] All pairwise matrices correctly reciprocal, diagonal = 1
- [ ] Domain-internal weights sum to 1 within each domain
- [ ] Lens weights sum to 1 across all lenses
- [ ] CR formula validated against a known textbook example, applied correctly and independently at BOTH tiers (domain and lens) — a domain's CR must never be affected by another domain's data, and the lens-tier CR must be entirely separate from any domain CR
- [ ] Composite weight correctly multiplies domain-internal weight × the weight of that criterion's mapped lens (not any other lens)
- [ ] Normalized composite weights across the full criteria set sum to 1

**Edge cases**
- [ ] A domain with only 1 criterion (weight defaults to 1.0, no pairwise grid needed, but slider calibration still required)
- [ ] Only 2 domains / only 2 lenses
- [ ] A lens with only 1 domain mapped to it
- [ ] User adds a criterion or domain after already completing pairwise comparisons elsewhere (grids must resize without losing unrelated data)
- [ ] Slider Low/Medium and Medium/High handles can't cross or invert (Low/Med boundary must always be ≤ Med/High boundary)
- [ ] Reassigning a domain to a different lens after the leadership tier is already complete — flag this as requiring lens-tier re-comparison if the lens set effectively changed, or clarify why it doesn't

**UI/UX**
- [ ] No console errors/warnings on load or interaction
- [ ] Every input labeled
- [ ] Both CR warnings (domain and lens tier) are visually distinct from each other so the user knows which tier has the consistency problem
- [ ] Slider calibration is intuitive — visible numeric readout of both threshold values, not just handle position
- [ ] Final table is sortable and clearly distinguishes raw vs. normalized composite weight

**Iteration loop**
1. Build first working version
2. Self-test against full checklist
3. Fix every failure
4. Re-run checklist
5. Repeat until all pass
6. Present the tool with a short note on: eigenvector method used, how normalization was handled, and known limitations vs. a production version (e.g., this version assumes strict 1:1 domain-to-lens mapping — note that many-to-one mapping would require an additional normalization step)

## OUTPUT CONSTRAINTS (non-negotiable)

- No domain-specific methodology names (do not reference "least cost path," "LCP," or similar named methodologies anywhere in code, comments, or UI text — keep it generic "weighted criteria" language)
- No company names, real or identifiable, anywhere
- No branding/logos/color schemes tied to any known firm
- All example/placeholder data self-evidently generic

## DELIVERABLE

One complete, runnable React artifact, plus a short summary covering: (1) eigenvector method and rationale, (2) how the two-tier CR validation was kept independent, (3) known limitations vs. production (especially the 1:1 domain-to-lens constraint), (4) confirmation the final table includes both composite weights and L/M/H thresholds per criterion.
