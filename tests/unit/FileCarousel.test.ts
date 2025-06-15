import type { FileInfo } from '$site'
import { FileCarousel } from '$site'
import { mount } from 'svelte'
import { beforeEach, describe, expect, it } from 'vitest'
import { doc_query } from './index'

describe(`FileCarousel`, () => {
  // Mock file data for testing
  const create_mock_file = (
    name: string,
    content: string,
    structure_type: `crystal` | `molecule` | `unknown` = `crystal`,
  ): FileInfo => {
    // Extract the correct file type, handling double extensions like .cif.gz
    let base_name = name
    if (base_name.toLowerCase().endsWith(`.gz`)) {
      base_name = base_name.slice(0, -3)
    }

    const type = base_name.split(`.`).pop()?.toUpperCase() ?? `FILE`

    return { name, content, formatted_name: name, type, structure_type }
  }

  const mock_files: FileInfo[] = [
    create_mock_file(`structure1.cif`, `cif content`, `crystal`),
    create_mock_file(`molecule.xyz`, `xyz content`, `molecule`),
    create_mock_file(`data.json`, `{"key": "value"}`, `crystal`),
    create_mock_file(`compressed.cif.gz`, `compressed cif`, `crystal`),
    create_mock_file(`trajectory.traj`, `traj content`, `crystal`),
    create_mock_file(`unknown.dat`, `unknown content`, `unknown`),
    create_mock_file(`poscar_file`, `poscar content`, `crystal`),
  ]

  beforeEach(() => {
    // Clear DOM before each test
    document.body.innerHTML = ``
  })

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

        mount(FileCarousel, { target: document.body, props })

        const carousel = doc_query(`.file-carousel`)
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
      mount(FileCarousel, {
        target: document.body,
        props: { files: mock_files },
      })
      expect(doc_query(`.file-item.compressed`)).toBeTruthy()
      expect(document.body.textContent).toContain(`📦`)
    })
  })

  describe(`file type detection and CSS classes`, () => {
    it.each([
      [`structure.cif`, `.cif-file`],
      [`molecule.xyz`, `.xyz-file`],
      [`data.json`, `.json-file`],
      [`compressed.cif.gz`, `.cif-file`],
      [`trajectory.traj`, `.traj-file`],
      [`xdatcar_file`, `.traj-file`],
      [`poscar`, `.poscar-file`],
    ])(
      `correctly identifies %s as %s class`,
      (filename: string, css_class: string) => {
        const test_file = create_mock_file(filename, `content`)
        mount(FileCarousel, {
          target: document.body,
          props: { files: [test_file] },
        })
        expect(doc_query(css_class)).toBeTruthy()
      },
    )
  })

  describe(`filtering functionality`, () => {
    it.each([
      [true, [`crystal`, `molecule`, `unknown`], `show_structure_filters`],
      [false, [], `show_structure_filters`],
      [true, [`CIF`, `XYZ`, `JSON`, `TRAJ`], `format_filters`],
    ])(
      `shows filters correctly when enabled=%s`,
      (
        show_filters: boolean,
        expected_filters: string[],
        test_key: string,
      ) => {
        const props = test_key === `show_structure_filters`
          ? { files: mock_files, show_structure_filters: show_filters }
          : { files: mock_files }

        mount(FileCarousel, { target: document.body, props })

        const legend_text = doc_query(`.legend`).textContent || ``
        expected_filters.forEach((filter) => {
          if (show_filters) {
            expect(legend_text).toContain(filter)
          } else if (test_key === `show_structure_filters`) {
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

      mount(FileCarousel, {
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
      [`.cif-color`, true, `CIF color circle`],
      [`.xyz-color`, true, `XYZ color circle`],
      [`.json-color`, true, `JSON color circle`],
      [`.traj-color`, true, `TRAJ color circle`],
      [`.drag-handle`, true, `drag handle styling`],
      [`.drag-bar`, true, `drag bar styling`],
    ])(
      `renders %s (%s) correctly`,
      (selector: string, should_exist: boolean, _description: string) => {
        mount(FileCarousel, {
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
        mount(FileCarousel, {
          target: document.body,
          props: { files: mock_files },
        })

        const elements = document.querySelectorAll(selector)
        expect(elements.length).toBeGreaterThan(0)
        elements.forEach((element) => {
          expect(element.getAttribute(attr)).toBe(expected_value)
        })
      },
    )

    it.each([
      [`structure type icons`, true, [`🔷`, `🧬`, `❓`]],
      [`structure type icons hidden`, false, []],
    ])(
      `shows %s correctly`,
      (
        _description: string,
        show_structure_filters: boolean,
        expected_icons: string[],
      ) => {
        mount(FileCarousel, {
          target: document.body,
          props: { files: mock_files, show_structure_filters },
        })

        expected_icons.forEach((icon) => {
          if (show_structure_filters) {
            expect(document.body.textContent).toContain(icon)
          } else {
            expect(document.body.textContent).not.toContain(icon)
          }
        })
      },
    )
  })

  describe(`edge cases and configuration`, () => {
    it.each([
      [`README`, `content`],
      [`file.name.with.dots.cif`, `content`],
      [``, `content`],
      [`very_long_filename_that_should_wrap_properly.cif`, `content`],
    ])(
      `handles %s gracefully`,
      (filename: string, content: string) => {
        const edge_case_files = [create_mock_file(filename, content)]
        mount(FileCarousel, {
          target: document.body,
          props: { files: edge_case_files },
        })
        expect(doc_query(`.file-carousel`)).toBeTruthy()
      },
    )

    it.each([
      { structure_type: undefined, expected_text: `test.txt` }, // undefined structure_type
      { file_count: 50, expected_children: 51 }, // many files (50)
    ])(
      `handles edge case gracefully`,
      (
        test_config:
          | { structure_type: undefined; expected_text: string }
          | { file_count: number; expected_children: number },
      ) => {
        let test_files: FileInfo[]

        if (`structure_type` in test_config) {
          test_files = [
            {
              name: `test.txt`,
              content: `content`,
              formatted_name: `test.txt`,
              type: `TXT`,
              structure_type: test_config.structure_type,
            },
          ]
        } else {
          test_files = Array.from(
            { length: test_config.file_count },
            (_, idx) => create_mock_file(`file${idx}.cif`, `content${idx}`),
          )
        }

        mount(FileCarousel, {
          target: document.body,
          props: { files: test_files },
        })

        if (`expected_text` in test_config) {
          expect(document.body.textContent).toContain(test_config.expected_text)
        }

        if (`expected_children` in test_config) {
          const carousel = doc_query(`.file-carousel`)
          expect(carousel.children.length).toBe(test_config.expected_children)
        }
      },
    )

    it.each([
      [`minimal props`, { files: mock_files }, mock_files.length, `file_count`],
      [
        `with empty active_files`,
        { files: mock_files, active_files: [] },
        0,
        `active_count`,
      ],
      [
        `with show_structure_filters disabled`,
        { files: mock_files },
        false,
        `no_structure_icons`,
      ],
    ])(
      `handles %s correctly`,
      (
        _description: string,
        props: { files: FileInfo[]; active_files?: string[] },
        expected: number | boolean,
        test_type: string,
      ) => {
        mount(FileCarousel, { target: document.body, props })
        expect(doc_query(`.file-carousel`)).toBeTruthy()

        if (test_type === `active_count`) {
          const active_elements = document.querySelectorAll(`.file-item.active`)
          expect(active_elements.length).toBe(expected as number)
        } else if (test_type === `file_count`) {
          const file_items = document.querySelectorAll(`.file-item`)
          expect(file_items.length).toBe(expected as number)
        } else if (test_type === `no_structure_icons`) {
          const legend_text = doc_query(`.legend`).textContent || ``
          expect(legend_text).not.toContain(`🔷crystal`)
          expect(legend_text).not.toContain(`🧬molecule`)
        }
      },
    )
  })
})
