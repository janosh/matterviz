import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
import type { PhaseDiagramData } from '$lib/phase-diagram'
import { PhaseDiagramExportPane } from '$lib/phase-diagram'
import { mount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'
// Real Al-Cu phase diagram data from pycalphad computation (subset of 5 boundaries)
import al_cu_data from './fixtures/al-cu-sample.json'

// Mock the export functions
vi.mock(`$lib/io/export`, () => ({
  export_svg_as_png: vi.fn(),
  export_svg_as_svg: vi.fn(),
}))

// Use actual Al-Cu phase diagram data computed from CALPHAD database
// Cast through unknown since JSON arrays aren't inferred as tuples
const mock_phase_data = al_cu_data as unknown as PhaseDiagramData

describe(`PhaseDiagramExportPane`, () => {
  let wrapper_div: HTMLDivElement
  let mock_svg: SVGSVGElement

  beforeEach(() => {
    wrapper_div = document.createElement(`div`)
    mock_svg = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`)
    mock_svg.setAttribute(`width`, `800`)
    mock_svg.setAttribute(`height`, `600`)
    wrapper_div.appendChild(mock_svg)
    document.body.appendChild(wrapper_div)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const get_button = (title_part: string): HTMLButtonElement => {
    const matches = Array.from(document.querySelectorAll(`button`)).filter((btn) =>
      btn.title?.includes(title_part)
    )
    if (matches.length === 0) {
      throw new Error(`No button found with title containing "${title_part}"`)
    }
    if (matches.length > 1) {
      throw new Error(`Multiple buttons match "${title_part}": ${matches.length} found`)
    }
    return matches[0]
  }

  test(`displays export format buttons for SVG, PNG, and JSON`, () => {
    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: mock_phase_data, wrapper: wrapper_div },
    })

    expect(document.body.textContent).toContain(`SVG`)
    expect(document.body.textContent).toContain(`PNG`)
    expect(document.body.textContent).toContain(`JSON`)
  })

  test(`displays section headings`, () => {
    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: mock_phase_data, wrapper: wrapper_div },
    })

    const headings = Array.from(document.querySelectorAll(`h4`)).map((h) => h.textContent)
    expect(headings).toContain(`Export as image`)
    expect(headings).toContain(`Export as data`)
  })

  test(`SVG download button calls export_svg_as_svg`, async () => {
    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: mock_phase_data, wrapper: wrapper_div },
    })

    const download_btn = get_button(`Download SVG`)
    expect(download_btn).toBeTruthy()

    download_btn.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(export_svg_as_svg).toHaveBeenCalledWith(
        mock_svg,
        `phase-diagram-AL-CU.svg`,
      )
    })
  })

  test(`PNG download button calls export_svg_as_png with DPI`, async () => {
    const png_dpi = 200

    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: mock_phase_data, wrapper: wrapper_div, png_dpi },
    })

    const download_btn = get_button(`PNG`)
    expect(download_btn).toBeTruthy()

    download_btn.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(export_svg_as_png).toHaveBeenCalledWith(
        mock_svg,
        `phase-diagram-AL-CU.png`,
        png_dpi,
      )
    })
  })

  test(`SVG copy button copies SVG to clipboard`, async () => {
    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: mock_phase_data, wrapper: wrapper_div },
    })

    const copy_btn = get_button(`Copy SVG`)
    expect(copy_btn).toBeTruthy()

    copy_btn.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining(`<svg`),
      )
    })
  })

  test(`JSON copy button copies data to clipboard`, async () => {
    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: mock_phase_data, wrapper: wrapper_div },
    })

    const copy_btn = get_button(`Copy JSON`)
    expect(copy_btn).toBeTruthy()

    copy_btn.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        JSON.stringify(mock_phase_data, null, 2),
      )
    })
  })

  test(`shows checkmark feedback after successful SVG copy`, async () => {
    vi.useFakeTimers()

    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: mock_phase_data, wrapper: wrapper_div },
    })

    const copy_btn = get_button(`Copy SVG`)
    expect(copy_btn.textContent).toContain(`📋`)

    copy_btn.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => expect(copy_btn.textContent).toContain(`✅`))

    vi.advanceTimersByTime(1500)
    await vi.waitFor(() => expect(copy_btn.textContent).toContain(`📋`))
  })

  test(`shows checkmark feedback after successful JSON copy`, async () => {
    vi.useFakeTimers()

    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: mock_phase_data, wrapper: wrapper_div },
    })

    const copy_btn = get_button(`Copy JSON`)
    expect(copy_btn.textContent).toContain(`📋`)

    copy_btn.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => expect(copy_btn.textContent).toContain(`✅`))

    vi.advanceTimersByTime(1500)
    await vi.waitFor(() => expect(copy_btn.textContent).toContain(`📋`))
  })

  test(`JSON buttons disabled when data is undefined`, () => {
    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: undefined, wrapper: wrapper_div },
    })

    const download_btn = get_button(`Download JSON`)
    const copy_btn = get_button(`Copy JSON`)

    expect(download_btn.disabled).toBe(true)
    expect(copy_btn.disabled).toBe(true)
  })

  test(`DPI input has correct attributes`, () => {
    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: mock_phase_data, wrapper: wrapper_div, png_dpi: 150 },
    })

    const dpi_input = doc_query<HTMLInputElement>(
      `input[type="number"][title*="dots per inch"]`,
    )
    expect(dpi_input.value).toBe(`150`)
    expect(dpi_input.min).toBe(`50`)
    expect(dpi_input.max).toBe(`600`)
  })

  test(`generates filename with component names`, async () => {
    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: mock_phase_data, wrapper: wrapper_div },
    })

    const svg_btn = get_button(`Download SVG`)
    svg_btn.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(export_svg_as_svg).toHaveBeenCalledWith(
        expect.anything(),
        `phase-diagram-AL-CU.svg`,
      )
    })
  })

  test(`uses default filename when components not available`, async () => {
    const data_no_components = {
      ...mock_phase_data,
      components: undefined,
    } as unknown as PhaseDiagramData

    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: data_no_components, wrapper: wrapper_div },
    })

    const svg_btn = get_button(`Download SVG`)
    svg_btn.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(export_svg_as_svg).toHaveBeenCalledWith(
        expect.anything(),
        `phase-diagram.svg`,
      )
    })
  })

  test(`uses custom filename when provided`, async () => {
    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: {
        data: mock_phase_data,
        wrapper: wrapper_div,
        filename: `custom-name`,
      },
    })

    const svg_btn = get_button(`Download SVG`)
    svg_btn.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(export_svg_as_svg).toHaveBeenCalledWith(
        expect.anything(),
        `custom-name-AL-CU.svg`,
      )
    })
  })

  test(`toggle button title when pane is closed`, () => {
    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { export_pane_open: false },
    })

    expect(doc_query(`.pd-export-toggle`).title).toBe(`Export phase diagram`)
  })

  test(`toggle button title is empty when pane is open`, () => {
    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { export_pane_open: true },
    })

    expect(doc_query(`.pd-export-toggle`).title).toBe(``)
  })

  test(`does not export SVG when wrapper has no SVG element`, async () => {
    const empty_wrapper = document.createElement(`div`)
    document.body.appendChild(empty_wrapper)

    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: mock_phase_data, wrapper: empty_wrapper },
    })

    const svg_btn = get_button(`Download SVG`)
    svg_btn.dispatchEvent(new Event(`click`, { bubbles: true }))

    // Flush microtasks then verify export was not called
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(export_svg_as_svg).not.toHaveBeenCalled()
  })

  test(`does not copy SVG when wrapper has no SVG element`, async () => {
    const empty_wrapper = document.createElement(`div`)
    document.body.appendChild(empty_wrapper)

    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: mock_phase_data, wrapper: empty_wrapper },
    })

    const copy_btn = get_button(`Copy SVG`)
    copy_btn.dispatchEvent(new Event(`click`, { bubbles: true }))

    // Flush microtasks then verify clipboard was not called
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  test(`JSON download creates blob URL and triggers download`, async () => {
    const revoke_spy = vi.spyOn(URL, `revokeObjectURL`)
    const create_spy = vi.spyOn(URL, `createObjectURL`).mockReturnValue(`blob:test-url`)

    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: mock_phase_data, wrapper: wrapper_div },
    })

    const download_btn = get_button(`Download JSON`)
    expect(download_btn.disabled).toBe(false)

    download_btn.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(create_spy).toHaveBeenCalledWith(expect.any(Blob))
      expect(revoke_spy).toHaveBeenCalledWith(`blob:test-url`)
    })

    create_spy.mockRestore()
    revoke_spy.mockRestore()
  })

  test(`does not copy JSON when data is undefined`, async () => {
    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: undefined, wrapper: wrapper_div },
    })

    // The button is disabled, but let's also verify click doesn't trigger copy
    vi.mocked(navigator.clipboard.writeText).mockClear()

    const copy_btn = get_button(`Copy JSON`)
    copy_btn.dispatchEvent(new Event(`click`, { bubbles: true }))

    // Wait a bit and verify clipboard was not called
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })
})
