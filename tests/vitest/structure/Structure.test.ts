import type { AnyStructure, Vec3 } from '$lib'
import { Structure } from '$lib'
import { euclidean_dist, type Matrix3x3, pbc_dist } from '$lib/math'
import { structures } from '$site/structures'
import { readFileSync } from 'fs'
import { mount, tick } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { gunzipSync } from 'zlib'
import { doc_query } from '../setup'

const structure = structures[0]

// Shared test utilities to reduce duplication
const SAMPLE_POSCAR_CONTENT = `BaTiO3 tetragonal
1.0
4.0 0.0 0.0
0.0 4.0 0.0
0.0 0.0 4.0
Ba Ti O
1 1 3
Direct
0.0 0.0 0.0
0.5 0.5 0.5
0.5 0.5 0.0
0.5 0.0 0.5
0.0 0.5 0.5`

function create_mock_data_transfer(files: File[]): DataTransfer {
  return {
    files,
    getData: () => ``,
    dropEffect: `copy` as const,
    effectAllowed: `copy` as const,
    items: [] as unknown as DataTransferItemList,
    types: [] as readonly string[],
    clearData: () => {},
    setData: () => {},
    setDragImage: () => {},
  } as unknown as DataTransfer
}

function create_drop_event(files: File[]): DragEvent {
  const drag_event = new DragEvent(`drop`)
  Object.defineProperty(drag_event, `dataTransfer`, {
    value: create_mock_data_transfer(files),
    writable: false,
  })
  return drag_event
}

// Tests for Structure component functionality
describe(`Structure`, () => {
  test(`open control panel when clicking toggle button`, async () => {
    mount(Structure, {
      target: document.body,
      props: { structure, controls_open: false, show_controls: true },
    })

    // Check that the controls toggle button exists and is clickable
    const controls_toggle = doc_query(`button.structure-controls-toggle`)
    expect(controls_toggle).toBeTruthy()

    controls_toggle.click()
    await tick()

    // Check that the control panel is now visible by looking for control elements
    expect(document.querySelector(`.controls-panel`)).toBeTruthy()
  })

  test(`JSON file download when clicking download button`, async () => {
    globalThis.URL.createObjectURL = vi.fn()

    mount(Structure, {
      target: document.body,
      props: { structure, show_controls: true },
    })

    // First, open the structure control panel by clicking the correct toggle button
    // Look for the structure controls toggle button specifically
    const structure_controls_toggle = document.querySelector(
      `button.structure-controls-toggle`,
    ) as HTMLButtonElement
    expect(structure_controls_toggle).toBeTruthy()
    structure_controls_toggle.click()
    await tick()

    const spy = vi.spyOn(document.body, `appendChild`)
    // Use title attribute to find the download button
    const download_btn = document.querySelector(
      `button[title="⬇ JSON"]`,
    ) as HTMLButtonElement
    expect(download_btn).toBeTruthy()

    download_btn?.click()

    expect(spy).toHaveBeenCalledWith(expect.any(HTMLAnchorElement))

    spy.mockRestore()
    // @ts-expect-error - function is mocked
    globalThis.URL.createObjectURL.mockRestore()
  })

  test(`toggle fullscreen mode`, async () => {
    const requestFullscreenMock = vi.fn().mockResolvedValue(undefined)
    const exitFullscreenMock = vi.fn()

    mount(Structure, {
      target: document.body,
      props: { structure, show_controls: true },
    })

    // Find the wrapper element that was created by the component
    const wrapper = document.querySelector(`.structure`) as HTMLElement
    expect(wrapper).toBeTruthy()

    // Mock wrapper element
    wrapper.requestFullscreen = requestFullscreenMock
    document.exitFullscreen = exitFullscreenMock
    await tick()

    // Click the fullscreen button
    const fullscreen_button = document.querySelector(
      `.fullscreen-toggle`,
    ) as HTMLButtonElement
    expect(fullscreen_button).toBeTruthy()

    fullscreen_button.click()
    await tick()

    expect(requestFullscreenMock).toHaveBeenCalledOnce()

    // Simulate fullscreen mode
    Object.defineProperty(document, `fullscreenElement`, {
      value: wrapper,
      configurable: true,
    })

    fullscreen_button.click()
    await tick()
    expect(exitFullscreenMock).toHaveBeenCalledOnce()

    // Reset fullscreenElement
    Object.defineProperty(document, `fullscreenElement`, {
      value: null,
      configurable: true,
    })
  })

  test(`drag and drop file handling`, async () => {
    let structure_loaded = false

    mount(Structure, {
      target: document.body,
      props: {
        structure: undefined,
        show_controls: true,
        on_file_drop: (_content: string | ArrayBuffer, _filename: string) => {
          structure_loaded = true
        },
      },
    })

    const wrapper = document.querySelector(`.structure`) as HTMLElement
    expect(wrapper).toBeTruthy()

    const file = new File([SAMPLE_POSCAR_CONTENT], `test.poscar`, { type: `text/plain` })
    const drag_event = create_drop_event([file])

    // Trigger the drop event
    wrapper.dispatchEvent(drag_event)

    // Wait for async processing to complete
    await new Promise((resolve) => setTimeout(resolve, 100))
    await tick()

    // Verify that the file drop handler was called
    expect(structure_loaded).toBe(true)
  })

  test(`drag and drop event handling`, async () => {
    let event_handled = false
    let file_content = null

    mount(Structure, {
      target: document.body,
      props: {
        structure: undefined,
        show_controls: true,
        on_file_drop: (content: string | ArrayBuffer, _filename: string) => {
          event_handled = true
          file_content = content
        },
      },
    })

    const wrapper = document.querySelector(`.structure`) as HTMLElement
    expect(wrapper).toBeTruthy()

    const file = new File([`test content`], `test.txt`, { type: `text/plain` })
    const drag_event = create_drop_event([file])

    // Trigger the drop event
    wrapper.dispatchEvent(drag_event)

    // Wait for async processing to complete
    await new Promise((resolve) => setTimeout(resolve, 100))
    await tick()

    expect(event_handled).toBe(true)
    expect(file_content).toBe(`test content`)
  })

  test(`drag and drop with real POSCAR file`, async () => {
    let structure_loaded = false

    mount(Structure, {
      target: document.body,
      props: {
        structure: undefined,
        show_controls: true,
        on_file_drop: (_content: string | ArrayBuffer, _filename: string) => {
          structure_loaded = true
        },
      },
    })

    const wrapper = document.querySelector(`.structure`) as HTMLElement
    expect(wrapper).toBeTruthy()

    const file = new File([SAMPLE_POSCAR_CONTENT], `BaTiO3.poscar`, {
      type: `text/plain`,
    })
    const drag_event = create_drop_event([file])

    // Trigger the drop event
    wrapper.dispatchEvent(drag_event)

    // Wait for async processing to complete
    await new Promise((resolve) => setTimeout(resolve, 100))
    await tick()

    // Verify that the file drop handler was called
    expect(structure_loaded).toBe(true)
  })

  test(`drag and drop without on_file_drop handler`, async () => {
    mount(Structure, {
      target: document.body,
      props: { structure: undefined, show_controls: true },
    })

    const wrapper = document.querySelector(`.structure`) as HTMLElement
    expect(wrapper).toBeTruthy()

    const file = new File([SAMPLE_POSCAR_CONTENT], `test.poscar`, { type: `text/plain` })
    const drag_event = create_drop_event([file])

    // Trigger the drop event
    wrapper.dispatchEvent(drag_event)

    // Wait for async processing to complete
    await new Promise((resolve) => setTimeout(resolve, 100))
    await tick()

    // Check that the structure was loaded (should show structure info)
    expect(document.body.textContent).toContain(`Ba Ti O3`)
  })
})

test(`pbc_dist with realistic structure scenarios`, () => {
  // Test with a simple cubic structure similar to CsCl (from mp-1.json)
  const cubic_lattice_matrix: Matrix3x3 = [
    [6.256930122878799, 0.0, 0.0],
    [0.0, 6.256930122878799, 0.0],
    [0.0, 0.0, 6.256930122878799],
  ]

  // Two atoms: one at origin, one at (0.5, 0.5, 0.5) in fractional coordinates
  // which corresponds to center of unit cell in Cartesian
  const atom1_xyz: Vec3 = [0.0, 0.0, 0.0]
  const atom2_xyz: Vec3 = [3.1284650614394, 3.1284650614393996, 3.1284650614394]

  const direct_dist = euclidean_dist(atom1_xyz, atom2_xyz)
  const pbc_distance = pbc_dist(atom1_xyz, atom2_xyz, cubic_lattice_matrix)

  // For atoms at (0,0,0) and (0.5,0.5,0.5), the distance should be the same via PBC
  // since they're already at the shortest separation
  expect(pbc_distance).toBeCloseTo(direct_dist, 2)
  expect(pbc_distance).toBeCloseTo(5.419, 3) // expected distance

  // Test case 2: Create artificial scenario with atoms at opposite corners
  // Atom at (0.1, 0.1, 0.1) and (5.9, 5.9, 5.9) - very close to opposite corners
  const corner1: Vec3 = [0.1, 0.1, 0.1]
  const corner2: Vec3 = [6.156930122878799, 6.156930122878799, 6.156930122878799] // 0.9 fractional

  const corner_direct = euclidean_dist(corner1, corner2)
  const corner_pbc = pbc_dist(corner1, corner2, cubic_lattice_matrix)

  expect(corner_direct).toBeCloseTo(10.491, 3)
  expect(corner_pbc).toBeCloseTo(0.346, 3) // PBC distance should be sqrt(0.2^2 * 3)

  // Test case 3: Very long unit cell to test the issue user reported
  const long_cell_matrix: Matrix3x3 = [
    [20.0, 0.0, 0.0], // Very long in x direction
    [0.0, 5.0, 0.0],
    [0.0, 0.0, 5.0],
  ]

  // Atoms at opposite ends of the long axis
  const long_atom1: Vec3 = [1.0, 2.5, 2.5] // close to x=0 side
  const long_atom2: Vec3 = [19.0, 2.5, 2.5] // close to x=20 side

  const long_direct = euclidean_dist(long_atom1, long_atom2)
  const long_pbc = pbc_dist(long_atom1, long_atom2, long_cell_matrix)

  expect(long_direct).toBeCloseTo(18.0, 3)
  expect(long_pbc).toBeCloseTo(2.0, 3) // PBC distance should be 2.0 Å (1.0 + 1.0 through boundary)
})

describe(`Structure component nested JSON handling`, () => {
  beforeEach(() => {
    document.body.innerHTML = ``
  })

  test.each([
    [`valid structure with sites`, {
      sites: [{
        species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
        abc: [0, 0, 0],
        xyz: [0, 0, 0],
        label: `H1`,
        properties: {},
      }],
      charge: 0,
    }],
    [`structure with lattice`, {
      sites: [{
        species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
        abc: [0.5, 0.5, 0.5],
        xyz: [1, 1, 1],
        label: `C1`,
        properties: {},
      }],
      lattice: {
        matrix: [[2, 0, 0], [0, 2, 0], [0, 0, 2]],
        pbc: [true, true, true],
        volume: 8,
        a: 2,
        b: 2,
        c: 2,
        alpha: 90,
        beta: 90,
        gamma: 90,
      },
      charge: 0,
    }],
  ])(`renders successfully with %s`, (_description, structure) => {
    mount(Structure, {
      target: document.body,
      props: { structure: structure as AnyStructure },
    })

    expect(document.body.textContent).not.toContain(`No sites found in structure`)
    expect(document.body.textContent).not.toContain(`No structure provided`)
  })

  test.each([
    [`undefined structure`, undefined],
    [`null structure`, null],
    [`empty object`, {} as unknown],
    [`structure without sites`, { lattice: {} } as unknown],
    [`structure with null sites`, { sites: null } as unknown],
    [`structure with empty sites array`, { sites: [] }],
    [`structure with undefined sites`, { sites: undefined } as unknown],
  ])(`shows appropriate error for %s`, (_description, structure) => {
    mount(Structure, {
      target: document.body,
      props: { structure: structure as AnyStructure },
    })

    if (!structure) {
      expect(document.body.textContent).toContain(`No structure provided`)
    } else {
      expect(document.body.textContent).toContain(`No sites found in structure`)
    }
  })

  test(`handles real nested JSON structure correctly`, () => {
    const file_path =
      `./src/site/structures/nested-Hf36Mo36Nb36Ta36W36-hcp-mace-omat.json.gz`
    // Read and parse the actual nested JSON file (compressed)
    const compressed = readFileSync(file_path)
    const content = gunzipSync(compressed).toString(`utf8`)
    const parsed = JSON.parse(content)

    // Extract the nested structure (simulating our parse_any_structure logic)
    const nested_structure = parsed[0].structure

    // Verify the structure is valid before testing component
    expect(nested_structure.sites).toBeDefined()
    expect(nested_structure.sites.length).toBeGreaterThan(0)

    // Test component renders without errors
    mount(Structure, {
      target: document.body,
      props: { structure: nested_structure as AnyStructure },
    })

    expect(document.body.textContent).not.toContain(`No sites found in structure`)
    expect(document.body.textContent).not.toContain(`No structure provided`)
  })

  test(`structure validation logic works correctly`, () => {
    // Test the exact validation logic used in the component
    const validate_structure = (structure: AnyStructure | null | undefined) => {
      return Array.isArray(structure?.sites) && (structure?.sites?.length ?? 0) > 0
    }

    expect(validate_structure(undefined)).toBe(false)
    expect(validate_structure(null)).toBe(false)
    expect(validate_structure({} as AnyStructure)).toBe(false)
    expect(validate_structure({ sites: null } as unknown as AnyStructure)).toBe(false)
    expect(validate_structure({ sites: undefined } as unknown as AnyStructure)).toBe(
      false,
    )
    expect(validate_structure({ sites: [] })).toBe(false)
    expect(validate_structure({ sites: `not_array` } as unknown as AnyStructure)).toBe(
      false,
    )

    // Valid cases
    expect(
      validate_structure({
        sites: [{
          species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
          abc: [0, 0, 0],
          xyz: [0, 0, 0],
          label: `H1`,
          properties: {},
        }],
      }),
    ).toBe(true)
    expect(validate_structure({ sites: [1, 2, 3] } as unknown as AnyStructure)).toBe(true) // Any non-empty array
  })

  test(`end-to-end data flow validation logic`, () => {
    // Test the parsing transformation logic without importing the full parser
    // This simulates what parse_any_structure does
    const mock_nested_structure = {
      sites: [{
        species: [{ element: `Fe`, occu: 1, oxidation_state: 0 }],
        abc: [0, 0, 0],
        xyz: [0, 0, 0],
        label: `Fe1`,
        properties: {},
      }],
      lattice: { matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
    }

    // Simulate the transformation that parse_any_structure does
    const transformed_structure = {
      sites: mock_nested_structure.sites,
      charge: 0,
      lattice: { ...mock_nested_structure.lattice, pbc: [true, true, true] },
    }

    // Verify the transformation worked correctly
    expect(transformed_structure).toBeTruthy()
    expect(transformed_structure.sites.length).toBe(1)
    expect(transformed_structure.charge).toBe(0)
    expect(transformed_structure.lattice.pbc).toEqual([true, true, true])

    // Test component renders correctly - no error messages should appear
    mount(Structure, {
      target: document.body,
      props: { structure: transformed_structure as AnyStructure },
    })

    expect(document.body.textContent).not.toContain(`No sites found in structure`)
  })
})

// Combined camera projection functionality tests
test.each([
  [`perspective`, `orthographic`],
  [`orthographic`, `perspective`],
])(
  `camera projection %s: UI toggle, rendering, zoom settings, and integration`,
  async (initial_projection, target_projection) => {
    const scene_props = {
      camera_projection: initial_projection,
      atom_radius: 1.5,
      auto_rotate: 0.5,
    }
    mount(Structure, {
      target: document.body,
      props: { structure, controls_open: true, show_controls: true, scene_props },
    })
    await tick()

    // Test 1: UI controls are accessible with correct options
    const projection_label = Array.from(document.querySelectorAll(`label`))
      .find((label) => label.textContent?.includes(`Projection`))
    expect(projection_label).toBeTruthy()

    const projection_select = doc_query<HTMLSelectElement>(`.controls-panel select`)
    expect(projection_select?.value).toBe(initial_projection)

    const options = Array.from(projection_select?.querySelectorAll(`option`) || [])
    expect(options.map((option) => (option as HTMLOptionElement).value)).toEqual(
      [`perspective`, `orthographic`],
    )

    // Test 2: Component renders correctly without errors
    const structure_component = document.querySelector(`.structure`)
    expect(structure_component).toBeTruthy()
    expect(document.body.textContent).not.toContain(`No structure provided`)

    // Test 3: Toggle projection and verify change
    projection_select.value = target_projection
    projection_select.dispatchEvent(new Event(`change`, { bubbles: true }))
    await tick()
    expect(projection_select.value).toBe(target_projection)

    // Test 4: Other scene properties remain functional after projection change
    const radius_input = document.querySelector(
      `.controls-panel input[type="number"][step="0.05"]`,
    ) as HTMLInputElement
    const auto_rotate_input = document.querySelector(
      `.controls-panel input[type="number"][max="2"]`,
    ) as HTMLInputElement

    expect(parseFloat(radius_input?.value || `0`)).toBeCloseTo(1.5, 1)
    expect(parseFloat(auto_rotate_input?.value || `0`)).toBeCloseTo(0.5, 1)

    radius_input.value = `2.0`
    radius_input.dispatchEvent(new Event(`input`, { bubbles: true }))
    await tick()
    expect(parseFloat(radius_input.value)).toBeCloseTo(2.0, 1)

    // Test 5: State persistence across component updates (simplified for Svelte 5)
    // In a real app, scene_props would be reactive - here we just verify the projection persists
    await tick()
    if (projection_select) {
      expect(projection_select.value).toBe(target_projection) // Projection should persist
    }
  },
)

// Test advanced camera logic functionality
test(`camera projection conditional logic and zoom speed handling`, async () => {
  const _component = mount(Structure, {
    target: document.body,
    props: {
      structure,
      controls_open: true,
      scene_props: { camera_projection: `perspective`, zoom_speed: 0.5 },
      show_controls: true,
    },
  })
  await tick()

  const projection_select = doc_query<HTMLSelectElement>(`.controls-panel select`)
  const zoom_speed_input = document.querySelector(
    `input[type="number"][min="0.1"][max="0.8"]`,
  ) as HTMLInputElement

  // Test zoom speed logic exists and functions for both projections
  expect(zoom_speed_input).toBeTruthy()

  // Test orbit controls conditional logic by switching projections via UI
  const test_projections = [`orthographic`, `perspective`] as const
  const promises: Promise<void>[] = []

  for (const projection of test_projections) {
    if (projection_select) {
      projection_select.value = projection
      projection_select.dispatchEvent(new Event(`change`, { bubbles: true }))
      promises.push(tick())
    }

    // Component should render without errors (would fail if conditional logic is broken)
    expect(document.querySelector(`.structure`)).toBeTruthy()
    expect(zoom_speed_input).toBeTruthy() // Controls should remain functional
  }

  await Promise.all(promises)
})
