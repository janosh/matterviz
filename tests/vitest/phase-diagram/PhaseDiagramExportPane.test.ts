import type { PhaseDiagramData } from '#lib/phase-diagram/index.js'
import PhaseDiagramExportPane from '#lib/phase-diagram/PhaseDiagramExportPane.svelte'
import { type ComponentProps, mount } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { click_export, doc_query, mock_object_url } from '../setup'
// Real Al-Cu phase diagram data from pycalphad computation (subset of 5 boundaries)
import al_cu_data from './fixtures/al-cu-sample.json' with { type: 'json' }

// Cast through unknown since JSON arrays aren't inferred as tuples
const mock_phase_data = al_cu_data as unknown as PhaseDiagramData
const mount_pane = (props: ComponentProps<typeof PhaseDiagramExportPane>) =>
  mount(PhaseDiagramExportPane, {
    target: document.body,
    props: { export_pane_open: true, ...props },
  })

describe(`PhaseDiagramExportPane`, () => {
  let wrapper_div: HTMLDivElement

  beforeEach(() => {
    wrapper_div = document.createElement(`div`)
    const svg = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`)
    svg.setAttribute(`viewBox`, `0 0 800 600`)
    svg.classList.add(`binary-phase-diagram`) // Required class for component query
    wrapper_div.append(svg)
    document.body.append(wrapper_div)
    vi.clearAllMocks()
  })

  test(`offers PNG/SVG and JSON with the shared DPI input`, () => {
    mount_pane({ data: mock_phase_data, wrapper: wrapper_div, png_dpi: 150 })
    const headings = Array.from(document.querySelectorAll(`h4`), (heading) =>
      heading.textContent?.trim(),
    )
    expect(headings).toEqual([`Image`, `Data`])
    const dpi_input = doc_query<HTMLInputElement>(
      `input[type="number"][title*="dots per inch"]`,
    )
    expect([dpi_input.value, dpi_input.min, dpi_input.max]).toEqual([`150`, `50`, `600`])
    expect(doc_query(`[aria-label="Download PNG"]`).title).toContain(`(150 DPI)`)
  })

  test.each([
    [`component filename`, {}, `phase-diagram-AL-CU`],
    [
      `default filename without components`,
      { data: { ...mock_phase_data, components: undefined } as unknown as PhaseDiagramData },
      `phase-diagram`,
    ],
    [`custom filename`, { filename: `custom-name` }, `custom-name-AL-CU`],
  ])(`SVG export uses the %s`, async (_desc, props, filename) => {
    const on_export = vi.fn()
    mount_pane({ data: mock_phase_data, wrapper: wrapper_div, on_export, ...props })
    await click_export(`SVG`)
    await vi.waitFor(() => expect(on_export).toHaveBeenCalledOnce())
    const [format, context] = on_export.mock.calls[0]
    expect([format, context.filename]).toEqual([`svg`, filename])
    expect(context.data).toContain(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"`,
    )
  })

  test.each([
    [`Copy SVG`, expect.stringContaining(`<svg`)],
    [`Copy JSON`, JSON.stringify(mock_phase_data, null, 2)],
  ])(`%s button copies content`, async (copy_label, expected_clipboard) => {
    mount_pane({ data: mock_phase_data, wrapper: wrapper_div })
    doc_query<HTMLButtonElement>(`[aria-label="${copy_label} to clipboard"]`).click()
    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expected_clipboard)
    })
  })

  test(`JSON is not offered without data`, () => {
    mount_pane({ data: undefined, wrapper: wrapper_div })
    expect(document.querySelector(`[aria-label="Download JSON"]`)).toBeNull()
    expect(document.querySelector(`[aria-label="Download SVG"]`)).not.toBeNull()
  })

  test.each([
    { export_pane_open: false, title: `Export phase diagram` },
    { export_pane_open: true, title: `` },
  ])(`toggle title is "$title" when open=$export_pane_open`, ({ export_pane_open, title }) => {
    mount_pane({ export_pane_open })
    expect(doc_query(`.pd-export-toggle`).title).toBe(title)
  })

  test(`a wrapper without the diagram SVG reports the error instead of exporting`, async () => {
    const on_export = vi.fn()
    const empty_wrapper = document.createElement(`div`)
    document.body.append(empty_wrapper)
    vi.spyOn(console, `error`).mockImplementation(() => {})
    mount_pane({ data: mock_phase_data, wrapper: empty_wrapper, on_export })
    await click_export(`SVG`)
    await vi.waitFor(() => expect(doc_query(`[role="alert"]`).textContent).toContain(`No SVG`))
    expect(on_export).not.toHaveBeenCalled()
  })

  test(`JSON download creates blob URL and triggers download`, async () => {
    const { create, revoke } = mock_object_url()
    mount_pane({ data: mock_phase_data, wrapper: wrapper_div })
    await click_export(`JSON`)
    await vi.waitFor(() => {
      expect(create).toHaveBeenCalledWith(expect.any(Blob))
      expect(revoke).toHaveBeenCalledWith(`blob:test-url`)
    })
  })
})
