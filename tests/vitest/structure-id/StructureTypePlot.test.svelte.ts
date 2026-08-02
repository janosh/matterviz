import type { StructureIdResult } from '$lib/structure-id'
import { calc_structure_id, StructureTypePlot } from '$lib/structure-id'
import * as async_compute from '$lib/structure-id/async-compute.svelte'
import { type ComponentProps, flushSync, mount, tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { mount_sized } from '../setup'
import { make_bcc, make_fcc, make_hcp } from './lattices'

// Mounting BarPlot in happy-dom costs seconds, so every case here earns its mount
describe(`StructureTypePlot`, { timeout: 30_000 }, () => {
  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  const mount_plot = (props: ComponentProps<typeof StructureTypePlot>) =>
    mount_sized(StructureTypePlot, props, {
      selector: `.bar-plot, .status-message, section`,
    })

  const fcc_result = calc_structure_id(make_fcc([2, 2, 2]), { skip_csp: true })
  const bcc_result = calc_structure_id(make_bcc([2, 2, 2]), { skip_csp: true })
  const hcp_result = calc_structure_id(make_hcp([2, 2, 2]), { skip_csp: true })
  const frames: StructureIdResult[] = [fcc_result, hcp_result, bcc_result]

  test.each<[string, ComponentProps<typeof StructureTypePlot>]>([
    [`one result, by_type`, { id_results: [fcc_result] }],
    [`several results, by_type`, { id_results: frames }],
    [`several results, over_frames`, { id_results: frames, layout: `over_frames` }],
    [`normalized`, { id_results: frames, normalize: true }],
    [
      `explicit frame labels`,
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
    expect(root.textContent).toContain(
      props.layout === `over_frames` ? `Frame` : `Structure type`,
    )
    // Pure fcc: only populated types (plus always-kept Other) get an axis slot
    if (props.id_results?.length === 1) {
      expect(root.textContent).toContain(`FCC`)
      expect(root.textContent).toContain(`Other`)
      expect(root.textContent).not.toContain(`Icosahedral`)
    }
    for (const label of props.frame_labels ?? []) {
      expect(root.textContent).toContain(String(label))
    }
  })

  test(`shows the empty state when there is nothing to plot`, async () => {
    const root = await mount_plot({ id_results: [] })
    expect(root.textContent).toContain(`No structure-type data to display`)
  })

  test(`computes from structures when no results are supplied`, async () => {
    const target = document.createElement(`div`)
    document.body.append(target)
    mount(StructureTypePlot, {
      target,
      props: { structures: [make_fcc([2, 2, 2])] },
    })
    flushSync()
    // Mount catches the component mid-flight: no results yet, so the loading state shows
    const loading_status = target.querySelector<HTMLElement>(`.status-message`)
    expect(loading_status?.isConnected).toBe(true)
    expect(loading_status?.textContent).toContain(`Identifying structure types`)
    // The status message is replaced by the plot once the promise settles, so the assertion
    // has to re-query this mount target rather than hold on to the detached status element.
    await vi.waitFor(() => {
      expect(target.textContent).toContain(`Structure type`)
      expect(target.textContent).toContain(`FCC`)
    })
  })

  test(`equivalent recreated ID options do not recompute`, async () => {
    const compute_spy = vi.spyOn(async_compute, `compute_structure_id_async`)
    const structure = make_fcc([1, 1, 1])
    const props = $state({
      structures: [structure],
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
    expect(compute_spy).toHaveBeenLastCalledWith(structure, { skip_csp: false })
  })
})
