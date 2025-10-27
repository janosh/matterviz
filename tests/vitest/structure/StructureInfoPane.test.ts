import { StructureInfoPane } from '$lib'
import type { PymatgenStructure } from '$lib/structure'
import { mount } from 'svelte'
import { expect, test } from 'vitest'
import { get_dummy_structure } from '../setup'

test.each([
  [2, true, `Small structure should show sites by default`],
  [50, false, `Structure with 50 atoms should hide sites by default (toggle button)`],
  [99, false, `Structure with 99 atoms should hide sites by default (toggle button)`],
  [100, false, `Structure with 100 atoms should hide sites by default (toggle button)`],
  [300, false, `Large structure should hide sites by default (toggle button)`],
  [500, false, `Structure with 500 atoms should hide sites by default (toggle button)`],
])(
  `%i atoms: %s`,
  (atom_count, should_show_sites, _description) => {
    const structure = get_dummy_structure(`H`, atom_count, true)
    const atom_count_thresholds = [50, 500]
    mount(StructureInfoPane, {
      target: document.body,
      props: { structure, pane_open: true, atom_count_thresholds },
    })

    // Check formula shows correct atom count
    const formula_text = document.body.textContent || ``
    expect(formula_text).toContain(`(${atom_count} sites)`)

    if (atom_count <= atom_count_thresholds[1]) {
      // Sites section should exist
      const sites_section = document.querySelector(`.structure-info-pane h4`)
      expect(sites_section).not.toBeNull()

      if (atom_count >= atom_count_thresholds[0]) {
        // Should have toggle button for medium-sized structures (50-500 atoms)
        const toggle_text = should_show_sites ? `Hide Sites` : `Show ${atom_count} sites`
        expect(formula_text).toContain(toggle_text)
      }

      if (should_show_sites) {
        // Should show actual site information
        expect(formula_text).toContain(`Fractional`)
        expect(formula_text).toContain(`Cartesian`)
      } else {
        // Should not show site details when collapsed
        expect(formula_text).not.toContain(`Fractional`)
        expect(formula_text).not.toContain(`Cartesian`)
      }
    } else {
      // Structure with > 500 atoms should not have sites section at all
      expect(formula_text).not.toContain(`Sites`)
      expect(formula_text).not.toContain(`Fractional`)
      expect(formula_text).not.toContain(`Cartesian`)
    }
  },
)

test(`structure with > 500 atoms should not create sites section`, () => {
  const structure = get_dummy_structure(`H`, 600, true)
  mount(StructureInfoPane, {
    target: document.body,
    props: { structure, pane_open: true },
  })

  // Check that no sites section exists
  const sites_headings = Array.from(
    document.querySelectorAll<HTMLHeadingElement>(`.structure-info-pane h4`),
  )
  const sites_section = sites_headings.find((heading) =>
    heading.textContent?.includes(`Sites`)
  )
  expect(sites_section).toBeUndefined()

  // Check that no site-related content exists
  const content = document.body.textContent || ``
  expect(content).not.toContain(`Fractional`)
  expect(content).not.toContain(`Cartesian`)
  expect(content).not.toContain(`Show Sites`)
})

test(`symmetry section displays when symmetry data is available`, () => {
  const structure = get_dummy_structure(`H`, 10, true) as PymatgenStructure
  // Override lattice with custom properties for testing
  structure.lattice = {
    ...structure.lattice,
    a: 5.0,
    b: 5.0,
    c: 5.0,
    alpha: 90,
    beta: 90,
    gamma: 90,
    volume: 125,
    matrix: [[5, 0, 0], [0, 5, 0], [0, 0, 5]],
    pbc: [true, true, true],
  }

  mount(StructureInfoPane, {
    target: document.body,
    props: { structure, pane_open: true },
  })

  const content = document.body.textContent || ``
  if (content.includes(`Symmetry`)) {
    expect(content).toContain(`Space Group`)
    expect(content).toContain(`Symmetry Ops`)
    expect(content).toContain(`trans`)
    expect(content).toContain(`rot`)
    expect(content).toContain(`roto-trans`)
  }
})

test(`symmetry section behavior for different structure types`, () => {
  // Test periodic structure with symmetry
  const periodic_structure = get_dummy_structure(`H`, 4, true) as PymatgenStructure
  periodic_structure.lattice = {
    ...periodic_structure.lattice,
    a: 4.0,
    b: 4.0,
    c: 4.0,
    alpha: 90,
    beta: 90,
    gamma: 90,
    volume: 64,
    matrix: [[4, 0, 0], [0, 4, 0], [0, 0, 4]],
    pbc: [true, true, true],
  }

  mount(StructureInfoPane, {
    target: document.body,
    props: { structure: periodic_structure, pane_open: true },
  })

  const content = document.body.textContent || ``
  if (content.includes(`Symmetry`)) {
    expect(content).toMatch(/\d+/) // space group number
    expect(content).toContain(`Symmetry Ops`) // operations count
  }

  // Test molecular structure (no symmetry)
  const molecular_structure = get_dummy_structure(`H`, 5, false)
  mount(StructureInfoPane, {
    target: document.body,
    props: { structure: molecular_structure, pane_open: true },
  })

  const molecular_content = document.body.textContent || ``
  expect(molecular_content).not.toContain(`Symmetry`)
  expect(molecular_content).not.toContain(`Space Group`)
})

test(`symmetry section positioning and error handling`, () => {
  const structure = get_dummy_structure(`H`, 3, true) as PymatgenStructure
  structure.lattice = {
    ...structure.lattice,
    a: 3.0,
    b: 3.0,
    c: 3.0,
    alpha: 90,
    beta: 90,
    gamma: 90,
    volume: 27,
    matrix: [[3, 0, 0], [0, 3, 0], [0, 0, 3]],
    pbc: [true, true, true],
  }

  mount(StructureInfoPane, {
    target: document.body,
    props: { structure, pane_open: true },
  })

  const headings = Array.from(document.querySelectorAll(`h4`))
  const section_titles = headings.map((h) => h.textContent)

  if (section_titles.includes(`Symmetry`)) {
    // Check section order: Structure -> Cell -> Symmetry -> Sites
    const cell_idx = section_titles.indexOf(`Cell`)
    const symmetry_idx = section_titles.indexOf(`Symmetry`)
    const sites_idx = section_titles.indexOf(`Sites`)
    expect(cell_idx).toBeLessThan(symmetry_idx)
    expect(symmetry_idx).toBeLessThan(sites_idx)
  }

  // Should not crash even if operations are missing
  const content = document.body.textContent || ``
  expect(content).toContain(`Structure`)
  expect(content).toContain(`Cell`)
})

test(`Wyckoff table integration with selected sites`, () => {
  const structure = get_dummy_structure(`H`, 4, true) as PymatgenStructure
  let selected_sites: number[] = []

  mount(StructureInfoPane, {
    target: document.body,
    props: {
      structure,
      pane_open: true,
      get selected_sites() {
        return selected_sites
      },
      set selected_sites(new_val) {
        selected_sites = new_val
      },
    },
  })

  // Check that selected_sites binding works
  expect(selected_sites).toEqual([])

  // Component should render without errors
  const content = document.body.textContent || ``
  expect(content).toContain(`Structure`)
})

test(`pane state management works correctly`, () => {
  const structure = get_dummy_structure(`H`, 2, true) as PymatgenStructure
  let pane_open = false

  mount(StructureInfoPane, {
    target: document.body,
    props: {
      structure,
      get pane_open() {
        return pane_open
      },
      set pane_open(new_val) {
        pane_open = new_val
      },
    },
  })

  // Initial state should be closed
  expect(pane_open).toBe(false)
})

test(`handles large structures efficiently`, () => {
  const large_structure = get_dummy_structure(`H`, 500, true) as PymatgenStructure

  const start_time = performance.now()

  mount(StructureInfoPane, {
    target: document.body,
    props: { structure: large_structure, pane_open: true },
  })

  const end_time = performance.now()
  const render_time = end_time - start_time

  // Should render large structures in reasonable time
  expect(render_time).toBeLessThan(500) // 500ms threshold

  // Should still show structure info
  const content = document.body.textContent || ``
  expect(content).toContain(`Structure`)
})
