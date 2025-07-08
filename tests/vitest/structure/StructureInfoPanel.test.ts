import StructureInfoPanel from '$lib/structure/StructureInfoPanel.svelte'
import { mount } from 'svelte'
import { expect, test } from 'vitest'

// Mock structure with different atom counts
const create_test_structure = (atom_count: number) => ({
  charge: 0,
  lattice: {
    a: 5.0,
    b: 5.0,
    c: 5.0,
    alpha: 90.0,
    beta: 90.0,
    gamma: 90.0,
    volume: 125.0,
    matrix: [
      [5.0, 0.0, 0.0],
      [0.0, 5.0, 0.0],
      [0.0, 0.0, 5.0],
    ],
    pbc: [true, true, true],
  },
  sites: Array.from({ length: atom_count }, (_) => ({
    species: [{ element: `H`, occu: 1 }],
    abc: [0.0, 0.0, 0.0],
    xyz: [0.0, 0.0, 0.0],
    label: `H`,
    properties: {},
  })),
})

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
    const structure = create_test_structure(atom_count)
    const atom_count_thresholds = [50, 500]
    mount(StructureInfoPanel, {
      target: document.body,
      props: { structure, info_open: true, show_info: true, atom_count_thresholds },
    })

    // Check formula shows correct atom count
    const formula_text = document.body.textContent || ``
    expect(formula_text).toContain(`(${atom_count} atoms)`)

    if (atom_count <= atom_count_thresholds[1]) {
      // Sites section should exist
      const sites_section = document.querySelector(`h4.section-heading`)
      expect(sites_section).not.toBeNull()

      if (atom_count >= atom_count_thresholds[0]) {
        // Should have toggle button for medium-sized structures (50-500 atoms)
        const toggle_text = should_show_sites
          ? `Hide Sites`
          : `Sites (${atom_count} atoms)`
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

    // Clean up
    document.body.innerHTML = ``
  },
)

test(`structure with > 500 atoms should not create sites section`, () => {
  const structure = create_test_structure(600)
  mount(StructureInfoPanel, {
    target: document.body,
    props: {
      structure,
      info_open: true,
      show_info: true,
    },
  })

  // Check that no sites section exists
  const sites_headings = Array.from(document.querySelectorAll(`h4.section-heading`))
  const sites_section = sites_headings.find((h) =>
    (h as HTMLElement).textContent?.includes(`Sites`)
  )
  expect(sites_section).toBeUndefined()

  // Check that no site-related content exists
  const content = document.body.textContent || ``
  expect(content).not.toContain(`Fractional`)
  expect(content).not.toContain(`Cartesian`)
  expect(content).not.toContain(`Show Sites`)

  // Clean up
  document.body.innerHTML = ``
})
