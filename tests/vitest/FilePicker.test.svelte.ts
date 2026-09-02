import { DEFAULT_FILE_TYPE_PAINTS, type FileInfo, FilePicker, file_type_paint } from '$lib'
import { color as d3_color } from 'd3-color'
import { flushSync, mount, unmount } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { describe, expect, it, vi } from 'vitest'
import { doc_query } from './setup'

describe(`FilePicker`, () => {
  const mock_file = (
    name: string,
    category?: `crystal` | `molecule` | `unknown`,
  ): FileInfo => ({
    name,
    url: `/files/${name}`,
    type: name.replace(/\.gz$/, ``).split(`.`).pop()?.toUpperCase(),
    category,
  })

  const mock_files: FileInfo[] = [
    mock_file(`structure1.cif`, `crystal`),
    mock_file(`molecule.xyz`, `molecule`),
    mock_file(`data.json`, `crystal`),
    mock_file(`compressed.cif.gz`, `crystal`),
    mock_file(`trajectory.traj`, `crystal`),
    mock_file(`unknown.dat`, `unknown`),
    mock_file(`poscar_file`, `crystal`),
  ]
  const legend_text = () => doc_query(`.legend`).textContent ?? ``
  const legend_btn = (text: string): HTMLButtonElement => {
    const btn = [...document.querySelectorAll<HTMLButtonElement>(`button.legend-item`)].find(
      (item) => item.textContent?.includes(text),
    )
    if (!btn) throw new Error(`Legend item not found: ${text}`)
    return btn
  }
  const file_items = () => [...document.querySelectorAll<HTMLElement>(`.file-item`)]

  it.each([
    [`nothing when there are no files`, [], 0],
    [`one row per file plus the legend`, mock_files, mock_files.length + 1],
  ])(`renders %s`, (_desc, files: FileInfo[], expected_children: number) => {
    mount(FilePicker, { target: document.body, props: { files } })
    expect(doc_query(`.file-picker`).children).toHaveLength(expected_children)
  })

  it.each([
    [[`structure1.cif`, `molecule.xyz`], 2],
    [[], 0],
  ])(`marks active_files=%j with .active and aria-current`, (active_files, expected) => {
    mount(FilePicker, { target: document.body, props: { files: mock_files, active_files } })
    const active = file_items().filter((item) => item.classList.contains(`active`))
    expect(active).toHaveLength(expected)
    expect(
      file_items().filter((item) => item.getAttribute(`aria-current`) === `true`),
    ).toEqual(active)
  })

  // Type inference from the name when `type` is absent: every compression suffix is ignored,
  // only the last remaining extension counts, extensionless names (VASP inputs) are typed by
  // their lowercased name so they hit the lowercase paint keys (`poscar` is orange out of the
  // box, a caller-supplied `incar` paint is honoured), and an empty name falls back to `file`
  // with the grey fallback paint.
  const grey = `rgba(128, 128, 128, 0.08)`
  it.each([
    [`compressed.cif.gz`, `CIF`, `rgba(100, 149, 237, 0.08)`],
    [`data.json.gz`, `JSON`, `rgba(138, 43, 226, 0.08)`],
    [`x.tar.xz`, `TAR`, grey],
    [`traj.h5.gz.zip`, `H5`, grey],
    [`file.name.with.dots.xyz`, `XYZ`, `rgba(50, 205, 50, 0.08)`],
    [`POSCAR`, `POSCAR`, `rgba(255, 140, 0, 0.08)`],
    [`CONTCAR.bz2`, `CONTCAR`, grey],
    [`INCAR`, `INCAR`, `rgba(1, 2, 3, 0.08)`],
    [`README`, `README`, grey],
    [`edge case`, `EDGE CASE`, grey],
    [``, `FILE`, grey],
  ])(`infers the type of %j as %s painted %s`, (name, expected_type, expected_row_bg) => {
    const file_type_paints = {
      ...DEFAULT_FILE_TYPE_PAINTS,
      incar: file_type_paint(`rgb(1, 2, 3)`),
    }
    mount(FilePicker, {
      target: document.body,
      props: { files: [{ name, url: `` }], file_type_paints },
    })
    expect(doc_query(`.file-item`).title).toBe(`Drag this ${expected_type} file`)
    expect(doc_query(`.file-item`).style.backgroundColor).toBe(expected_row_bg)
  })

  it(`renders the chip from an explicit FileInfo.type over the extension`, () => {
    const files = [{ ...mock_file(`foo.custom`), type: `xyz` }]
    mount(FilePicker, { target: document.body, props: { files } })
    expect(doc_query(`.file-item`).title).toBe(`Drag this XYZ file`)
    expect(doc_query(`.file-item`).style.backgroundColor).toContain(`50, 205, 50`) // xyz green
  })

  it.each([
    [`a single type`, false, [mock_file(`a.cif`, `crystal`), mock_file(`b.cif`, `molecule`)]],
    [
      `a single category`,
      true,
      [mock_file(`a.cif`, `crystal`), mock_file(`b.cif`, `crystal`)],
    ],
  ])(
    `offers no filter for %s since it could not narrow the list`,
    (_desc, show_cats, files) => {
      mount(FilePicker, {
        target: document.body,
        props: { files, show_category_filters: show_cats },
      })
      expect(document.querySelector(`.legend`)).toBeNull()
      expect(file_items()).toHaveLength(2)
    },
  )

  it(`hides the type filters but keeps the category filters when only categories differ`, () => {
    const files = [mock_file(`a.cif`, `crystal`), mock_file(`b.cif`, `molecule`)]
    mount(FilePicker, {
      target: document.body,
      props: { files, show_category_filters: true },
    })
    expect(
      [...document.querySelectorAll(`button.legend-item`)].map((btn) =>
        btn.textContent?.trim(),
      ),
    ).toEqual([`crystal`, `molecule`])
    expect(document.querySelectorAll(`.divider, .format-circle`)).toHaveLength(0)
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

  it(`watches the DOM once per picker, not once per badge`, () => {
    // happy-dom rejects a spied constructor, so count distinct observers via observe()
    const count_observers = (n_files: number): number => {
      const observe_spy = vi.spyOn(MutationObserver.prototype, `observe`)
      const files = Array.from({ length: n_files }, (_, idx) => ({
        name: `file-${idx}.cif`,
        url: `/files/${idx}`,
        label: `File ${idx}`,
      }))
      const component = mount(FilePicker, { target: document.body, props: { files } })
      flushSync()
      expect(document.querySelectorAll(`.file-type-badge`)).toHaveLength(n_files)
      const n_observers = new Set(observe_spy.mock.contexts).size
      observe_spy.mockRestore()
      void unmount(component)
      return n_observers
    }
    // One ancestor-attribute observer each for the backdrop token and the shared
    // badge-contrast epoch; the count must not scale with the badge count
    expect(count_observers(5)).toBe(2)
    expect(count_observers(20)).toBe(2)
  })

  const formats = [`CIF`, `XYZ`, `JSON`, `TRAJ`, `DAT`, `POSCAR_FILE`]
  it.each([
    [true, [`crystal`, `molecule`, `unknown`, ...formats], 1],
    [false, formats, 0],
  ])(
    `show_category_filters=%s lists %j in the legend as unpressed buttons`,
    (show_category_filters, expected_labels, n_dividers) => {
      mount(FilePicker, {
        target: document.body,
        props: { files: mock_files, show_category_filters },
      })
      for (const label of expected_labels) expect(legend_text()).toContain(label)
      if (!show_category_filters) expect(legend_text()).not.toContain(`crystal`)
      const buttons = document.querySelectorAll(`button.legend-item`)
      expect(buttons).toHaveLength(expected_labels.length)
      expect([...buttons].every((btn) => btn.getAttribute(`aria-pressed`) === `false`)).toBe(
        true,
      )
      expect(document.querySelectorAll(`.divider`)).toHaveLength(n_dividers)
      expect(document.querySelectorAll(`.format-circle`)).toHaveLength(formats.length)
      expect(document.querySelector(`.clear-filter`)).toBeNull()
    },
  )

  it(`toggles category/type filters, keeps them mutually exclusive, and clears them`, () => {
    mount(FilePicker, {
      target: document.body,
      props: { files: mock_files, show_category_filters: true },
    })
    const click = (el: HTMLElement) => {
      el.click()
      flushSync()
    }
    const crystal = legend_btn(`crystal`)
    const xyz = legend_btn(`XYZ`)

    click(crystal)
    expect(crystal.getAttribute(`aria-pressed`)).toBe(`true`)
    expect(file_items()).toHaveLength(5)
    click(crystal)
    expect(crystal.getAttribute(`aria-pressed`)).toBe(`false`)
    expect(file_items()).toHaveLength(mock_files.length)
    click(xyz)
    expect(xyz.classList.contains(`active`)).toBe(true)
    expect(file_items().map((item) => item.textContent?.trim())).toEqual([`molecule.xyz`])
    click(crystal)
    expect(crystal.getAttribute(`aria-pressed`)).toBe(`true`)
    expect(xyz.getAttribute(`aria-pressed`)).toBe(`false`)
    expect(file_items()).toHaveLength(5)

    click(doc_query<HTMLButtonElement>(`.clear-filter`))
    expect(file_items()).toHaveLength(mock_files.length)
    expect(document.querySelector(`.clear-filter`)).toBeNull()
  })

  // A files swap can retire the active filter's value, hiding every file with no way back
  it(`drops a filter whose value the new files no longer offer`, () => {
    const props = $state({ files: mock_files, show_category_filters: true })
    mount(FilePicker, { target: document.body, props })
    legend_btn(`XYZ`).click()
    flushSync()
    expect(file_items().map((item) => item.textContent?.trim())).toEqual([`molecule.xyz`])

    props.files = [mock_file(`a.cif`, `crystal`), mock_file(`b.json`, `crystal`)]
    flushSync()
    expect(file_items()).toHaveLength(2)
    expect(document.querySelector(`.clear-filter`)).toBeNull()
  })

  it(`file rows are draggable keyboard buttons that fire on_click on click, Enter and Space`, () => {
    const on_click = vi.fn()
    const on_drag_start = vi.fn()
    mount(FilePicker, {
      target: document.body,
      props: { files: mock_files.slice(0, 2), on_click, on_drag_start },
    })
    const [first, second] = file_items()
    expect(first.getAttribute(`role`)).toBe(`button`)
    expect(first.tabIndex).toBe(0)
    expect(first.getAttribute(`draggable`)).toBe(`true`)
    expect(first.title).toContain(`Click to load`)

    first.click()
    second.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
    first.dispatchEvent(new KeyboardEvent(`keydown`, { key: ` `, bubbles: true }))
    first.dispatchEvent(new KeyboardEvent(`keydown`, { key: `a`, bubbles: true }))
    expect(on_click.mock.calls.map(([file]) => file.name)).toEqual([
      `structure1.cif`,
      `molecule.xyz`,
      `structure1.cif`,
    ])

    const data = new Map<string, string>()
    const drag_event = new Event(`dragstart`, { bubbles: true }) as DragEvent
    Object.defineProperty(drag_event, `dataTransfer`, {
      value: { setData: (kind: string, payload: string) => data.set(kind, payload) },
    })
    first.dispatchEvent(drag_event)
    expect(on_drag_start).toHaveBeenCalledWith(mock_files[0], drag_event)
    expect(data.get(`text/plain`)).toBe(`/files/structure1.cif`)
    expect(JSON.parse(data.get(`application/json`) ?? ``)).toEqual({
      name: `structure1.cif`,
      url: `/files/structure1.cif`,
      type: `cif`,
      category: `crystal`,
    })
  })
})
