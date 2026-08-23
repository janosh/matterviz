import type { StructureIdResult } from '$lib/structure-id'
import { calc_structure_id, StructureTypePlot } from '$lib/structure-id'
import * as async_compute from '$lib/structure-id/async-compute.svelte'
import type { StructureInput } from '$lib/plot/core/structure-input'
import { to_error } from '$lib/utils'
import { type ComponentProps, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { bind_props, mount_sized } from '../setup'
import { make_bcc, make_fcc, make_hcp } from './lattices'

// Mounting BarPlot in happy-dom costs seconds, so every case here earns its mount
describe(`StructureTypePlot`, { timeout: 30_000 }, () => {
  let mounted: ReturnType<typeof mount>[] = []
  afterEach(async () => {
    await Promise.all(mounted.map((component) => unmount(component)))
    mounted = []
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  const mount_plot = (props: ComponentProps<typeof StructureTypePlot>) =>
    mount_sized(StructureTypePlot, props, {
      selector: `.bar-plot, .status-message, section`,
    })
  // Mount with every prop bound to `state`; returns an early unmount, else afterEach unmounts
  const mount_bound = (state: Partial<ComponentProps<typeof StructureTypePlot>>) => {
    const component = mount(StructureTypePlot, {
      target: document.body,
      props: bind_props({}, state),
    })
    mounted.push(component)
    return () => {
      mounted = mounted.filter((other) => other !== component)
      return unmount(component)
    }
  }

  const fcc_result = calc_structure_id(make_fcc([2, 2, 2]), { skip_csp: true })
  const bcc_result = calc_structure_id(make_bcc([2, 2, 2]), { skip_csp: true })
  const hcp_result = calc_structure_id(make_hcp([2, 2, 2]), { skip_csp: true })
  const frames: StructureIdResult[] = [fcc_result, hcp_result, bcc_result]

  // `over_frames` without labels is covered by the explicit frame_labels case below
  test.each<[string, ComponentProps<typeof StructureTypePlot>]>([
    [`one result, by_structure`, { id_results: [fcc_result] }],
    [`normalized`, { id_results: frames, normalize: true }],
    [
      `over_frames with labels`,
      {
        id_results: frames,
        layout: `over_frames`,
        frame_labels: [10, 20, 30],
      },
    ],
  ])(`renders %s`, async (_name, props) => {
    const root = await mount_plot(props)
    expect(root.querySelector(`svg`)).toBeInstanceOf(SVGSVGElement)
    expect(root.textContent).toContain(props.normalize ? `Fraction of atoms` : `Atoms`)
    expect(root.textContent).toContain(props.layout === `over_frames` ? `Frame` : `Structure`)
    // One series per CNA type in the legend: only populated types (plus always-kept Other)
    if (props.id_results?.length === 1) {
      expect(root.textContent).toContain(`FCC`)
      expect(root.textContent).toContain(`Other`)
      expect(root.textContent).not.toContain(`Icosahedral`)
      expect(root.textContent).not.toContain(`BCC`)
    }
    for (const label of props.frame_labels ?? []) {
      expect(root.textContent).toContain(String(label))
    }
  })

  // In either layout every series is one populated CNA type (the previous per-result series
  // cycled the type palette by result index, so "frame 1" was painted in the FCC colour), and
  // the shared x_axis/y_axis props override the layout's own axis label/range defaults
  test.each([`by_structure`, `over_frames`] as const)(
    `%s layout draws one series per populated type and applies x_axis/y_axis overrides`,
    async (layout) => {
      const root = await mount_plot({
        id_results: frames,
        layout,
        x_axis: { label: `Custom primary` },
        y_axis: { label: `Custom value`, range: [0, 1000] },
      })
      const legend_labels = Array.from(
        root.querySelectorAll(`.legend-item .legend-label`),
      ).map((item) => item.textContent?.trim())
      expect(legend_labels).toEqual([`Other`, `FCC`, `HCP`, `BCC`])
      expect(root.textContent).toContain(`Custom primary`)
      expect(root.textContent).toContain(`Custom value`)
      expect(root.textContent).not.toContain(layout === `over_frames` ? `Frame` : `Structure`)
      expect(root.textContent).not.toContain(`Atoms`)
      // the forced y range shows up in the tick labels
      expect(root.textContent).toContain(`1000`)
    },
  )

  test(`shows the empty state when there is nothing to plot`, async () => {
    const root = await mount_plot({ id_results: [], allow_file_drop: false })
    expect(root.textContent).toContain(`No structure-type data to display`)
  })

  // Results-only mode (no `structures`): the parent drives `loading` one-way while it collects
  // results, and the compute effect must not reset it to false
  test(`results-only mount keeps the parent's loading state`, async () => {
    const root = await mount_plot({ id_results: [], loading: true })
    expect(root.textContent).toContain(`Identifying structure types`)
    expect(root.textContent).not.toContain(`No structure-type data to display`)
  })

  test.each<[string, StructureInput, string[]]>([
    [`single structure`, make_fcc([2, 2, 2]), [`Structure`]],
    [
      `labelled record`,
      { small: make_fcc([2, 2, 2]), large: make_fcc([3, 3, 3]) },
      [`small`, `large`],
    ],
    [`entry array`, [{ label: `fcc cell`, structure: make_fcc([2, 2, 2]) }], [`fcc cell`]],
  ])(
    `computes from a %s and labels the x axis by entry`,
    async (_name, structures, labels) => {
      const target = document.createElement(`div`)
      document.body.append(target)
      const component = mount(StructureTypePlot, { target, props: { structures } })
      try {
        flushSync()
        // Mount catches the component mid-flight: no results yet, so the loading state shows
        const loading_status = target.querySelector<HTMLElement>(`.status-message`)
        expect(loading_status?.isConnected).toBe(true)
        expect(loading_status?.textContent).toContain(`Identifying structure types`)
        // The status message is replaced by the plot once the promise settles, so the assertion
        // has to re-query this mount target rather than hold on to the detached status element.
        await vi.waitFor(() => {
          for (const text of [`FCC`, ...labels]) expect(target.textContent).toContain(text)
        })
      } finally {
        await unmount(component)
      }
    },
  )

  test(`discards a pending compute when structures are cleared, and aborts it on unmount`, async () => {
    const pending_compute = Promise.withResolvers<StructureIdResult>()
    const signals: (AbortSignal | undefined)[] = []
    vi.spyOn(async_compute, `calc_structure_id_async`).mockImplementation(
      (_structure, _options, request_options) => {
        const signal = request_options?.signal
        signals.push(signal)
        // like the worker client: settle with the shared result, or reject once aborted
        return new Promise((resolve, reject) => {
          signal?.addEventListener(`abort`, () => reject(to_error(signal.reason)))
          void pending_compute.promise.then(resolve)
        })
      },
    )
    const state = $state({
      structures: [{ label: `a`, structure: make_fcc([1, 1, 1]) }] as
        | StructureInput
        | undefined,
      id_results: [] as StructureIdResult[],
      loading: false,
      error_msg: undefined as string | undefined,
    })
    const unmount_plot = mount_bound(state)
    flushSync()
    expect(state.loading).toBe(true)
    expect(signals[0]?.aborted).toBe(false)
    state.structures = undefined
    flushSync()
    expect(state.loading).toBe(false)
    expect(signals[0]?.aborted).toBe(true)

    pending_compute.resolve(fcc_result)
    await tick()
    await Promise.resolve()
    expect(state.id_results).toEqual([])

    state.structures = [{ label: `a`, structure: make_fcc([1, 1, 1]) }]
    flushSync()
    expect(signals).toHaveLength(2)
    expect(signals[1]?.aborted).toBe(false)
    await unmount_plot()
    // unmount aborts the worker request without reporting the abort as an error
    expect(signals[1]?.aborted).toBe(true)
    await tick()
    expect(state.error_msg).toBeUndefined()
  })

  // A failed compute used to leave its message behind once `structures` was emptied, because
  // the reset sat after the early return for empty input
  test(`clears the error once the failing structures are replaced or removed`, async () => {
    const compute_spy = vi
      .spyOn(async_compute, `calc_structure_id_async`)
      .mockRejectedValueOnce(new Error(`synthetic failure`))
    const state = $state<{
      structures: StructureInput | undefined
      error_msg: string | undefined
      id_results: StructureIdResult[]
    }>({ structures: make_fcc([1, 1, 1]), error_msg: undefined, id_results: [] })
    mount_bound(state)
    await vi.waitFor(() => expect(state.error_msg).toBe(`synthetic failure`))
    expect(document.body.textContent).toContain(`synthetic failure`)

    state.structures = undefined
    flushSync()
    expect(state.error_msg).toBeUndefined()

    state.structures = make_fcc([2, 2, 2])
    await vi.waitFor(() => expect(state.id_results).toHaveLength(1))
    expect(compute_spy).toHaveBeenCalledTimes(2)
    expect(state.error_msg).toBeUndefined()
    expect(document.body.textContent).not.toContain(`synthetic failure`)
  })

  test(`equivalent recreated ID options do not recompute`, async () => {
    const compute_spy = vi.spyOn(async_compute, `calc_structure_id_async`)
    const structure = make_fcc([1, 1, 1])
    const props = $state({
      structures: [{ label: `cell`, structure }],
      id_options: { skip_csp: true },
    })
    await mount_plot(props)
    expect(compute_spy).toHaveBeenCalledOnce()

    props.id_options = { skip_csp: true }
    flushSync()
    await tick()
    expect(compute_spy).toHaveBeenCalledOnce()

    props.id_options = { skip_csp: false }
    flushSync()
    await tick()
    expect(compute_spy).toHaveBeenCalledTimes(2)
    expect(compute_spy).toHaveBeenLastCalledWith(
      structure,
      { skip_csp: false },
      { signal: expect.any(AbortSignal) },
    )
    // the superseded request was told to stop; the live one was not
    expect(compute_spy.mock.calls.map(([, , opts]) => opts?.signal?.aborted)).toEqual([
      true,
      false,
    ])
  })
})
