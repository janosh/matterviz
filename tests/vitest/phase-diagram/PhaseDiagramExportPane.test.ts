import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
import type { PhaseDiagramData } from '$lib/phase-diagram'
import { PhaseDiagramExportPane } from '$lib/phase-diagram'
import { mount } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'
// Real Al-Cu phase diagram data from pycalphad computation (subset of 5 boundaries)
import al_cu_data from './fixtures/al-cu-sample.json' with { type: 'json' }

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
    mock_svg.classList.add(`binary-phase-diagram`) // Required class for component query
    wrapper_div.append(mock_svg)
    document.body.append(wrapper_div)
    vi.clearAllMocks()
  })

  const get_button = (title_part: string): HTMLButtonElement => {
    const matches = Array.from(document.querySelectorAll(`button`)).filter((btn) =>
      btn.title?.includes(title_part),
    )
    if (matches.length === 0) {
      throw new Error(`No button found with title containing "${title_part}"`)
    }
    if (matches.length > 1) {
      throw new Error(`Multiple buttons match "${title_part}": ${matches.length} found`)
    }
    return matches[0]
  }

  test(`displays section headings and export format buttons`, () => {
    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: mock_phase_data, wrapper: wrapper_div },
    })

    for (const label of [`SVG`, `PNG`, `JSON`]) {
      expect(document.body.textContent).toContain(label)
    }
    const headings = Array.from(document.querySelectorAll(`h4`)).map(
      (heading) => heading.textContent,
    )
    expect(headings).toContain(`Image`)
    expect(headings).toContain(`Data`)
  })

  test(`SVG download button calls export_svg_as_svg with component filename`, async () => {
    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: mock_phase_data, wrapper: wrapper_div },
    })

    const download_btn = get_button(`Download SVG`)
    expect(download_btn).toBeInstanceOf(HTMLButtonElement)

    download_btn.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(export_svg_as_svg).toHaveBeenCalledWith(mock_svg, `phase-diagram-AL-CU.svg`)
    })
  })

  test(`PNG download button calls export_svg_as_png with DPI`, async () => {
    const png_dpi = 200

    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: mock_phase_data, wrapper: wrapper_div, png_dpi },
    })

    const download_btn = get_button(`PNG`)
    expect(download_btn).toBeInstanceOf(HTMLButtonElement)

    download_btn.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(export_svg_as_png).toHaveBeenCalledWith(
        mock_svg,
        `phase-diagram-AL-CU.png`,
        png_dpi,
      )
    })
  })

  test.each([
    {
      copy_title: `Copy SVG`,
      expected_clipboard: expect.stringContaining(`<svg`),
    },
    {
      copy_title: `Copy JSON`,
      expected_clipboard: JSON.stringify(mock_phase_data, null, 2),
    },
  ])(
    `$copy_title button copies content and remains stable after timeout`,
    async ({ copy_title, expected_clipboard }) => {
      vi.useFakeTimers()
      mount(PhaseDiagramExportPane, {
        target: document.body,
        props: { data: mock_phase_data, wrapper: wrapper_div },
      })

      const copy_btn = get_button(copy_title)
      expect(copy_btn).toBeInstanceOf(HTMLButtonElement)
      copy_btn.dispatchEvent(new Event(`click`, { bubbles: true }))

      await vi.waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expected_clipboard)
      })

      vi.advanceTimersByTime(1500)
      expect(copy_btn).toBeInstanceOf(HTMLButtonElement)
      vi.useRealTimers()
    },
  )

  test(`JSON buttons disabled and copy is a no-op when data is undefined`, async () => {
    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { data: undefined, wrapper: wrapper_div },
    })

    const copy_btn = get_button(`Copy JSON`)
    expect(get_button(`Download JSON`).disabled).toBe(true)
    expect(copy_btn.disabled).toBe(true)

    vi.mocked(navigator.clipboard.writeText).mockClear()
    copy_btn.dispatchEvent(new Event(`click`, { bubbles: true }))
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
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
      expect(export_svg_as_svg).toHaveBeenCalledWith(expect.anything(), `phase-diagram.svg`)
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

  test.each([
    { export_pane_open: false, title: `Export phase diagram` },
    { export_pane_open: true, title: `` },
  ])(`toggle title is "$title" when open=$export_pane_open`, ({ export_pane_open, title }) => {
    mount(PhaseDiagramExportPane, {
      target: document.body,
      props: { export_pane_open },
    })

    expect(doc_query(`.pd-export-toggle`).title).toBe(title)
  })

  test.each([
    { button_title: `Download SVG`, was_called: () => vi.mocked(export_svg_as_svg) },
    { button_title: `Copy SVG`, was_called: () => vi.mocked(navigator.clipboard.writeText) },
  ])(
    `$button_title is a no-op when wrapper has no SVG element`,
    async ({ button_title, was_called }) => {
      const empty_wrapper = document.createElement(`div`)
      document.body.append(empty_wrapper)

      mount(PhaseDiagramExportPane, {
        target: document.body,
        props: { data: mock_phase_data, wrapper: empty_wrapper },
      })

      get_button(button_title).dispatchEvent(new Event(`click`, { bubbles: true }))

      // Flush microtasks then verify export/clipboard was not called
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      expect(was_called()).not.toHaveBeenCalled()
    },
  )

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
})
