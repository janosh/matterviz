# Bond-Order Perception — Design Spec

Date: 2026-05-18
Status: Approved (pending written-spec review)
Target: matterviz (MIT), branch `feat/multi-bond-rendering`

## 1. Problem & Goal

The applied patch (`matterviz-local-edits`, base commit `77e434ed`) adds:

- `BondOrder` type `1 | 1.5 | 2 | 3 | 'aromatic'`
- Multi-bond render geometry (`get_bond_render_matrices`: double = 2 cylinders,
  triple = 3, aromatic/1.5 = asymmetric double)
- Manual right-click bond-order override (`bond_order_overrides`, bindable)
- Bond order consumed from a structure object that already carries
  `bonds[].bond_order`

Gap: nothing **perceives** bond order from coordinates. POSCAR/CIF/XYZ carry no
bond order, and matterviz has no mol2/SDF parser. Everything renders single
unless the user right-clicks.

Goal: add automatic bond-order perception (single/double/triple/aromatic +
Kekulé) for main-group/organic systems at chemistry-grade quality, with honest
single-bond fallback for metals/inorganic/delocalized systems, and keep manual
override authoritative.

## 2. Non-Goals

- Robust organometallic perception (η-hapticity, M–M, dative bonds) — unsolved;
  explicitly out of scope, falls back to single bonds.
- Integer/aromatic bond orders for delocalized inorganic lattices
  (TM oxides) — chemically ill-defined; falls back to single bonds.
- A mol2/SDF/MOL file parser — separate concern, not in this spec.
- Implicit-hydrogen inference — coordinates assumed to contain all atoms.

## 3. Architecture & Boundaries

New pure module `src/lib/structure/bond-order-perception.ts`:

- No Svelte dependency. Independently unit-testable.
- Input: `sites` + detected `BondPair[]` from the existing connectivity
  strategies (`electroneg_ratio` / `solid_angle`) — connectivity only.
- Output: same `BondPair[]` with `bond_order` filled, plus metadata
  `{ perceived: boolean, aromatic_ring?: number, kekule_order?: BondOrder }`.
- Integration point: after connectivity detection, before render.
- Gated by new `settings.ts` flag `auto_bond_order`, **default off** (preserves
  current single-bond behavior for existing users; opt-in).
- Precedence: connectivity → perception → manual overrides applied last. Manual
  `bond_order_overrides` always win; perception never clobbers an override and
  re-perception never clears overrides.

Module boundary contract:

- *Does*: takes a connectivity graph + coordinates, returns bond orders +
  confidence metadata.
- *Used by*: `StructureScene.svelte` (between bonding strategy and
  `get_bond_render_matrices`).
- *Depends on*: element data (`covalent_radius`, `n_valence`, `electrons`),
  nothing Svelte.

## 4. T1 — Chemistry-Grade Perception (main-group / organic)

Reference algorithm: **xyz2mol** (Kim & Kim, *Bull. Korean Chem. Soc.* 2015,
36, 1769), the algorithm underlying RDKit `DetermineBonds`. Deterministic,
peer-reviewed, de-facto standard. Clean-room reimplementation in TypeScript,
adapted from the MIT `jensengroup/xyz2mol` source.

Pipeline:

1. Build adjacency graph from `BondPair[]`; process each connected fragment
   independently.
2. **Element gating**: fragment eligible for T1 only if every atom is
   main-group (H B C N O F Si P S Cl Se Br I …) and each atom's degree is within
   its valence limits. Any transition/lanthanide/actinide metal, or any
   hypervalent/valence-unsatisfiable atom → whole fragment → T2.
3. **Valence-state enumeration + bond-order maximization** (xyz2mol core): per
   atom, enumerate allowed valence states from the atomic-valence table;
   subject to per-atom valence and a configurable **total charge** (default 0,
   xyz2mol `allowChargedFragments`-style logic), assign double/triple bonds to
   maximize total bond order. May yield multiple resonance solutions; pick a
   deterministic one (stable ordering).
4. **Formal charge**: `valence_electrons − 8 + bond_valence` (xyz2mol rule,
   special cases H/P/S). Used to validate the solution; surfaced in metadata.
5. **Ring perception**: SSSR via cycle basis.
6. **Aromaticity**: Hückel 4n+2 over near-planar sp²-candidate rings; flag
   aromatic atoms/bonds.
7. **Option A dual output**: aromatic bonds get BOTH an `aromatic` flag
   (rendered as 1.5 asymmetric) AND a valid Kekulé alternating single/double
   assignment (`kekule_order`); render-time toggle selects aromatic-circle vs
   Kekulé display.
8. If a fragment's valence cannot be closed under any enumerated state →
   whole fragment → T2 (never emit partially-wrong double bonds).

## 5. T2 — Graceful Degradation (metals / inorganic / unsatisfiable)

Reference behavior: **3Dmol.js** (BSD-3) — distance-based connectivity with
single-bond fallback.

- All bonds in the fragment stay `order = 1`, `perceived: false`.
- Rendered as plain single bonds, untouched.
- Available for T3 manual override.
- Never fabricate double/triple/aromatic bonds for these.

## 6. T3 — Manual Override (already in patch)

- Right-click context menu sets explicit bond order (Double/Triple/Aromatic).
- Order of application: perception → then manual overrides on top.
- Overrides persist; re-perception does not clear them; perception output never
  overwrites an override.

## 7. Error Handling & Edge Cases

- **Charged species**: optional total-charge input (default 0). carbonate /
  nitrate etc. get correct formal charges via xyz2mol logic rather than
  low-confidence guesses; formal charge surfaced in metadata.
- **Radicals / odd-electron**: no valid closed-valence solution → fragment → T2.
- **Performance**: skip perception for very large systems (cap, e.g. > 5000
  atoms) to bound the valence-enumeration search.
- **Determinism**: stable atom/bond ordering so Kekulé and resonance selection
  are reproducible across runs.
- **Disconnected graphs**: handled per fragment independently.

## 8. Testing

vitest (`tests/vitest/structure/bonding.test.ts`, extended):

- benzene → aromatic ring flagged + valid Kekulé
- CO₂ → two double bonds
- N₂ / HCN → triple bond
- methane / water → all single
- NaCl → no bonds
- ferrocene → T2 (metal), all single, `perceived: false`
- carbonate (CO₃²⁻) → T1 with correct formal charges (total charge input)
- acetate / pyridine → mixed single/double + aromatic where applicable

playwright (`tests/playwright/structure/bonds.test.ts`, extended):

- toggle `auto_bond_order` on/off changes rendering
- aromatic display toggle (circle vs Kekulé)
- manual override still wins after perception

Existing validation must stay green:
`svelte-check-rs` (0 err), the 5 vitest structure suites (244 tests),
`playwright bonds.test.ts` (4 tests), `vp build`.

## 9. Licensing (must keep matterviz MIT clean)

- **xyz2mol** = MIT → T1 reimplemented in TS, adapted from its source; retain
  copyright + MIT notice in the new file header
  ("adapted from jensengroup/xyz2mol, MIT").
- **RDKit** = BSD-3 → reference/cross-check only.
- **OpenBabel** = GPL-2 → **source code must NOT be read or adapted**
  (derivative-work / copyleft contamination). Public documentation concepts
  only (angle-based hybridization, planarity test), used as conceptual
  inspiration, not transcription.
- **3Dmol.js** = BSD-3 → T2 single-bond fallback approach may be referenced;
  retain BSD notice if any code is adapted.

## 10. Data Flow Summary

```
sites + lattice
   │
   ▼  existing bonding strategy (electroneg_ratio / solid_angle)
BondPair[]  (connectivity only, order undefined)
   │
   ▼  bond-order-perception.ts  (if settings.auto_bond_order)
       ├─ T1 (main-group): xyz2mol valence-max + Hückel + Kekulé
       └─ T2 (metal/inorganic/unsat): single, perceived=false
BondPair[]  (+ bond_order, + {perceived, aromatic_ring, kekule_order})
   │
   ▼  apply manual bond_order_overrides (T3, authoritative)
BondPair[]  (final)
   │
   ▼  get_bond_render_matrices  (existing) + aromatic display mode
rendered geometry
```
