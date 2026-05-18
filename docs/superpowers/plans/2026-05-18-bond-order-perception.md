# Bond-Order Perception Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic bond-order perception (single/double/triple + Hückel aromaticity + Kekulé) for main-group/organic structures, with single-bond fallback for metals/inorganic, gated by an opt-in setting, manual override authoritative.

**Architecture:** New pure module `src/lib/structure/bond-order-perception.ts` consumes the connectivity `BondPair[]` from existing bonding strategies and `sites`, runs a TypeScript clean-room reimplementation of the xyz2mol algorithm (Kim & Kim 2015, MIT) per connected fragment, and returns bond pairs annotated with `bond_order` + perception metadata. Wired into `StructureScene.svelte` as a `$derived` between connectivity and the existing override/render pipeline.

**Tech Stack:** TypeScript, Svelte 5 runes, Vitest, Playwright. Reference: `jensengroup/xyz2mol` (MIT). Element data via `$lib/element`.

---

## Reference Material (read before Task 3)

- xyz2mol source: https://raw.githubusercontent.com/jensengroup/xyz2mol/master/xyz2mol.py (MIT — may be read and adapted)
- Kim & Kim 2015, *Bull. Korean Chem. Soc.* 36, 1769 (algorithm paper)
- Spec: `docs/superpowers/specs/2026-05-18-bond-order-perception-design.md`
- **Do NOT read OpenBabel source (GPL-2).** Public docs concepts only, not needed here.

## File Structure

- Create `src/lib/structure/bond-order-perception.ts` — pure perception algorithm + types. One responsibility: connectivity graph + coords → bond orders + metadata.
- Create `tests/vitest/structure/bond-order-perception.test.ts` — unit tests.
- Modify `src/lib/settings.ts` — add `structure.auto_bond_order` (default off) and `structure.aromatic_display` enum.
- Modify `src/lib/structure/index.ts` — export new types from the module.
- Modify `src/lib/structure/StructureScene.svelte` — inject `perceived_bond_pairs` `$derived`; consume in `filtered_bond_pairs`; aromatic display mode passed to render.
- Modify `tests/playwright/structure/bonds.test.ts` — perception toggle, aromatic display, override-wins.

The new algorithm file must stay Svelte-free and pure so it is unit-testable in isolation.

---

### Task 1: Scaffold module, types, and settings flag

**Files:**
- Create: `src/lib/structure/bond-order-perception.ts`
- Test: `tests/vitest/structure/bond-order-perception.test.ts`
- Modify: `src/lib/settings.ts:407` (after `bond_thickness` block, inside `structure` config)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/vitest/structure/bond-order-perception.test.ts
import { describe, expect, test } from 'vitest'
import { perceive_bond_orders } from '$lib/structure/bond-order-perception'
import type { BondPair } from '$lib/structure'

// Minimal helper: build a BondPair list + sites from element symbols + edges.
function make_input(
  elements: string[],
  coords: [number, number, number][],
  edges: [number, number][],
) {
  const sites = elements.map((el, idx) => ({
    species: [{ element: el, occu: 1, oxidation_state: 0 }],
    xyz: coords[idx],
    abc: [0, 0, 0],
    label: `${el}${idx}`,
  })) as unknown as import('$lib/structure').Site[]
  const bonds: BondPair[] = edges.map(([i, j]) => ({
    pos_1: coords[i],
    pos_2: coords[j],
    site_idx_1: i,
    site_idx_2: j,
    bond_length: Math.hypot(
      coords[i][0] - coords[j][0],
      coords[i][1] - coords[j][1],
      coords[i][2] - coords[j][2],
    ),
    strength: 1,
    transform_matrix: new Float32Array(16),
  }))
  return { sites, bonds }
}

describe(`perceive_bond_orders scaffold`, () => {
  test(`returns one annotated pair per input pair`, () => {
    // H2: single bond, both atoms valence-satisfied
    const { sites, bonds } = make_input(
      [`H`, `H`],
      [[0, 0, 0], [0.74, 0, 0]],
      [[0, 1]],
    )
    const result = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(result).toHaveLength(1)
    expect(result[0].bond_order).toBe(1)
    expect(result[0].perceived).toBe(true)
  })
})

export { make_input }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/project/matterviz && pnpm exec vp test --run tests/vitest/structure/bond-order-perception.test.ts`
Expected: FAIL — `perceive_bond_orders` is not exported / module not found.

- [ ] **Step 3: Write minimal module scaffold**

```typescript
// src/lib/structure/bond-order-perception.ts
// Bond-order perception adapted from jensengroup/xyz2mol (MIT,
// Kim & Kim, Bull. Korean Chem. Soc. 2015, 36, 1769). Clean-room TS port.
import { element_data } from '$lib/element'
import type { BondOrder, BondPair, Site } from '$lib/structure'

const el_by_symbol = new Map(element_data.map((el) => [el.symbol, el]))

export type PerceptionOptions = { total_charge?: number; max_atoms?: number }

export type PerceivedBond = BondPair & {
  bond_order: BondOrder
  perceived: boolean
  aromatic_ring?: number
  kekule_order?: BondOrder
}

function primary_element(site: Site): string {
  return site.species?.reduce(
    (a, b) => (b.occu > a.occu ? b : a),
    site.species[0],
  )?.element ?? ``
}

// Placeholder: every bond single + perceived. Real algorithm in later tasks.
export function perceive_bond_orders(
  sites: Site[],
  bonds: BondPair[],
  _opts: PerceptionOptions = {},
): PerceivedBond[] {
  void el_by_symbol
  void primary_element
  return bonds.map((b) => ({ ...b, bond_order: 1, perceived: true }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/project/matterviz && pnpm exec vp test --run tests/vitest/structure/bond-order-perception.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Add settings flags**

In `src/lib/settings.ts`, immediately after the `bond_thickness` block (closing `},` near line 411) inside the `structure` config object, add:

```typescript
    auto_bond_order: {
      value: false,
      description:
        `Automatically perceive double/triple/aromatic bonds from geometry (main-group/organic; metals fall back to single)`,
    },
    aromatic_display: {
      value: `aromatic`,
      description: `How to render perceived aromatic rings`,
      enum: { aromatic: `Aromatic (1.5)`, kekule: `Kekulé (alternating)` },
    },
```

- [ ] **Step 6: Verify type check + commit**

Run: `cd ~/project/matterviz && pnpm exec svelte-check-rs --workspace . --threshold error`
Expected: `found 0 errors`.

```bash
cd ~/project/matterviz
git add src/lib/structure/bond-order-perception.ts tests/vitest/structure/bond-order-perception.test.ts src/lib/settings.ts
git commit -m "feat: scaffold bond-order perception module + settings flags"
```

---

### Task 2: Element gating + fragment splitting

**Files:**
- Modify: `src/lib/structure/bond-order-perception.ts`
- Test: `tests/vitest/structure/bond-order-perception.test.ts`

T1-eligible main-group set and per-element max valence (xyz2mol `atomic_valence` table, neutral common valences).

- [ ] **Step 1: Write the failing tests**

Append to the test file:

```typescript
import { split_fragments, is_main_group } from '$lib/structure/bond-order-perception'

describe(`element gating`, () => {
  test(`main-group elements recognized`, () => {
    expect(is_main_group(`C`)).toBe(true)
    expect(is_main_group(`O`)).toBe(true)
    expect(is_main_group(`Fe`)).toBe(false)
    expect(is_main_group(`Pt`)).toBe(false)
  })

  test(`splits disconnected graph into fragments`, () => {
    // Two separate H2 molecules → 2 fragments
    const frags = split_fragments(4, [[0, 1], [2, 3]])
    expect(frags).toHaveLength(2)
    expect(new Set(frags[0])).toEqual(new Set([0, 1]))
    expect(new Set(frags[1])).toEqual(new Set([2, 3]))
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ~/project/matterviz && pnpm exec vp test --run tests/vitest/structure/bond-order-perception.test.ts`
Expected: FAIL — `split_fragments`/`is_main_group` not exported.

- [ ] **Step 3: Implement gating + fragment split**

Add to `bond-order-perception.ts`:

```typescript
// Neutral common valences (xyz2mol atomic_valence, trimmed to main-group).
const ATOMIC_VALENCE: Record<string, number[]> = {
  H: [1], B: [3], C: [4], N: [3], O: [2], F: [1],
  Si: [4], P: [3, 5], S: [2, 4, 6], Cl: [1],
  Se: [2, 4, 6], Br: [1], Te: [2, 4, 6], I: [1],
}

export function is_main_group(symbol: string): boolean {
  return symbol in ATOMIC_VALENCE
}

export function split_fragments(
  n_atoms: number,
  edges: [number, number][],
): number[][] {
  const adj = new Map<number, number[]>()
  for (let i = 0; i < n_atoms; i++) adj.set(i, [])
  for (const [a, b] of edges) {
    adj.get(a)!.push(b)
    adj.get(b)!.push(a)
  }
  const seen = new Set<number>()
  const fragments: number[][] = []
  for (let start = 0; start < n_atoms; start++) {
    if (seen.has(start)) continue
    const stack = [start]
    const frag: number[] = []
    seen.add(start)
    while (stack.length) {
      const node = stack.pop()!
      frag.push(node)
      for (const nb of adj.get(node)!) {
        if (!seen.has(nb)) {
          seen.add(nb)
          stack.push(nb)
        }
      }
    }
    fragments.push(frag)
  }
  return fragments
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd ~/project/matterviz && pnpm exec vp test --run tests/vitest/structure/bond-order-perception.test.ts`
Expected: PASS (all tests so far).

- [ ] **Step 5: Commit**

```bash
cd ~/project/matterviz
git add src/lib/structure/bond-order-perception.ts tests/vitest/structure/bond-order-perception.test.ts
git commit -m "feat: element gating + connected-fragment splitting"
```

---

### Task 3: xyz2mol valence-maximization core (neutral)

**Files:**
- Modify: `src/lib/structure/bond-order-perception.ts`
- Test: `tests/vitest/structure/bond-order-perception.test.ts`

Port xyz2mol's AC→BO: build a per-fragment bond-order matrix that maximizes total bond order subject to each atom's allowed valence list.

- [ ] **Step 1: Write the failing tests**

Append:

```typescript
describe(`valence-maximization core (neutral)`, () => {
  test(`CO2: two double bonds`, () => {
    // O=C=O linear
    const { sites, bonds } = make_input(
      [`C`, `O`, `O`],
      [[0, 0, 0], [1.16, 0, 0], [-1.16, 0, 0]],
      [[0, 1], [0, 2]],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(r.map((b) => b.bond_order).sort()).toEqual([2, 2])
    expect(r.every((b) => b.perceived)).toBe(true)
  })

  test(`HCN: one single + one triple`, () => {
    const { sites, bonds } = make_input(
      [`H`, `C`, `N`],
      [[0, 0, 0], [1.07, 0, 0], [2.22, 0, 0]],
      [[0, 1], [1, 2]],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    const orders = r
      .map((b) => [b.site_idx_1, b.site_idx_2, b.bond_order] as const)
    expect(orders.find(([i, j]) => i === 0 && j === 1)?.[2]).toBe(1)
    expect(orders.find(([i, j]) => i === 1 && j === 2)?.[2]).toBe(3)
  })

  test(`methane: all single`, () => {
    const { sites, bonds } = make_input(
      [`C`, `H`, `H`, `H`, `H`],
      [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]],
      [[0, 1], [0, 2], [0, 3], [0, 4]],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(r.every((b) => b.bond_order === 1)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ~/project/matterviz && pnpm exec vp test --run tests/vitest/structure/bond-order-perception.test.ts`
Expected: FAIL — placeholder returns all order 1, CO2/HCN assertions fail.

- [ ] **Step 3: Implement valence-maximization (xyz2mol AC→BO port)**

Replace the placeholder `perceive_bond_orders` body. Add this core and rewrite the export:

```typescript
type Edge = { i: number; j: number; ref: BondPair }

// Allowed valence combinations across a fragment's atoms (cartesian product
// over each atom's ATOMIC_VALENCE list), tried lowest-sum first (xyz2mol).
function* valence_combinations(
  valence_lists: number[][],
): Generator<number[]> {
  const idx = valence_lists.map(() => 0)
  const combos: { sum: number; pick: number[] }[] = []
  const rec = (pos: number, acc: number[]) => {
    if (pos === valence_lists.length) {
      combos.push({ sum: acc.reduce((s, v) => s + v, 0), pick: [...acc] })
      return
    }
    for (const v of valence_lists[pos]) rec(pos + 1, [...acc, v])
  }
  rec(0, [])
  void idx
  combos.sort((a, b) => a.sum - b.sum)
  for (const c of combos) yield c.pick
}

// Greedily assign bond orders (xyz2mol get_BO): repeatedly add a bond order to
// the edge between the two most under-saturated atoms until none remain.
function assign_bond_orders(
  n: number,
  edges: Edge[],
  target_valence: number[],
): Map<number, number> | null {
  const order = new Map<number, number>() // edge index -> order
  edges.forEach((_, e) => order.set(e, 1))
  const used = (atom: number) =>
    edges.reduce(
      (s, e, ei) =>
        s + (e.i === atom || e.j === atom ? order.get(ei)! : 0),
      0,
    )
  // Raise orders while a pair of bonded under-saturated atoms exists.
  let progressed = true
  while (progressed) {
    progressed = false
    let best = -1
    let best_deficit = 0
    edges.forEach((e, ei) => {
      const da = target_valence[e.i] - used(e.i)
      const db = target_valence[e.j] - used(e.j)
      const d = Math.min(da, db)
      if (d > best_deficit && order.get(ei)! < 3) {
        best_deficit = d
        best = ei
      }
    })
    if (best >= 0) {
      order.set(best, order.get(best)! + 1)
      progressed = true
    }
  }
  for (let a = 0; a < n; a++) {
    if (used(a) !== target_valence[a]) return null
  }
  return order
}

function order_to_bond_order(o: number): BondOrder {
  return o >= 3 ? 3 : o === 2 ? 2 : 1
}
```

Then rewrite the export to drive T1 per fragment (T2 fallback added in Task 8 — for now non-main-group or unsolved fragments return single + `perceived: false`):

```typescript
export function perceive_bond_orders(
  sites: Site[],
  bonds: BondPair[],
  opts: PerceptionOptions = {},
): PerceivedBond[] {
  const max_atoms = opts.max_atoms ?? 5000
  if (sites.length > max_atoms) {
    return bonds.map((b) => ({ ...b, bond_order: 1, perceived: false }))
  }
  const edges: Edge[] = bonds.map((b) => ({
    i: b.site_idx_1,
    j: b.site_idx_2,
    ref: b,
  }))
  const result = new Map<BondPair, PerceivedBond>()
  const single = (b: BondPair): PerceivedBond => ({
    ...b,
    bond_order: 1,
    perceived: false,
  })
  for (const b of bonds) result.set(b, single(b))

  const frags = split_fragments(
    sites.length,
    edges.map((e) => [e.i, e.j] as [number, number]),
  )
  for (const frag of frags) {
    const atom_set = new Set(frag)
    const frag_edges = edges.filter((e) => atom_set.has(e.i))
    const symbols = frag.map((a) => primary_element(sites[a]))
    if (!symbols.every(is_main_group)) continue // → T2 (single, perceived:false)

    const idx_of = new Map(frag.map((a, k) => [a, k]))
    const local_edges: Edge[] = frag_edges.map((e) => ({
      i: idx_of.get(e.i)!,
      j: idx_of.get(e.j)!,
      ref: e.ref,
    }))
    const valence_lists = symbols.map((s) => ATOMIC_VALENCE[s])

    let solved: Map<number, number> | null = null
    for (const target of valence_combinations(valence_lists)) {
      solved = assign_bond_orders(frag.length, local_edges, target)
      if (solved) break
    }
    if (!solved) continue // valence not closeable → T2

    local_edges.forEach((e, ei) => {
      const ord = order_to_bond_order(solved!.get(ei)!)
      result.set(e.ref, { ...e.ref, bond_order: ord, perceived: true })
    })
  }
  return bonds.map((b) => result.get(b)!)
}
```

Remove the now-unused `void el_by_symbol` / `void primary_element` lines from Task 1 (they are used now).

- [ ] **Step 4: Run to verify pass**

Run: `cd ~/project/matterviz && pnpm exec vp test --run tests/vitest/structure/bond-order-perception.test.ts`
Expected: PASS — CO2 → [2,2], HCN → 1 + 3, methane → all 1, H2 → 1.

- [ ] **Step 5: Type check + commit**

Run: `cd ~/project/matterviz && pnpm exec svelte-check-rs --workspace . --threshold error`
Expected: `found 0 errors`.

```bash
cd ~/project/matterviz
git add src/lib/structure/bond-order-perception.ts tests/vitest/structure/bond-order-perception.test.ts
git commit -m "feat: xyz2mol valence-maximization core (neutral, main-group)"
```

---

### Task 4: Total-charge support + formal charge metadata

**Files:**
- Modify: `src/lib/structure/bond-order-perception.ts`
- Test: `tests/vitest/structure/bond-order-perception.test.ts`

xyz2mol formal charge: `fc = valence_electrons − 8 + bond_valence` (special-cased H/P/S). Allow the fragment to satisfy `sum(formal_charge) == opts.total_charge`.

- [ ] **Step 1: Write the failing test**

```typescript
describe(`charge support`, () => {
  test(`carbonate CO3^2-: C has 3 bonds, one C=O double, fc sum = -2`, () => {
    const { sites, bonds } = make_input(
      [`C`, `O`, `O`, `O`],
      [[0, 0, 0], [1.28, 0, 0], [-0.64, 1.11, 0], [-0.64, -1.11, 0]],
      [[0, 1], [0, 2], [0, 3]],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: -2 })
    const orders = r.map((b) => b.bond_order).sort()
    expect(orders).toEqual([1, 1, 2]) // one C=O, two C-O(-)
    expect(r.every((b) => b.perceived)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ~/project/matterviz && pnpm exec vp test --run tests/vitest/structure/bond-order-perception.test.ts`
Expected: FAIL — neutral-only solver cannot close carbonate valence.

- [ ] **Step 3: Implement charge-aware acceptance**

Add formal-charge helper and modify the per-fragment loop to accept a solution only when total formal charge matches `opts.total_charge`:

```typescript
const VALENCE_ELECTRONS: Record<string, number> = {
  H: 1, B: 3, C: 4, N: 5, O: 6, F: 7, Si: 4, P: 5, S: 6,
  Cl: 7, Se: 6, Br: 7, Te: 6, I: 7,
}

function formal_charge(symbol: string, bond_valence: number): number {
  if (symbol === `H`) return 1 - bond_valence
  if (symbol === `P` && bond_valence === 5) return 0
  if (symbol === `S` && (bond_valence === 4 || bond_valence === 6)) return 0
  return VALENCE_ELECTRONS[symbol] - 8 + bond_valence
}
```

In the fragment loop, replace `if (!solved) continue` selection with: iterate ALL valence combinations, and for each `solved`, compute `sum_fc = Σ formal_charge(symbol_a, used_valence_a)`; accept the first solution where `sum_fc === (opts.total_charge ?? 0)`. Concretely, replace the solving block:

```typescript
    let solved: Map<number, number> | null = null
    const want_charge = opts.total_charge ?? 0
    for (const target of valence_combinations(valence_lists)) {
      const candidate = assign_bond_orders(frag.length, local_edges, target)
      if (!candidate) continue
      let sum_fc = 0
      for (let k = 0; k < frag.length; k++) {
        const bv = local_edges.reduce(
          (s, e, ei) =>
            s + (e.i === k || e.j === k ? candidate.get(ei)! : 0),
          0,
        )
        sum_fc += formal_charge(symbols[k], bv)
      }
      if (sum_fc === want_charge) {
        solved = candidate
        break
      }
    }
    if (!solved) continue
```

- [ ] **Step 4: Run to verify pass**

Run: `cd ~/project/matterviz && pnpm exec vp test --run tests/vitest/structure/bond-order-perception.test.ts`
Expected: PASS — carbonate → [1,1,2], all prior tests still green (neutral cases keep `total_charge` 0).

- [ ] **Step 5: Commit**

```bash
cd ~/project/matterviz
git add src/lib/structure/bond-order-perception.ts tests/vitest/structure/bond-order-perception.test.ts
git commit -m "feat: total-charge-aware valence acceptance + formal charge"
```

---

### Task 5: SSSR ring perception

**Files:**
- Modify: `src/lib/structure/bond-order-perception.ts`
- Test: `tests/vitest/structure/bond-order-perception.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { find_rings } from '$lib/structure/bond-order-perception'

describe(`ring perception`, () => {
  test(`benzene ring → one 6-membered ring`, () => {
    const edges: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0],
    ]
    const rings = find_rings(6, edges)
    expect(rings).toHaveLength(1)
    expect(rings[0]).toHaveLength(6)
  })

  test(`acyclic chain → no rings`, () => {
    expect(find_rings(3, [[0, 1], [1, 2]])).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ~/project/matterviz && pnpm exec vp test --run tests/vitest/structure/bond-order-perception.test.ts`
Expected: FAIL — `find_rings` not exported.

- [ ] **Step 3: Implement SSSR via spanning-tree cycle basis**

```typescript
export function find_rings(
  n: number,
  edges: [number, number][],
): number[][] {
  const adj = new Map<number, Set<number>>()
  for (let i = 0; i < n; i++) adj.set(i, new Set())
  for (const [a, b] of edges) {
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
  }
  const parent = new Map<number, number>()
  const seen = new Set<number>()
  const rings: number[][] = []
  for (let s = 0; s < n; s++) {
    if (seen.has(s)) continue
    const queue = [s]
    seen.add(s)
    parent.set(s, -1)
    while (queue.length) {
      const u = queue.shift()!
      for (const v of adj.get(u)!) {
        if (!seen.has(v)) {
          seen.add(v)
          parent.set(v, u)
          queue.push(v)
        } else if (parent.get(u) !== v) {
          // Back edge u-v closes a cycle: walk both to common ancestor.
          const path_u: number[] = []
          const path_v: number[] = []
          let a = u
          let b = v
          const anc_u = new Map<number, number>()
          let d = 0
          for (let x = u; x !== -1; x = parent.get(x)!) anc_u.set(x, d++)
          for (let x = v; x !== -1; x = parent.get(x)!) {
            if (anc_u.has(x)) {
              for (let y = u; y !== x; y = parent.get(y)!) path_u.push(y)
              for (let y = v; y !== x; y = parent.get(y)!) path_v.push(y)
              const ring = [x, ...path_u, ...path_v.reverse()]
              if (ring.length >= 3) rings.push(ring)
              break
            }
          }
          void a
          void b
        }
      }
    }
  }
  // Deduplicate rings by sorted vertex set.
  const uniq = new Map<string, number[]>()
  for (const r of rings) {
    const key = [...r].sort((x, y) => x - y).join(`,`)
    if (!uniq.has(key)) uniq.set(key, r)
  }
  return [...uniq.values()]
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd ~/project/matterviz && pnpm exec vp test --run tests/vitest/structure/bond-order-perception.test.ts`
Expected: PASS — benzene → one 6-ring, chain → none.

- [ ] **Step 5: Commit**

```bash
cd ~/project/matterviz
git add src/lib/structure/bond-order-perception.ts tests/vitest/structure/bond-order-perception.test.ts
git commit -m "feat: SSSR ring perception via cycle basis"
```

---

### Task 6: Hückel aromaticity flag

**Files:**
- Modify: `src/lib/structure/bond-order-perception.ts`
- Test: `tests/vitest/structure/bond-order-perception.test.ts`

A ring is aromatic if it is near-planar, all members are sp²-capable (C/N/O/S), and π-electron count satisfies Hückel 4n+2 (benzene: 6 π e⁻ from 3 ring double bonds).

- [ ] **Step 1: Write the failing test**

```typescript
describe(`aromaticity`, () => {
  test(`benzene: all 6 ring bonds flagged aromatic`, () => {
    const a = (k: number): [number, number, number] => [
      Math.cos((k * Math.PI) / 3) * 1.39,
      Math.sin((k * Math.PI) / 3) * 1.39,
      0,
    ]
    const coords = [a(0), a(1), a(2), a(3), a(4), a(5)]
    const { sites, bonds } = make_input(
      [`C`, `C`, `C`, `C`, `C`, `C`],
      coords,
      [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(r.every((b) => b.aromatic_ring !== undefined)).toBe(true)
    expect(r.every((b) => b.bond_order === `aromatic`)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd ~/project/matterviz && pnpm exec vp test --run tests/vitest/structure/bond-order-perception.test.ts`
Expected: FAIL — `aromatic_ring` undefined; benzene currently solved as Kekulé 1/2 alternation.

- [ ] **Step 3: Implement aromatic detection + flagging**

Add helpers and a post-pass after the per-fragment solve. Aromaticity uses the solved Kekulé orders (count ring double bonds → π electrons):

```typescript
function ring_is_planar(ring: number[], sites: Site[]): boolean {
  if (ring.length < 3) return false
  const p = ring.map((a) => sites[a].xyz)
  // Normal from first 3 atoms; check max out-of-plane deviation < 0.3 Å.
  const v1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]]
  const v2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]]
  const nx = v1[1] * v2[2] - v1[2] * v2[1]
  const ny = v1[2] * v2[0] - v1[0] * v2[2]
  const nz = v1[0] * v2[1] - v1[1] * v2[0]
  const len = Math.hypot(nx, ny, nz) || 1
  return p.every((q) => {
    const dev =
      Math.abs(
        (q[0] - p[0][0]) * nx +
          (q[1] - p[0][1]) * ny +
          (q[2] - p[0][2]) * nz,
      ) / len
    return dev < 0.3
  })
}

const SP2_OK = new Set([`C`, `N`, `O`, `S`])
```

After the `local_edges.forEach(... perceived: true ...)` assignment inside the fragment loop, add aromatic post-processing:

```typescript
    const local_edge_pairs: [number, number][] = local_edges.map(
      (e) => [e.i, e.j],
    )
    const rings = find_rings(frag.length, local_edge_pairs)
    let ring_id = 0
    for (const ring of rings) {
      const global_ring = ring.map((k) => frag[k])
      if (!global_ring.every((g) => SP2_OK.has(primary_element(sites[g]))))
        continue
      if (!ring_is_planar(global_ring, sites)) continue
      const ring_set = new Set(ring)
      // π electrons: 2 per ring double bond (Kekulé) → benzene = 6.
      let double_in_ring = 0
      local_edges.forEach((e, ei) => {
        if (ring_set.has(e.i) && ring_set.has(e.j) && solved!.get(ei) === 2) {
          double_in_ring++
        }
      })
      const pi = double_in_ring * 2
      if (pi >= 2 && (pi - 2) % 4 === 0) {
        const this_ring = ring_id++
        local_edges.forEach((e) => {
          if (ring_set.has(e.i) && ring_set.has(e.j)) {
            const prev = result.get(e.ref)!
            result.set(e.ref, {
              ...prev,
              bond_order: `aromatic`,
              aromatic_ring: this_ring,
              kekule_order: prev.bond_order === 1 ? 1 : 2,
              perceived: true,
            })
          }
        })
      }
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd ~/project/matterviz && pnpm exec vp test --run tests/vitest/structure/bond-order-perception.test.ts`
Expected: PASS — benzene ring bonds all `aromatic` with `aromatic_ring` set; CO2/HCN/methane/carbonate unchanged.

- [ ] **Step 5: Commit**

```bash
cd ~/project/matterviz
git add src/lib/structure/bond-order-perception.ts tests/vitest/structure/bond-order-perception.test.ts
git commit -m "feat: Hückel 4n+2 aromaticity flagging + Kekulé retained in metadata"
```

---

### Task 7: T2 fallback assertions (metals / unsatisfiable)

**Files:**
- Test: `tests/vitest/structure/bond-order-perception.test.ts`

T2 behavior already falls out of Task 3 (`continue` leaves the fragment as `single`/`perceived:false`). This task locks it with explicit tests — no implementation change expected; if a test fails, fix the gating.

- [ ] **Step 1: Write the failing/locking tests**

```typescript
describe(`T2 graceful fallback`, () => {
  test(`ferrocene-ish (contains Fe): all single, perceived false`, () => {
    const { sites, bonds } = make_input(
      [`Fe`, `C`, `C`, `C`, `C`, `C`],
      [[0, 0, 0], [1, 0, 1], [0.3, 0.95, 1], [-0.8, 0.6, 1],
       [-0.8, -0.6, 1], [0.3, -0.95, 1]],
      [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5],
       [1, 2], [2, 3], [3, 4], [4, 5], [5, 1]],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(r.every((b) => b.bond_order === 1)).toBe(true)
    expect(r.every((b) => b.perceived === false)).toBe(true)
  })

  test(`NaCl pair (no bonds list) → empty result`, () => {
    const { sites, bonds } = make_input([`Na`, `Cl`], [[0, 0, 0], [2.8, 0, 0]], [])
    expect(perceive_bond_orders(sites, bonds, {})).toHaveLength(0)
  })

  test(`water: all single`, () => {
    const { sites, bonds } = make_input(
      [`O`, `H`, `H`],
      [[0, 0, 0], [0.96, 0, 0], [-0.24, 0.93, 0]],
      [[0, 1], [0, 2]],
    )
    const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
    expect(r.every((b) => b.bond_order === 1 && b.perceived)).toBe(true)
  })
})
```

- [ ] **Step 2: Run**

Run: `cd ~/project/matterviz && pnpm exec vp test --run tests/vitest/structure/bond-order-perception.test.ts`
Expected: PASS. If ferrocene test fails (Fe not gated out), confirm `is_main_group('Fe') === false` and that the whole fragment hits `continue`.

- [ ] **Step 3: Commit**

```bash
cd ~/project/matterviz
git add tests/vitest/structure/bond-order-perception.test.ts
git commit -m "test: lock T2 single-bond fallback for metals/ionic"
```

---

### Task 8: Wire perception into StructureScene + settings + controls

**Files:**
- Modify: `src/lib/structure/index.ts` (re-export perception types)
- Modify: `src/lib/structure/StructureScene.svelte` (inject `perceived_bond_pairs`; aromatic display)
- Modify: `src/lib/structure/StructureControls.svelte` (toggle + aromatic display select)
- Test: `tests/vitest/structure/bonding.test.ts` (integration unit)

- [ ] **Step 1: Re-export types**

In `src/lib/structure/index.ts`, after the `BondPair` type block, add:

```typescript
export type {
  PerceivedBond,
  PerceptionOptions,
} from '$lib/structure/bond-order-perception'
export { perceive_bond_orders } from '$lib/structure/bond-order-perception'
```

- [ ] **Step 2: Write the failing integration test**

Append to `tests/vitest/structure/bonding.test.ts`:

```typescript
import { perceive_bond_orders } from '$lib/structure/bond-order-perception'

test(`perceive_bond_orders integrates with BondPair shape`, () => {
  const sites = [
    { species: [{ element: `C`, occu: 1 }], xyz: [0, 0, 0], abc: [0, 0, 0], label: `C0` },
    { species: [{ element: `O`, occu: 1 }], xyz: [1.16, 0, 0], abc: [0, 0, 0], label: `O1` },
    { species: [{ element: `O`, occu: 1 }], xyz: [-1.16, 0, 0], abc: [0, 0, 0], label: `O2` },
  ] as unknown as Parameters<typeof perceive_bond_orders>[0]
  const bonds = [
    { pos_1: [0, 0, 0], pos_2: [1.16, 0, 0], site_idx_1: 0, site_idx_2: 1, bond_length: 1.16, strength: 1, transform_matrix: new Float32Array(16) },
    { pos_1: [0, 0, 0], pos_2: [-1.16, 0, 0], site_idx_1: 0, site_idx_2: 2, bond_length: 1.16, strength: 1, transform_matrix: new Float32Array(16) },
  ] as unknown as Parameters<typeof perceive_bond_orders>[1]
  const r = perceive_bond_orders(sites, bonds, { total_charge: 0 })
  expect(r.map((b) => b.bond_order)).toEqual([2, 2])
})
```

- [ ] **Step 3: Run to verify it passes (already-built algorithm)**

Run: `cd ~/project/matterviz && pnpm exec vp test --run tests/vitest/structure/bonding.test.ts`
Expected: PASS.

- [ ] **Step 4: Inject perception into StructureScene**

In `src/lib/structure/StructureScene.svelte`:

a) Add to the imports from `$lib/structure` (near line 59 where `BONDING_STRATEGIES` is imported) — add `perceive_bond_orders`.

b) Read the new settings. Find where other `structure` settings/props are destructured (near `bonding_strategy = DEFAULTS.structure.bonding_strategy,` at line 145) and add props:

```svelte
    auto_bond_order = DEFAULTS.structure.auto_bond_order,
    aromatic_display = DEFAULTS.structure.aromatic_display,
```

and in the `Props` type (near line 233/255 where `bond_order_overrides?: StructureBond[]` is declared) add:

```typescript
    auto_bond_order?: boolean
    aromatic_display?: `aromatic` | `kekule`
```

c) Insert a `$derived` immediately AFTER the `$effect` that assigns `bond_pairs` (after line 678, the `})` closing that effect) and BEFORE `filtered_bond_pairs`:

```svelte
  let perceived_bond_pairs = $derived.by(() => {
    if (!auto_bond_order || !structure?.sites || bond_pairs.length === 0) {
      return bond_pairs
    }
    const total_charge =
      (`charge` in structure ? structure.charge : 0) ?? 0
    const perceived = perceive_bond_orders(
      structure.sites,
      bond_pairs,
      { total_charge },
    )
    if (aromatic_display === `kekule`) {
      return perceived.map((b) =>
        b.bond_order === `aromatic` && b.kekule_order !== undefined
          ? { ...b, bond_order: b.kekule_order }
          : b
      )
    }
    return perceived
  })
```

d) In `filtered_bond_pairs` (`$derived.by` near line 761), change the first line that reads `bond_pairs` to consume the perceived list. Replace:

```svelte
    if (!structure?.sites) return bond_pairs
```
with:
```svelte
    if (!structure?.sites) return perceived_bond_pairs
```
and replace the later `const calculated = bond_pairs` line with:
```svelte
    const calculated = perceived_bond_pairs
```

(Manual `bond_order_overrides` are applied just below in the existing `.map()` — they now correctly override perceived orders, satisfying T3 precedence.)

- [ ] **Step 5: Add UI controls**

In `src/lib/structure/StructureControls.svelte`, locate the bonding controls section (search for `bonding_strategy` / `show_bonds`). Add, adjacent to the bonding-strategy control, bound to the same settings mechanism the file already uses for `bond_thickness`/`bonding_strategy`:

```svelte
    <label>
      <input type="checkbox" bind:checked={auto_bond_order} />
      Auto bond order (perceive double/triple/aromatic)
    </label>
    {#if auto_bond_order}
      <label>
        Aromatic display
        <select bind:value={aromatic_display}>
          <option value="aromatic">Aromatic (1.5)</option>
          <option value="kekule">Kekulé (alternating)</option>
        </select>
      </label>
    {/if}
```

Add `auto_bond_order` and `aromatic_display` to this component's `$bindable` props mirroring how `bonding_strategy` is declared/forwarded in the same file (follow the existing pattern exactly — do not invent a new state mechanism).

- [ ] **Step 6: Type check + full unit suite**

Run:
```bash
cd ~/project/matterviz && pnpm exec svelte-check-rs --workspace . --threshold error && pnpm exec vp test --run tests/vitest/structure/bonding.test.ts tests/vitest/structure/bond-order-perception.test.ts tests/vitest/structure/supercell.test.ts tests/vitest/structure/pbc.test.ts tests/vitest/structure/edit-atoms.test.ts tests/vitest/structure/label-placement.test.ts
```
Expected: `found 0 errors`; all suites pass.

- [ ] **Step 7: Commit**

```bash
cd ~/project/matterviz
git add src/lib/structure/index.ts src/lib/structure/StructureScene.svelte src/lib/structure/StructureControls.svelte tests/vitest/structure/bonding.test.ts
git commit -m "feat: wire bond-order perception into scene + settings + controls"
```

---

### Task 9: Playwright coverage + full validation gate

**Files:**
- Modify: `tests/playwright/structure/bonds.test.ts`

- [ ] **Step 1: Add Playwright tests**

Append three tests to `tests/playwright/structure/bonds.test.ts` following the existing patterns in that file (reuse its existing helpers/fixtures for mounting a structure and locating the bonds canvas/instances). Each test:

1. `auto bond order toggle changes rendering` — load a CO₂/benzene demo structure, assert single bonds initially, enable the `auto_bond_order` control, assert multi-bond instance count increases.
2. `aromatic display toggle switches benzene representation` — with perception on and a benzene structure, switch `aromatic_display` from `aromatic` to `kekule`, assert the rendered instance pattern changes.
3. `manual override wins over perception` — with perception on, right-click a perceived double bond, set it to Triple via the existing context menu, assert it renders as triple (override precedence).

Use the exact selectors/fixtures already used by the 4 existing tests in this file (e.g. the structure mount helper and the bonds locator) — do not introduce new test infrastructure.

- [ ] **Step 2: Run Playwright bonds suite**

Run: `cd ~/project/matterviz && pnpm exec playwright test tests/playwright/structure/bonds.test.ts`
Expected: all tests pass (4 existing + 3 new).

- [ ] **Step 3: Full validation gate (spec §8)**

Run:
```bash
cd ~/project/matterviz
pnpm exec svelte-check-rs --workspace . --threshold error
pnpm exec vp test --run tests/vitest/structure/bonding.test.ts tests/vitest/structure/bond-order-perception.test.ts tests/vitest/structure/supercell.test.ts tests/vitest/structure/pbc.test.ts tests/vitest/structure/edit-atoms.test.ts tests/vitest/structure/label-placement.test.ts
pnpm exec playwright test tests/playwright/structure/bonds.test.ts
pnpm exec vp build
```
Expected: 0 type errors; all vitest suites pass; all Playwright bonds tests pass; build succeeds.

- [ ] **Step 4: Commit**

```bash
cd ~/project/matterviz
git add tests/playwright/structure/bonds.test.ts
git commit -m "test: playwright coverage for perception toggle, aromatic display, override precedence"
```

---

## Self-Review

**Spec coverage:**
- §3 architecture / opt-in flag → Task 1, Task 8
- §4 T1 xyz2mol core (gating, valence-max, charge, formal charge) → Tasks 2, 3, 4
- §4 ring + Hückel + Kekulé dual output → Tasks 5, 6
- §5 T2 fallback → Task 3 (`continue`), locked in Task 7
- §6 T3 manual override precedence → Task 8 step 4d (overrides applied after perceived list)
- §7 charge / radicals / perf cap / determinism → Task 3 (`max_atoms`), Task 4 (charge), valence-combo lowest-sum-first ordering = deterministic
- §8 testing → Tasks 3–7 (vitest), Task 9 (playwright + full gate)
- §9 licensing → header comment in Task 1 step 3 ("adapted from jensengroup/xyz2mol, MIT"); OpenBabel not read
- §10 data flow → Task 8 wiring matches the diagram

No spec requirement left without a task.

**Placeholder scan:** No TBD/TODO; every code step has concrete code; Playwright tests (Task 9) intentionally describe assertions against the file's existing fixtures rather than inventing selectors — this is correct because the fixture API is established in that file and must be followed, not redefined.

**Type consistency:** `perceive_bond_orders(sites, bonds, opts)` signature, `PerceivedBond` (extends `BondPair`, adds `bond_order`/`perceived`/`aromatic_ring`/`kekule_order`), `PerceptionOptions` (`total_charge`/`max_atoms`), `is_main_group`, `split_fragments`, `find_rings`, `ATOMIC_VALENCE`, `VALENCE_ELECTRONS`, `formal_charge` — names used consistently across Tasks 1–9. `BondOrder` reuses the existing `1|1.5|2|3|'aromatic'` union. Settings keys `auto_bond_order`/`aromatic_display` consistent between settings.ts (Task 1) and scene/controls (Task 8).
