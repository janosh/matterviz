import { type FileInfo, FilePicker } from '$lib'
import { mount } from 'svelte'
import { describe, expect, it } from 'vitest'
import { doc_query } from './setup'

describe(`FilePicker`, () => {
  // Mock file data for testing
  const create_mock_file = (
    name: string,
    url: string,
    category: `crystal` | `molecule` | `unknown` = `crystal`,
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
      [`empty carousel`, [], 1], // Only legend
      [`all files`, mock_files, mock_files.length + 1], // Files + legend
      [
        `active files with selection`,
        [`structure1.cif`, `molecule.xyz`],
        2,
        `active`,
      ],
      [`no active files`, [], 0, `active`],
    ])(
      `renders %s correctly`,
      (
        _description: string,
        files_or_active: FileInfo[] | string[],
        expected_count: number,
        test_type?: string,
      ) => {
        const is_active_test = test_type === `active`
        const props = is_active_test
          ? { files: mock_files, active_files: files_or_active as string[] }
          : { files: files_or_active as FileInfo[] }

        mount(FilePicker, { target: document.body, props })

        const carousel = doc_query(`.file-picker`)
        expect(carousel).toBeTruthy()

        if (is_active_test) {
          const active_elements = document.querySelectorAll(`.file-item.active`)
          expect(active_elements.length).toBe(expected_count)
        } else {
          expect(carousel.children.length).toBe(expected_count)
        }
      },
    )

    it(`shows compression indicator for .gz files`, () => {
      mount(FilePicker, {
        target: document.body,
        props: { files: mock_files },
      })
      expect(doc_query(`.file-item.compressed`)).toBeTruthy()
      expect(document.body.textContent).toContain(`📦`)
    })
  })

  describe(`file type detection and inline styles`, () => {
    it.each([
      [`structure.cif`],
      [`molecule.xyz`],
      [`data.json`],
      [`compressed.cif.gz`],
      [`trajectory.traj`],
      [`poscar`],
    ])(
      `correctly identifies %s as a file type`,
      (filename: string) => {
        const test_file = create_mock_file(filename, `content`)
        mount(FilePicker, {
          target: document.body,
          props: { files: [test_file] },
        })

        // Check that the file item has the correct background color style
        const file_item = doc_query(`.file-item`)
        const background_color = file_item.style.backgroundColor
        expect(background_color).toBeTruthy()
        expect(background_color).toContain(`rgba`)
      },
    )
  })

  describe(`filtering functionality`, () => {
    it.each([
      [true, [`crystal`, `molecule`, `unknown`], `show_category_filters`],
      [false, [], `show_category_filters`],
      [true, [`CIF`, `XYZ`, `JSON`, `TRAJ`], `format_filters`],
    ])(
      `shows filters correctly when enabled=%s`,
      (
        show_filters: boolean,
        expected_filters: string[],
        test_key: string,
      ) => {
        const props = test_key === `show_category_filters`
          ? { files: mock_files, show_category_filters: show_filters }
          : { files: mock_files }

        mount(FilePicker, { target: document.body, props })

        const legend_text = doc_query(`.legend`).textContent || ``
        expected_filters.forEach((filter) => {
          if (show_filters) {
            expect(legend_text).toContain(filter)
          } else if (test_key === `show_category_filters`) {
            expect(legend_text).not.toContain(filter)
          }
        })

        if (show_filters) {
          const filter_items = document.querySelectorAll(`.legend-item`)
          expect(filter_items.length).toBeGreaterThan(0)
          filter_items.forEach((item) => {
            expect(item.classList.contains(`active`)).toBe(false)
          })
        }
      },
    )

    it(`normalizes trajectory file types to TRAJ`, () => {
      const traj_files = [
        create_mock_file(`file.traj`, `content`),
        create_mock_file(`file_traj.xyz`, `content`),
        create_mock_file(`XDATCAR`, `content`),
      ]

      mount(FilePicker, {
        target: document.body,
        props: { files: traj_files },
      })

      const traj_filter = Array.from(
        document.querySelectorAll(`.legend-item`),
      ).find((el) => el.textContent?.includes(`TRAJ`))
      expect(traj_filter).toBeTruthy()
      expect(document.querySelectorAll(`.file-item`)).toHaveLength(3)
    })
  })

  describe(`UI components and accessibility`, () => {
    it.each([
      [`.clear-filter`, false, `clear filter button`],
      [`.legend-item`, true, `filter items`],
      [`.format-circle`, true, `format color circles`],
    ])(
      `renders %s (%s) correctly`,
      (selector: string, should_exist: boolean, _description: string) => {
        mount(FilePicker, {
          target: document.body,
          props: { files: mock_files },
        })

        const elements = document.querySelectorAll(selector)
        if (should_exist) {
          expect(elements.length).toBeGreaterThan(0)
        } else {
          expect(elements.length).toBe(0)
        }
      },
    )

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

    it.each([
      [true, `crystal`, `crystal`],
      [true, `molecule`, `molecule`],
      [false, `crystal`, `crystal`],
    ])(
      `shows category names %s correctly`,
      (
        show_categories: boolean,
        category: string,
        expected_text: string,
      ) => {
        const test_files = [
          create_mock_file(
            `test.cif`,
            `content`,
            category as `crystal` | `molecule` | `unknown`,
          ),
        ]
        mount(FilePicker, {
          target: document.body,
          props: {
            files: test_files,
            show_category_filters: show_categories,
          },
        })

        if (show_categories) {
          expect(document.body.textContent).toContain(expected_text)
        } else {
          // When show_category_filters is false, categories should not appear in the legend
          const legend = doc_query(`.legend`)
          expect(legend.textContent).not.toContain(expected_text)
        }
      },
    )
  })

  describe(`edge cases and configuration`, () => {
    it.each([
      [`README`],
      [`file.name.with.dots.cif`],
      [``],
      [`very_long_filename_that_should_wrap_properly.cif`],
      [`edge case`],
      [`no_extension`],
    ])(
      `handles %s gracefully`,
      (filename: string) => {
        const test_file = create_mock_file(filename, `content`)
        mount(FilePicker, {
          target: document.body,
          props: { files: [test_file] },
        })

        const file_item = doc_query(`.file-item`)
        expect(file_item).toBeTruthy()
        expect(file_item.textContent).toContain(filename)
      },
    )

    it(`handles minimal props correctly`, () => {
      mount(FilePicker, {
        target: document.body,
        props: { files: [] },
      })

      const carousel = doc_query(`.file-picker`)
      expect(carousel).toBeTruthy()
      expect(carousel.children.length).toBe(1) // Only legend
    })

    it(`handles with empty active_files correctly`, () => {
      mount(FilePicker, {
        target: document.body,
        props: { files: mock_files, active_files: [] },
      })

      const active_elements = document.querySelectorAll(`.file-item.active`)
      expect(active_elements.length).toBe(0)
    })

    it(`handles with show_category_filters disabled correctly`, () => {
      mount(FilePicker, {
        target: document.body,
        props: { files: mock_files, show_category_filters: false },
      })

      const legend = doc_query(`.legend`)
      expect(legend.textContent).not.toContain(`crystal`)
      expect(legend.textContent).not.toContain(`molecule`)
    })
  })

  describe(`custom props`, () => {
    it(`uses custom type_mapper to override file type detection`, () => {
      const files = [create_mock_file(`foo.custom`, `/files/foo.custom`)]
      const type_mapper = (filename: string) =>
        filename.endsWith(`.custom`) ? `xyz` : `unknown`
      mount(FilePicker, {
        target: document.body,
        props: { files, type_mapper },
      })
      // Should use xyz color (green)
      const file_item = doc_query(`.file-item`)
      expect(file_item.style.backgroundColor).toContain(`50, 205, 50`) // green for xyz
    })

    it(`uses custom file_type_colors for file background`, () => {
      const files = [create_mock_file(`foo.xyz`, `/files/foo.xyz`)]
      const file_type_colors = { xyz: `rgba(1, 2, 3, 0.8)` }
      mount(FilePicker, {
        target: document.body,
        props: { files, file_type_colors },
      })
      const file_item = doc_query(`.file-item`)
      expect(file_item.style.backgroundColor).toContain(`1, 2, 3`)
    })
  })
})
