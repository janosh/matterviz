import { type FileInfo, FilePicker, file_type_paint } from '$lib'
import { color as d3_color } from 'd3-color'
import { flushSync, mount, unmount } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { doc_query } from './setup'

describe(`FilePicker`, () => {
  afterEach(() => vi.useRealTimers())

  // Mock file data for testing
  const create_mock_file = (
    name: string,
    url: string,
    category?: `crystal` | `molecule` | `unknown`,
  ): FileInfo => {
    // Extract the correct file type, handling double extensions like .cif.gz
    let base_name = name
    if (base_name.toLowerCase().endsWith(`.gz`)) base_name = base_name.slice(0, -3)

    const type = base_name.split(`.`).pop()?.toUpperCase() ?? `FILE`

    return { name, url, type, category }
  }

  const mock_files: FileInfo[] = [
    create_mock_file(`structure1.cif`, `/files/structure1.cif`, `crystal`),
    create_mock_file(`molecule.xyz`, `/files/molecule.xyz`, `molecule`),
    create_mock_file(`data.json`, `/files/data.json`, `crystal`),
    create_mock_file(`compressed.cif.gz`, `/files/compressed.cif.gz`, `crystal`),
    create_mock_file(`trajectory.traj`, `/files/trajectory.traj`, `crystal`),
    create_mock_file(`unknown.dat`, `/files/unknown.dat`, `unknown`),
    create_mock_file(`poscar_file`, `/files/poscar_file`, `crystal`),
  ]

  describe(`rendering and basic functionality`, () => {
    it.each([
      [`only the legend when there are no files`, [], 1],
      [`one row per file plus the legend`, mock_files, mock_files.length + 1],
    ])(`renders %s`, (_desc, files: FileInfo[], expected_children: number) => {
      mount(FilePicker, { target: document.body, props: { files } })
      expect(doc_query(`.file-picker`).children).toHaveLength(expected_children)
    })

    it.each([
      [`the named files`, [`structure1.cif`, `molecule.xyz`], 2],
      [`nothing for an empty list`, [], 0],
    ])(`marks active %s`, (_desc, active_files: string[], expected_active: number) => {
      mount(FilePicker, { target: document.body, props: { files: mock_files, active_files } })
      expect(document.querySelectorAll(`.file-item.active`)).toHaveLength(expected_active)
    })

    it(`shows and updates contrasting file type badges only when labels are set`, () => {
      const labeled: FileInfo[] = [
        { name: `Si-CHGCAR.gz`, url: `/files/Si`, type: `chgcar`, label: `Si diamond` },
        { name: `structure.cif`, url: `/files/cif`, type: `cif`, label: `Crystal` },
        { name: `molecule.xyz`, url: `/files/xyz`, type: `xyz` },
      ]
      const paints = new SvelteMap([
        [`chgcar`, file_type_paint(`#4fc3f7`)],
        [`cif`, file_type_paint(`#111111`)],
      ])
      const component = mount(FilePicker, {
        target: document.body,
        props: {
          files: labeled,
          get file_type_paints() {
            return Object.fromEntries(paints)
          },
        },
      })
      flushSync()
      const badges = document.querySelectorAll<HTMLElement>(`.file-type-badge`)
      expect([...badges].map((badge) => [badge.textContent, badge.style.color])).toEqual([
        [`CHGCAR`, `black`],
        [`CIF`, `white`],
      ])
      expect(d3_color(badges[0].style.backgroundColor)?.formatRgb()).toBe(`rgb(79, 195, 247)`)
      // row wash is a faded badge color. The old alpha-by-string-replace left non-rgba
      // spellings at full strength, painting the row the same color as its badge.
      expect(doc_query(`.file-item`).style.backgroundColor).toBe(`rgba(79, 195, 247, 0.08)`)

      paints.set(`chgcar`, file_type_paint(`#000000`))
      flushSync()

      expect(d3_color(badges[0].style.backgroundColor)?.formatRgb()).toBe(`rgb(0, 0, 0)`)
      expect(badges[0].style.color).toBe(`white`)
      void unmount(component)
    })

    it.each([
      [`#4fc3f7`, `rgba(79, 195, 247, 0.08)`],
      [`rgb(79, 195, 247)`, `rgba(79, 195, 247, 0.08)`],
      [`rgba(79, 195, 247, 0.8)`, `rgba(79, 195, 247, 0.08)`],
      [`red`, `rgba(255, 0, 0, 0.08)`],
      [`hsl(120, 100%, 50%)`, `rgba(0, 255, 0, 0.08)`],
      [`rgb(79 195 247)`, `rgba(79, 195, 247, 0.08)`],
    ])(`file_type_paint(%s) fades the row to %s`, (badge, expected_item) => {
      expect(file_type_paint(badge)).toEqual({ badge, item: expected_item })
    })
    it(`file_type_paint rejects unresolved colors`, () => {
      expect(() => file_type_paint(`var(--file-badge)`)).toThrow(
        `Cannot derive file row paint from unsupported color`,
      )
    })

    it.each([
      [
        `translucent badge after backdrop change`,
        file_type_paint(`rgba(255, 255, 255, 0.1)`),
        `--page-bg`,
      ],
      [
        `CSS-variable badge after token change`,
        { badge: `var(--file-badge)`, item: `rgba(0, 0, 0, 0.08)` },
        `--file-badge`,
      ],
    ])(`recomputes contrast for %s`, async (_desc, paint, token) => {
      const component = mount(FilePicker, {
        target: document.body,
        props: {
          files: [{ name: `Si`, url: `/files/Si`, type: `chgcar`, label: `Si diamond` }],
          file_type_paints: { chgcar: paint },
          style: `${token}: black`,
        },
      })
      flushSync()
      const picker = doc_query(`.file-picker`)
      const badge = doc_query(`.file-type-badge`)
      expect(badge.style.color).toBe(`white`)

      picker.style.setProperty(token, `white`)
      await vi.waitFor(() => expect(badge.style.color).toBe(`black`))

      void unmount(component)
    })
  })

  describe(`filtering functionality`, () => {
    const legend_text = () => doc_query(`.legend`).textContent ?? ``

    it(`lists category filters when enabled, none of them active yet`, () => {
      mount(FilePicker, {
        target: document.body,
        props: { files: mock_files, show_category_filters: true },
      })
      for (const category of [`crystal`, `molecule`, `unknown`]) {
        expect(legend_text()).toContain(category)
      }
      const items = [...document.querySelectorAll(`.legend-item`)]
      expect(items.length).toBeGreaterThan(0)
      expect(items.some((item) => item.classList.contains(`active`))).toBe(false)
    })

    it(`omits category filters by default`, () => {
      mount(FilePicker, { target: document.body, props: { files: mock_files } })
      for (const category of [`crystal`, `molecule`, `unknown`]) {
        expect(legend_text()).not.toContain(category)
      }
    })

    it(`always lists format filters, with swatches and no clear button until one is on`, () => {
      mount(FilePicker, { target: document.body, props: { files: mock_files } })
      for (const format of [`CIF`, `XYZ`, `JSON`, `TRAJ`]) {
        expect(legend_text()).toContain(format)
      }
      expect(document.querySelectorAll(`.format-circle`).length).toBeGreaterThan(0)
      expect(document.querySelectorAll(`.clear-filter`)).toHaveLength(0)
    })

    it(`toggles category/type filters on and off and keeps them mutually exclusive`, () => {
      mount(FilePicker, {
        target: document.body,
        props: { files: mock_files, show_category_filters: true },
      })
      const legend_btn = (text: string): HTMLElement => {
        const el = [...document.querySelectorAll<HTMLElement>(`.legend-item`)].find((item) =>
          item.textContent?.includes(text),
        )
        if (!el) throw new Error(`Legend item not found: ${text}`)
        return el
      }
      const click = (el: HTMLElement) => {
        el.click()
        flushSync()
      }
      const n_files = () => document.querySelectorAll(`.file-item`).length
      const crystal = legend_btn(`crystal`)
      const xyz = legend_btn(`XYZ`)

      click(crystal)
      expect(crystal.getAttribute(`aria-pressed`)).toBe(`true`)
      expect(n_files()).toBe(5)
      click(crystal)
      expect(crystal.getAttribute(`aria-pressed`)).toBe(`false`)
      expect(n_files()).toBe(mock_files.length)
      click(xyz)
      expect(xyz.classList.contains(`active`)).toBe(true)
      expect(n_files()).toBe(1)
      click(crystal)
      expect(crystal.getAttribute(`aria-pressed`)).toBe(`true`)
      expect(xyz.classList.contains(`active`)).toBe(false)
    })
  })

  describe(`UI components and accessibility`, () => {
    it.each([
      [`tabindex`, `0`, `.legend-item[role="button"]`],
      [`role`, `button`, `.legend-item[role="button"]`],
      [`draggable`, `true`, `.file-item`],
    ])(
      `sets correct %s="%s" attribute on %s`,
      (attr: string, expected_value: string, selector: string) => {
        mount(FilePicker, {
          target: document.body,
          props: { files: mock_files },
        })

        const element = doc_query(selector)
        expect(element.getAttribute(attr)).toBe(expected_value)
      },
    )
  })

  describe(`edge cases and configuration`, () => {
    // Every shape of name the type resolver has to cope with: extensionless, double
    // extension, dots in the stem, spaces, and `` (the only case with no usable `type`,
    // so the only one that reaches the name-parsing fallback and FALLBACK_FILE_TYPE_PAINT).
    it.each([
      `structure.cif`,
      `compressed.cif.gz`,
      `trajectory.traj`,
      `poscar`,
      `README`,
      `file.name.with.dots.cif`,
      ``,
      `very_long_filename_that_should_wrap_properly.cif`,
      `edge case`,
      `no_extension`,
    ])(`renders %s with a resolved row paint`, (filename: string) => {
      mount(FilePicker, {
        target: document.body,
        props: { files: [create_mock_file(filename, `content`)] },
      })
      const file_item = doc_query(`.file-item`)
      expect(file_item.textContent).toContain(filename)
      expect(file_item.style.backgroundColor).toMatch(/^rgba\(/)
    })
  })

  describe(`custom props`, () => {
    it(`delays single-click when dblclick is handled and only dblclicks the pending file`, () => {
      vi.useFakeTimers()
      const on_click = vi.fn()
      const on_dblclick = vi.fn()
      const files = mock_files.slice(0, 2)
      mount(FilePicker, {
        target: document.body,
        props: { files, on_click, on_dblclick },
      })
      const [first, second] = document.querySelectorAll<HTMLElement>(`.file-item`)
      const fire = (el: HTMLElement, type: `click` | `dblclick` = `click`) => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true }))
        flushSync()
      }
      const settle = () => {
        vi.advanceTimersByTime(250)
        flushSync()
      }

      fire(first)
      expect(on_click).not.toHaveBeenCalled()
      settle()
      expect(on_click).toHaveBeenCalledOnce()
      expect(on_click.mock.calls[0][0].name).toBe(files[0].name)

      on_click.mockClear()
      fire(first)
      fire(first, `dblclick`)
      expect(on_dblclick).toHaveBeenCalledOnce()
      expect(on_dblclick.mock.calls[0][0].name).toBe(files[0].name)
      settle()
      expect(on_click).not.toHaveBeenCalled()

      on_click.mockClear()
      on_dblclick.mockClear()
      fire(first)
      fire(second, `dblclick`) // different file → schedule as single-click
      expect(on_dblclick).not.toHaveBeenCalled()
      settle()
      expect(on_click).toHaveBeenCalledOnce()
      expect(on_click.mock.calls[0][0].name).toBe(files[1].name)

      // Orphaned dblclick (no pending click) must not invoke on_dblclick
      on_click.mockClear()
      on_dblclick.mockClear()
      fire(first, `dblclick`)
      expect(on_dblclick).not.toHaveBeenCalled()
      settle()
      expect(on_click).toHaveBeenCalledOnce()
      expect(on_click.mock.calls[0][0].name).toBe(files[0].name)
    })

    it(`uses custom type_mapper to override file type detection`, () => {
      const files = [create_mock_file(`foo.custom`, `/files/foo.custom`)]
      const type_mapper = (file: FileInfo) =>
        file.name.endsWith(`.custom`) ? `xyz` : `unknown`
      mount(FilePicker, {
        target: document.body,
        props: { files, type_mapper },
      })
      // Should use xyz color (green)
      const file_item = doc_query(`.file-item`)
      expect(file_item.style.backgroundColor).toContain(`50, 205, 50`) // green for xyz
    })
  })
})
