import type { StructureIdResult } from '$lib/structure-id'
import { calc_structure_id, StructureTypePlot } from '$lib/structure-id'
import { describe, expect, test, vi } from 'vitest'
import { mount_sized } from '../setup'
import { make_bcc, make_fcc, make_hcp } from './lattices'

// Mounting BarPlot in happy-dom costs seconds, so every case here earns its mount
describe(`StructureTypePlot`, { timeout: 30_000 }, () => {
  const mount_plot = (props: Record<string, unknown>) =>
    mount_sized(StructureTypePlot, props, {
      selector: `.bar-plot, .status-message, section`,
    })

  const fcc_result = calc_structure_id(make_fcc([2, 2, 2]), { skip_csp: true })
  const bcc_result = calc_structure_id(make_bcc([2, 2, 2]), { skip_csp: true })
  const hcp_result = calc_structure_id(make_hcp([2, 2, 2]), { skip_csp: true })
  const frames: StructureIdResult[] = [fcc_result, hcp_result, bcc_result]

  type PlotProps = {
    id_results: StructureIdResult[]
    layout?: `by_type` | `over_frames`
    normalize?: boolean
    frame_labels?: number[]
  }

  test.each<[string, PlotProps]>([
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
  })

  test(`only populated types get an axis slot, plus Other`, async () => {
    const root = await mount_plot({ id_results: [fcc_result] })
    expect(root.textContent).toContain(`FCC`)
    expect(root.textContent).toContain(`Other`)
    // A pure fcc cell has no bcc/hcp/ico atoms, so those categories are dropped
    expect(root.textContent).not.toContain(`Icosahedral`)
  })

  test(`shows the empty state when there is nothing to plot`, async () => {
    const root = await mount_plot({ id_results: [] })
    expect(root.textContent).toContain(`No structure-type data to display`)
  })

  test(`computes from structures when no results are supplied`, async () => {
    const root = await mount_plot({ structures: [make_fcc([2, 2, 2])] })
    // Mount catches the component mid-flight: no results yet, so the loading state shows
    expect(root.textContent).toContain(`Identifying structure types`)
    // The status message is replaced by the plot once the promise settles, so the assertion
    // has to re-query the document rather than hold on to the detached status element.
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(`Structure type`)
      expect(document.body.textContent).toContain(`FCC`)
    })
  })
})
