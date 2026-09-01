import { export_svg_as_png, export_svg_as_svg } from '$lib/io/export'
import type { PhaseDiagramData } from '$lib/phase-diagram'
import { PhaseDiagramExportPane } from '$lib/phase-diagram'
import { type ComponentProps, mount } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query, mock_object_url } from '../setup'
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
const mount_pane = (props: ComponentProps<typeof PhaseDiagramExportPane>) =>
  mount(PhaseDiagramExportPane, { target: document.body, props })

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
    mount_pane({ data: mock_phase_data, wrapper: wrapper_div })

    for (const label of [`SVG`, `PNG`, `JSON`]) {
      expect(document.body.textContent).toContain(label)
    }
    const headings = Array.from(document.querySelectorAll(`h4`)).map(
      (heading) => heading.textContent,
    )
    expect(headings).toContain(`Image`)
    expect(headings).toContain(`Data`)
  })

  test.each([
    { desc: `component filename`, props: {}, expected: `phase-diagram-AL-CU.svg` },
    {
      desc: `default filename without components`,
      props: {
        data: { ...mock_phase_data, components: undefined } as unknown as PhaseDiagramData,
      },
      expected: `phase-diagram.svg`,
    },
    {
      desc: `custom filename`,
      props: { filename: `custom-name` },
      expected: `custom-name-AL-CU.svg`,
    },
  ])(`Download SVG uses $desc`, async ({ props, expected }) => {
    mount_pane({ data: mock_phase_data, wrapper: wrapper_div, ...props })
    get_button(`Download SVG`).click()
    await vi.waitFor(() => {
      expect(export_svg_as_svg).toHaveBeenCalledWith(mock_svg, expected)
    })
  })

  test(`PNG download button calls export_svg_as_png with DPI`, async () => {
    const png_dpi = 200

    mount_pane({ data: mock_phase_data, wrapper: wrapper_div, png_dpi })

    get_button(`PNG`).click()

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
  ])(`$copy_title button copies content`, async ({ copy_title, expected_clipboard }) => {
    mount_pane({ data: mock_phase_data, wrapper: wrapper_div })
    get_button(copy_title).click()
    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expected_clipboard)
    })
  })

  test(`JSON buttons disabled and copy is a no-op when data is undefined`, async () => {
    mount_pane({ data: undefined, wrapper: wrapper_div })

    const copy_btn = get_button(`Copy JSON`)
    expect(get_button(`Download JSON`).disabled).toBe(true)
    expect(copy_btn.disabled).toBe(true)

    vi.mocked(navigator.clipboard.writeText).mockClear()
    copy_btn.click()
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  test(`DPI input has correct attributes`, () => {
    mount_pane({ data: mock_phase_data, wrapper: wrapper_div, png_dpi: 150 })

    const dpi_input = doc_query<HTMLInputElement>(
      `input[type="number"][title*="dots per inch"]`,
    )
    expect(dpi_input.value).toBe(`150`)
    expect(dpi_input.min).toBe(`50`)
    expect(dpi_input.max).toBe(`600`)
  })

  test.each([
    { export_pane_open: false, title: `Export phase diagram` },
    { export_pane_open: true, title: `` },
  ])(`toggle title is "$title" when open=$export_pane_open`, ({ export_pane_open, title }) => {
    mount_pane({ export_pane_open })

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

      mount_pane({ data: mock_phase_data, wrapper: empty_wrapper })

      get_button(button_title).click()

      // Flush microtasks then verify export/clipboard was not called
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      expect(was_called()).not.toHaveBeenCalled()
    },
  )

  test(`JSON download creates blob URL and triggers download`, async () => {
    const { create, revoke } = mock_object_url()
    mount_pane({ data: mock_phase_data, wrapper: wrapper_div })
    const download_btn = get_button(`Download JSON`)
    expect(download_btn.disabled).toBe(false)
    download_btn.click()
    await vi.waitFor(() => {
      expect(create).toHaveBeenCalledWith(expect.any(Blob))
      expect(revoke).toHaveBeenCalledWith(`blob:test-url`)
    })
  })
})
