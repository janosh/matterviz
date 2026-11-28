import FilePicker from '#lib/FilePicker.svelte'
import type { FileInfo } from '#lib/io/index'
import { DEFAULT_FILE_TYPE_PAINTS, file_type_paint } from '#lib/io/file-type-paint'
import { color as d3_color, rgb as d3_rgb } from 'd3-color'
import { type ComponentProps, flushSync, mount, unmount } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { describe, expect, it, vi } from 'vite-plus/test'
import { doc_query } from './setup'

describe(`FilePicker`, () => {
  const mount_picker = (props: ComponentProps<typeof FilePicker>) =>
    mount(FilePicker, { target: document.body, props })
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
    // one name in two directories (two runs' vasprun.xml), or several non-fetchable entries
    // sharing url ``, must not collide as each-block keys
    [
      `same-named files from different directories`,
      [`run1`, `run2`].map((dir) => ({ name: `vasprun.xml`, url: `/${dir}/vasprun.xml` })),
      2,
    ],
    [`entries without a url`, [`A-B.json`, `C-D.json`].map((name) => ({ name, url: `` })), 2],
  ])(`renders %s`, (_desc, files: FileInfo[], expected_children: number) => {
    mount_picker({ files })
    expect(doc_query(`.file-picker`).children).toHaveLength(expected_children)
  })

  it.each([
    [[`structure1.cif`, `molecule.xyz`], 2],
    [[], 0],
  ])(`marks active_files=%j with .active and aria-current`, (active_files, expected) => {
    mount_picker({ files: mock_files, active_files })
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
  // with the grey fallback paint. An explicit FileInfo.type beats the extension.
  const grey = `rgba(128, 128, 128, 0.2)`
  it.each([
    [`compressed.cif.gz`, `CIF`, `rgba(100, 149, 237, 0.2)`],
    [`data.json.gz`, `JSON`, `rgba(138, 43, 226, 0.2)`],
    [`x.tar.xz`, `TAR`, grey],
    [`traj.h5.gz.zip`, `H5`, grey],
    [`file.name.with.dots.xyz`, `XYZ`, `rgba(50, 205, 50, 0.2)`],
    [`POSCAR`, `POSCAR`, `rgba(255, 140, 0, 0.2)`],
    [`CONTCAR.bz2`, `CONTCAR`, grey],
    [`INCAR`, `INCAR`, `rgba(1, 2, 3, 0.2)`],
    [`README`, `README`, grey],
    [`edge case`, `EDGE CASE`, grey],
    [``, `FILE`, grey],
    [`foo.custom`, `XYZ`, `rgba(50, 205, 50, 0.2)`, `xyz`],
  ])(
    `infers the type of %j as %s painted %s`,
    (name, expected_type, expected_row_bg, type?) => {
      const file_type_paints = {
        ...DEFAULT_FILE_TYPE_PAINTS,
        incar: file_type_paint(`rgb(1, 2, 3)`),
      }
      mount_picker({ files: [{ name, url: ``, type }], file_type_paints })
      expect(doc_query(`.file-item`).title).toBe(`Drag this ${expected_type} file`)
      const item = doc_query(`.file-item`)
      expect(item.style.backgroundColor).toBe(expected_row_bg)
      // the border carries the full badge color (alpha included), the row only a wash of it
      const border = d3_color(item.style.getPropertyValue(`--file-type-color`))
      expect([border?.formatHex(), border?.opacity]).toEqual([
        d3_color(expected_row_bg)?.formatHex(),
        name === `INCAR` ? 1 : 0.8,
      ])
    },
  )

  // A filter with a single option could not narrow the list, so it is not offered
  const two_cifs = (category_b: `crystal` | `molecule`) => [
    mock_file(`a.cif`, `crystal`),
    mock_file(`b.cif`, category_b),
  ]
  it.each([
    [`a single type`, false, two_cifs(`molecule`), []],
    [`a single category`, true, two_cifs(`crystal`), []],
    [`a single type but two categories`, true, two_cifs(`molecule`), [`crystal`, `molecule`]],
  ])(`offers only narrowing filters for %s`, (_desc, show_cats, files, expected_labels) => {
    mount_picker({ files, show_category_filters: show_cats })
    const labels = [...document.querySelectorAll(`button.legend-item`)].map((btn) =>
      btn.textContent?.trim(),
    )
    expect(labels).toEqual(expected_labels)
    if (expected_labels.length === 0) expect(document.querySelector(`.legend`)).toBeNull()
    expect(document.querySelectorAll(`.divider, .format-circle`)).toHaveLength(0)
    expect(file_items()).toHaveLength(2)
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
    const component = mount_picker({
      files: labeled,
      get file_type_paints() {
        return Object.fromEntries(paints)
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
    expect(doc_query(`.file-item`).style.backgroundColor).toBe(`rgba(79, 195, 247, 0.2)`)

    paints.set(`chgcar`, file_type_paint(`#000000`))
    flushSync()

    expect(d3_color(badges[0].style.backgroundColor)?.formatRgb()).toBe(`rgb(0, 0, 0)`)
    expect(badges[0].style.color).toBe(`white`)
    void unmount(component)
  })

  it.each([
    [`#4fc3f7`, `rgba(79, 195, 247, 0.2)`],
    [`rgb(79, 195, 247)`, `rgba(79, 195, 247, 0.2)`],
    [`rgba(79, 195, 247, 0.8)`, `rgba(79, 195, 247, 0.2)`],
    [`red`, `rgba(255, 0, 0, 0.2)`],
    [`hsl(120, 100%, 50%)`, `rgba(0, 255, 0, 0.2)`],
    [`rgb(79 195 247)`, `rgba(79, 195, 247, 0.2)`],
  ])(`file_type_paint(%s) fades the row to %s`, (badge, expected_item) => {
    expect(file_type_paint(badge)).toEqual({ badge, item: expected_item })
  })
  // file types the demo pages list side by side: their row borders (badge color over the page)
  // must differ clearly. Before, PDB, MMCIF and LAMMPS rows all fell back to one grey
  it.each([
    [`cif`, `mmcif`, `pdb`, `xyz`, `poscar`, `json`, `yaml`, `lmp`],
    [`hdf5`, `json`, `traj`, `xdatcar`, `xyz`],
    [`chgcar`, `parchg`, `locpot`, `elfcar`, `cube`],
    [`json`, `tdb`],
  ])(`borders of co-listed types %s, ... stay OKLab distance >= 10 apart`, (...types) => {
    const to_linear = (val: number) =>
      (val /= 255) <= 0.04045 ? val / 12.92 : ((val + 0.055) / 1.055) ** 2.4
    const oklab = (type: string, backdrop: number[]) => {
      // composite the badge over the page, then sRGB -> linear -> OKLab
      const { r, g, b, opacity } = d3_rgb(DEFAULT_FILE_TYPE_PAINTS[type].badge)
      const [lr, lg, lb] = [r, g, b].map((val, idx) =>
        to_linear(val * opacity + backdrop[idx] * (1 - opacity)),
      )
      const [lms_l, lms_m, lms_s] = [
        [0.4122214708, 0.5363325363, 0.0514459929],
        [0.2119034982, 0.6806995451, 0.1073969566],
        [0.0883024619, 0.2817188376, 0.6299787005],
      ].map(([wr, wg, wb]) => Math.cbrt(wr * lr + wg * lg + wb * lb))
      return [
        0.2104542553 * lms_l + 0.793617785 * lms_m - 0.0040720468 * lms_s,
        1.9779984951 * lms_l - 2.428592205 * lms_m + 0.4505937099 * lms_s,
        0.0259040371 * lms_l + 0.7827717662 * lms_m - 0.808675766 * lms_s,
      ]
    }
    for (const backdrop of [
      [24, 23, 28],
      [255, 255, 255],
    ]) {
      for (const [idx, type_a] of types.entries()) {
        for (const type_b of types.slice(idx + 1)) {
          const [lab_a, lab_b] = [oklab(type_a, backdrop), oklab(type_b, backdrop)]
          const dist = 100 * Math.hypot(...lab_a.map((val, dim) => val - lab_b[dim]))
          expect(dist, `${type_a}/${type_b} on rgb(${backdrop})`).toBeGreaterThanOrEqual(10)
        }
      }
    }
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
      { badge: `var(--file-badge)`, item: `rgba(0, 0, 0, 0.2)` },
      `--file-badge`,
    ],
  ])(`recomputes contrast for %s`, async (_desc, paint, token) => {
    const component = mount_picker({
      // a second type, else the lone type's badge hides
      files: [
        { name: `Si`, url: `/files/Si`, type: `chgcar`, label: `Si diamond` },
        { name: `Ge`, url: `/files/Ge`, type: `cif`, label: `Ge` },
      ],
      file_type_paints: { chgcar: paint, cif: paint },
      style: `${token}: black`,
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
        name: `file-${idx}.${idx % 2 ? `cif` : `xyz`}`, // mixed types, so badges show
        url: `/files/${idx}`,
        label: `File ${idx}`,
      }))
      const component = mount_picker({ files })
      flushSync()
      expect(document.querySelectorAll(`.file-type-badge`)).toHaveLength(n_files)
      const n_observers = new Set(observe_spy.mock.contexts).size
      observe_spy.mockRestore()
      void unmount(component)
      return n_observers
    }
    // every theme watcher shares one observer, so the count must not scale with badges
    expect(count_observers(5)).toBe(1)
    expect(count_observers(20)).toBe(1)
  })

  // A badge repeating the one type every file shares is noise: badges show only beside others
  it.each([
    [[`yaml`, `yaml`], 0],
    [[`yaml`, `json`], 2],
  ])(`labeled files of types %j show %i type badges`, (types, n_badges) => {
    const files = types.map((type, idx) => ({
      name: `f${idx}`,
      url: ``,
      type,
      label: `F${idx}`,
    }))
    mount_picker({ files })
    expect(document.querySelectorAll(`.file-type-badge`)).toHaveLength(n_badges)
  })

  // Labels render through FormulaText (its cases are in composition/FormulaText.test.ts)
  it.each([
    [`SO4^2- ions`, `SO<sub>4</sub><sup>2-</sup> ions`],
    [`mp-1234.json`, `mp-1234.json`],
  ])(`renders %s as %s`, (label, html) => {
    mount_picker({ files: [{ name: `x`, url: ``, label }] })
    const markup = doc_query(`.file-name`).innerHTML.replaceAll(
      /<!--[^>]*-->| class="[^"]*"/g,
      ``,
    )
    expect(markup).toBe(html)
  })

  // A draggable chip can't be text-selected, so pressing on its name pauses the drag until the
  // pointer lifts, and a click ending a selection in the chip doesn't load the file
  it(`lets chip names be selected without loading the file`, () => {
    const on_click = vi.fn()
    mount_picker({ files: [mock_file(`structure1.cif`), mock_file(`molecule.xyz`)], on_click })
    const [chip, other_chip] = file_items()
    const name = doc_query(`.file-name`)
    name.dispatchEvent(new PointerEvent(`pointerdown`, { bubbles: true }))
    // every chip, so a selection can run on into the next one
    expect([chip.draggable, other_chip.draggable]).toEqual([false, false])
    getSelection()?.selectAllChildren(name)
    chip.click()
    expect(on_click).not.toHaveBeenCalled()
    window.dispatchEvent(new PointerEvent(`pointerup`))
    expect([chip.draggable, other_chip.draggable]).toEqual([true, true])
    getSelection()?.removeAllRanges()
    chip.click()
    expect(on_click).toHaveBeenCalledOnce()
    // a touch scroll cancels the press rather than lifting it
    name.dispatchEvent(new PointerEvent(`pointerdown`, { bubbles: true }))
    window.dispatchEvent(new PointerEvent(`pointercancel`))
    expect([chip.draggable, other_chip.draggable]).toEqual([true, true])
  })

  const formats = [`CIF`, `XYZ`, `JSON`, `TRAJ`, `DAT`, `POSCAR_FILE`]
  it.each([
    [true, [`crystal`, `molecule`, `unknown`, ...formats], 1],
    [false, formats, 0],
  ])(
    `show_category_filters=%s lists %j in the legend as unpressed buttons`,
    (show_category_filters, expected_labels, n_dividers) => {
      mount_picker({ files: mock_files, show_category_filters })
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
    mount_picker({ files: mock_files, show_category_filters: true })
    const click = (element: HTMLElement) => {
      element.click()
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
    mount_picker(props)
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
    mount_picker({ files: mock_files.slice(0, 2), on_click, on_drag_start })
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
