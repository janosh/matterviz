import { DEFAULTS } from '$lib/settings'
import { StructureControls } from '$lib/structure'
import { CNA_TYPE_PROPERTY } from '$lib/structure-id'
import type { TrajectoryPositionStream } from '$lib/trajectory'
import { mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { bind_props, simple_structure } from '../setup'

const trail_stream = (n_frames = 3): TrajectoryPositionStream => ({
  positions: new Float64Array(n_frames * 3),
  n_frames,
  n_atoms: 1,
  elements: [`H`],
  lattice_matrices: Array.from({ length: n_frames }, () => [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]),
  pbc: [false, false, false],
  coords_unwrapped: true,
  frame_stride: 1,
  steps: Array.from({ length: n_frames }, (_, idx) => idx),
})

describe(`StructureControls reactive props`, () => {
  test(`syncs site label controls from external scene prop updates`, async () => {
    const target = document.createElement(`div`)
    document.body.append(target)
    const state = $state({
      scene_props: {
        show_site_labels: true,
        site_label_color: `#111111`,
        site_label_bg_color: `color-mix(in srgb, #000000 20%, transparent)`,
      },
    })

    mount(StructureControls, {
      target,
      props: bind_props({ structure: simple_structure, controls_open: true }, state),
    })

    state.scene_props = {
      ...state.scene_props,
      site_label_color: `#00ff00`,
      site_label_bg_color: `color-mix(in srgb, #123456 70%, transparent)`,
    }
    await tick()

    const label_color_input = target.querySelector<HTMLInputElement>(
      `input[aria-label="Site label color"]`,
    )
    const label_bg_color_input = target.querySelector<HTMLInputElement>(
      `input[aria-label="Site label background color"]`,
    )
    const label_bg_opacity_input = target.querySelector<HTMLInputElement>(
      `input[aria-label="Site label background opacity"]`,
    )
    expect(label_color_input?.value).toBe(`#00ff00`)
    expect(label_bg_color_input?.value).toBe(`#123456`)
    expect(label_bg_opacity_input?.valueAsNumber).toBe(0.7)
  })

  test(`updates the scale type when the selected property changes`, async () => {
    const target = document.createElement(`div`)
    document.body.append(target)
    const structure = {
      ...simple_structure,
      sites: simple_structure.sites.map((site) => ({
        ...site,
        properties: { ...site.properties, charge: 0.5, [CNA_TYPE_PROPERTY]: 1 },
      })),
    }
    const state = $state({
      atom_color_config: {
        mode: `property` as const,
        property_key: `charge`,
        scale: DEFAULTS.structure.atom_color_scale,
        scale_type: `continuous` as const,
      },
    })
    mount(StructureControls, {
      target,
      props: bind_props({ structure, controls_open: true }, state),
    })
    await tick()

    // The native property dropdown performs this same nested mutation through bind:value.
    state.atom_color_config.property_key = CNA_TYPE_PROPERTY
    await tick()

    expect(state.atom_color_config).toMatchObject({
      property_key: CNA_TYPE_PROPERTY,
      scale_type: `categorical`,
    })
  })

  test(`polyhedra center checkbox tracks configured intent, not just render state`, async () => {
    const target = document.createElement(`div`)
    document.body.append(target)
    const state = $state({
      scene_props: {
        show_polyhedra: `crystals` as const,
        polyhedra_included_elements: [`O`],
        polyhedra_excluded_elements: [] as string[],
      },
    })

    mount(StructureControls, {
      target,
      props: bind_props(
        // nothing rendered yet (e.g. O blocked by CN cap), but O is force-included
        { structure: simple_structure, controls_open: true, polyhedra_rendered_elements: [] },
        state,
      ),
    })
    await tick()

    const center_checkbox = (symbol: string) =>
      [...target.querySelectorAll(`label`)]
        .find((label) => label.textContent?.trim() === symbol)
        ?.querySelector<HTMLInputElement>(`input[type="checkbox"]`)

    // force-included element shows checked even when not (yet) rendered
    expect(center_checkbox(`O`)?.checked).toBe(true)
    // a non-included, non-rendered element stays unchecked
    expect(center_checkbox(`H`)?.checked).toBe(false)

    // toggling the force-included element off must be reversible from the same control
    center_checkbox(`O`)?.dispatchEvent(new Event(`change`, { bubbles: true }))
    await tick()
    expect(state.scene_props.polyhedra_included_elements).not.toContain(`O`)
    expect(center_checkbox(`O`)?.checked).toBe(false)
  })

  test(`renders multi-character element symbols as single center checkboxes`, async () => {
    const target = document.createElement(`div`)
    document.body.append(target)
    // flatMap only flattens arrays, not strings, so 2-letter symbols like Fe must
    // stay intact (not split into F + e). Guards against a flatMap -> spread regression.
    const fe_oxide = {
      id: `test_fe_oxide`,
      sites: [
        {
          species: [{ element: `Fe`, occu: 1, oxidation_state: 3 }],
          xyz: [0, 0, 0],
          abc: [0, 0, 0],
          label: `Fe1`,
          properties: {},
        },
        {
          species: [{ element: `O`, occu: 1, oxidation_state: -2 }],
          xyz: [1.5, 0, 0],
          abc: [0.15, 0, 0],
          label: `O1`,
          properties: {},
        },
      ],
    } as typeof simple_structure
    const state = $state({ scene_props: { show_polyhedra: `crystals` as const } })

    mount(StructureControls, {
      target,
      props: bind_props({ structure: fe_oxide, controls_open: true }, state),
    })
    await tick()

    const center_label = (symbol: string) =>
      [...target.querySelectorAll(`label`)].find(
        (label) => label.textContent?.trim() === symbol,
      )

    expect(center_label(`Fe`)).toBeDefined()
    expect(center_label(`O`)).toBeDefined()
    // no split-character artifacts from string iteration
    expect(center_label(`F`)).toBeUndefined()
    expect(center_label(`e`)).toBeUndefined()
  })

  // Sections wire `current_values` and `on_reset` from one shared key list, so this covers
  // every scene_props-driven section: the reset offer appears only once something differs
  // from the mount-time snapshot, and clicking it puts every key of that section back.
  test(`offers a section reset only after a change and restores every key`, async () => {
    const target = document.createElement(`div`)
    document.body.append(target)
    // every key defined at its default, so the mount-time snapshot the reset offer compares
    // against isn't perturbed by `bind:` writing back into an undefined prop
    const state = $state({ scene_props: { ...DEFAULTS.structure } })

    mount(StructureControls, {
      target,
      props: bind_props(
        {
          structure: simple_structure,
          controls_open: true,
          displacement_summary: { rmsd: 0.12, max_displacement: 0.34, error: null },
        },
        state,
      ),
    })
    await tick()

    const reset_button = (section: string) =>
      target.querySelector<HTMLButtonElement>(
        `button[aria-label="Reset ${section} to defaults"]`,
      )
    // nothing differs from the mount-time snapshot yet, so neither section offers a reset
    expect(reset_button(`displacement overlay`)).toBeNull()
    expect(reset_button(`polyhedra`)).toBeNull()

    state.scene_props.displacement_arrow_color = `#123456`
    state.scene_props.polyhedra_excluded_elements = [`O`]
    await tick()
    reset_button(`displacement overlay`)?.click()
    reset_button(`polyhedra`)?.click()
    await tick()

    expect(state.scene_props.displacement_arrow_color).toBe(
      DEFAULTS.structure.displacement_arrow_color,
    )
    expect(state.scene_props.polyhedra_excluded_elements).toEqual([])
  })

  // The next two cover the temporary wrapper in $lib/overlays/DraggablePane.svelte and come
  // out together once a svelte-widgets release carries the upstream fixes.
  const mount_open_pane = async () => {
    const target = document.createElement(`div`)
    document.body.append(target)
    const state = $state({ controls_open: true })
    mount(StructureControls, {
      target,
      props: bind_props({ structure: simple_structure }, state),
    })
    await tick()
    const pane = target.querySelector(`.controls-pane`)
    if (!(pane instanceof HTMLElement)) throw new Error(`controls pane not rendered`)
    return { target, state, pane }
  }
  // detail 1 marks a pointer-driven click; 0 is what keyboard and programmatic clicks report
  const fire = (node: Element, type: string, detail = 1) =>
    node.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, detail }))
  const press = (node: Element) => fire(node, `pointerdown`)
  const release = (node: Element) => fire(node, `click`)

  // The pane dismisses on the click, not on the press that precedes it. A press-time close
  // lands before the click's default action, so an outside control that drives
  // `controls_open` (the test route's checkbox) gets its own state rewritten by the close
  // and then flipped straight back by its own click — the pane opens but never closes.
  test(`outside dismissal waits for the click, not the press`, async () => {
    const { state, pane } = await mount_open_pane()
    const outside = document.createElement(`button`)
    document.body.append(outside)

    press(outside)
    await tick()
    expect(state.controls_open).toBe(true)
    release(outside)
    await tick()
    expect(state.controls_open).toBe(false)

    // a drag or resize starts on the pane and can release past its edge, and the browser
    // then fires the click on a common ancestor — outside, but not a dismissal
    state.controls_open = true
    await tick()
    press(pane)
    release(document.body)
    await tick()
    expect(state.controls_open).toBe(true)

    // a download fires a synthetic click on an anchor appended to <body>: outside the pane,
    // detail 0. It reaches the capture-phase listener before the anchor's own
    // stopPropagation, so only a real pointer click may dismiss.
    state.controls_open = true
    await tick()
    press(outside) // clear the inside verdict, so only the detail check can save the pane
    fire(outside, `click`, 0)
    await tick()
    expect(state.controls_open).toBe(true)
  })

  // The corner grip is the only visible affordance for undoing a manual resize, so it has
  // to be hit-testable — svelte-widgets renders it as inert decoration — and its
  // double-click has to drop the inline size the resize wrote.
  test(`resize grip takes pointer events and double-click clears the manual size`, async () => {
    const { target, pane } = await mount_open_pane()
    const grip = target.querySelector(`.resize-grip`)
    if (!(grip instanceof SVGElement)) throw new Error(`resize grip not rendered`)
    expect(grip.style.pointerEvents).toBe(`auto`)

    // what `resizable` leaves behind after a corner drag
    pane.style.width = `600px`
    pane.style.height = `400px`
    fire(grip, `dblclick`)
    await tick()
    expect(pane.style.width).toBe(``)
    expect(pane.style.height).toBe(``)
  })

  test.each([
    {
      desc: `hidden without a stream slot`,
      stream: undefined as TrajectoryPositionStream | null | undefined,
      show_trails: false,
      expect_toggle: false,
      expect_length: false,
    },
    {
      desc: `toggle only while stream is pending`,
      stream: null,
      show_trails: false,
      expect_toggle: true,
      expect_length: false,
    },
    {
      desc: `length controls once a stream arrives`,
      stream: trail_stream(),
      show_trails: true,
      expect_toggle: true,
      expect_length: true,
    },
    {
      desc: `length controls stay gated on the trails toggle`,
      stream: trail_stream(),
      show_trails: false,
      expect_toggle: true,
      expect_length: false,
    },
  ])(
    `trajectory trails chrome: $desc`,
    async ({ stream, show_trails, expect_toggle, expect_length }) => {
      const target = document.createElement(`div`)
      document.body.append(target)
      const state = $state({
        show_trajectory_lines: show_trails,
        scene_props: { trajectory_position_stream: stream },
      })
      mount(StructureControls, {
        target,
        props: bind_props({ structure: simple_structure, controls_open: true }, state),
      })
      await tick()

      const has_toggle = [...target.querySelectorAll(`label`)].some((label) =>
        label.textContent?.includes(`Show trajectory trails`),
      )
      expect(has_toggle).toBe(expect_toggle)
      expect(target.textContent?.includes(`Trail length`) ?? false).toBe(expect_length)
    },
  )

  test(`explains unavailable multi-view and enables it when space becomes available`, async () => {
    const target = document.createElement(`div`)
    document.body.append(target)
    const state = $state<{
      multi_view: boolean
      multi_view_unavailable_reason: string | undefined
    }>({
      multi_view: false,
      multi_view_unavailable_reason: `Requires at least 600×400 px. Enlarge the viewer or use fullscreen.`,
    })

    mount(StructureControls, {
      target,
      props: bind_props({ controls_open: true }, state),
    })
    await tick()

    const multi_view_input = [...target.querySelectorAll<HTMLInputElement>(`input`)].find(
      (input) => input.closest(`label`)?.textContent?.includes(`Multi-view grid`),
    )
    expect(multi_view_input?.disabled).toBe(true)
    const hint_id = multi_view_input?.getAttribute(`aria-describedby`) ?? ``
    expect(document.querySelector(`#${hint_id}`)?.textContent).toContain(
      state.multi_view_unavailable_reason,
    )

    state.multi_view = true
    await tick()
    expect(multi_view_input?.disabled).toBe(false)
    multi_view_input?.click()
    expect(state.multi_view).toBe(false)

    state.multi_view_unavailable_reason = undefined
    await tick()
    expect(multi_view_input?.disabled).toBe(false)
    multi_view_input?.click()
    expect(state.multi_view).toBe(true)
  })
})
