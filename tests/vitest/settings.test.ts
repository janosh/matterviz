import {
  build_structure_props_from_settings,
  DEFAULTS,
  get_convex_hull_defaults,
  merge,
  SETTINGS_CONFIG,
} from '$lib/settings'
import {
  clear_structure_view_state,
  create_structure_view_state,
  deserialize_structure_view_state,
  load_structure_view_state,
  save_structure_view_state,
  serialize_structure_view_state,
  STRUCTURE_VIEW_STATE_STORAGE_KEY,
  STRUCTURE_VIEW_STATE_VERSION,
  type StructureViewState,
} from '$lib/settings/viewer-state'
import {
  legend_mode_to_prop,
  type LegendVisibilityMode,
} from '$lib/plot/core/utils/series-visibility'
import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SvelteSet } from 'svelte/reactivity'
import { describe, expect, test } from 'vitest'

const settings_module = join(`src`, `lib`, `settings.ts`)

describe(`Settings`, () => {
  test.each([
    [2, 0.1],
    [3, 0.5],
    [4, 0.1],
  ] as const)(
    `%dD convex hull defaults to a %s eV/atom visibility threshold`,
    (element_count, threshold) =>
      expect(get_convex_hull_defaults(element_count).max_hull_dist_show_phases).toBe(
        threshold,
      ),
  )

  describe(`merge function`, () => {
    test(`returns DEFAULTS for empty inputs`, () => {
      expect(merge()).toEqual(DEFAULTS)
      expect(merge({})).toEqual(DEFAULTS)
      expect(merge({ structure: undefined })).toEqual(DEFAULTS)
    })

    test(`overrides specified values while preserving defaults`, () => {
      const result = merge({
        color_scheme: `Jmol`,
        structure: { atom_radius: 1.5 },
        brillouin: { bz_order: 2 },
        fermi: { mu: 0.25 },
        trajectory: { auto_play: true },
      })

      // Overrides applied
      expect(result.color_scheme).toBe(`Jmol`)
      expect(result.structure.atom_radius).toBe(1.5)
      expect(result.brillouin.bz_order).toBe(2)
      expect(result.fermi.mu).toBe(0.25)
      expect(result.trajectory.auto_play).toBe(true)

      // Defaults preserved
      expect(result.structure.show_atoms).toBe(DEFAULTS.structure.show_atoms)
      expect(result.brillouin.edge_color).toBe(DEFAULTS.brillouin.edge_color)
      expect(result.fermi.representation).toBe(DEFAULTS.fermi.representation)
      expect(result.trajectory.fps).toBe(DEFAULTS.trajectory.fps)
      expect(result.scatter.point.size).toBe(DEFAULTS.scatter.point.size)
    })

    test(`merges symmetry overrides while preserving symmetry defaults`, () => {
      const result = merge({ symmetry: { symprec: 1e-2 } })
      expect(result.symmetry.symprec).toBe(1e-2)
      expect(result.symmetry.algo).toBe(DEFAULTS.symmetry.algo)
    })

    test(`partial updates don't affect other sections`, () => {
      const result = merge({
        structure: { atom_radius: 2.0 },
      })

      expect(result.structure.atom_radius).toBe(2.0)
      expect(result.trajectory).toEqual(DEFAULTS.trajectory)
      expect(result.plot).toEqual(DEFAULTS.plot)
    })
  })

  describe(`Edge cases and robustness`, () => {
    test(`merge preserves immutability of DEFAULTS`, () => {
      const original = { ...DEFAULTS }
      merge({ structure: { atom_radius: 999 } })
      expect(DEFAULTS).toEqual(original)
    })

    // Locks the shipped structure-viewer defaults. The clone test below deliberately does
    // not, since it compares DEFAULTS against values read from DEFAULTS.
    test(`structure viewer ships the intended defaults`, () => {
      expect(DEFAULTS.structure.auto_rotate).toBe(0) // no perpetual spin / render loop
      expect(DEFAULTS.structure.zoom_to_cursor).toBe(false) // wheel zoom stays centered
      expect(DEFAULTS.structure.site_label_bg_color).toBe(`transparent`)
      expect(SETTINGS_CONFIG.structure.fov.minimum).toBe(5) // below the default of 10
    })

    // sync-config turns every editor-context setting into a VS Code `contributes.
    // configuration` entry, so a key nothing reads becomes a documented toggle wired to
    // nothing. That shipped for 13 keys (trajectory.loop_playback, pause_on_hover,
    // smooth_playback, structure.show_cell, ...) plus four plot.show_*_grid keys that lost
    // to scatter.display.*_grid. Leaf-name matching, so a generic name like `opacity` can
    // still hide, but every distinctive dead key gets caught.
    test(`every setting is read somewhere outside settings.ts`, () => {
      const leaf_paths: string[] = []
      const walk = (node: unknown, path: string[]): void => {
        if (!node || typeof node !== `object` || Array.isArray(node)) return
        const record = node as Record<string, unknown>
        if (`value` in record) {
          if (`enum` in record) {
            expect(record.enum, `${path.join(`.`)} enum omits its default`).toHaveProperty([
              String(record.value),
            ])
          }
          leaf_paths.push(path.join(`.`))
          return
        }
        for (const [key, child] of Object.entries(record)) walk(child, [...path, key])
      }
      walk(SETTINGS_CONFIG, [])
      expect(leaf_paths.length).toBeGreaterThan(200)

      const haystack = globSync(
        [
          `src/lib/**/*.{ts,svelte}`,
          `src/routes/**/*.{ts,svelte}`,
          `extensions/anywidget/**/*.{ts,svelte}`,
        ],
        // node_modules contains built copies of settings.js that would mask every dead key
        { exclude: [`**/node_modules/**`, settings_module] },
      )
        .map((path) => readFileSync(path, `utf8`))
        .join(`\n`)

      const unread = leaf_paths.filter(
        (path) => !new RegExp(`\\b${path.split(`.`).at(-1)}\\b`).test(haystack),
      )
      expect(unread).toEqual([])
    })
  })

  // Components used to declare their defaults twice: once as $bindable() props and once as
  // a `defaults` object in their Controls, with nothing keeping the two in step (Trajectory
  // shipped fps = 5 against the schema's 10). For every component that reads DEFAULTS, each
  // $props() default whose name is a leaf of a schema group that component reads must
  // evaluate to that leaf's value. Static evaluation of the default expression rather than a
  // mount: Threlte scenes and components with required props can't mount propless in
  // happy-dom, and it covers every prop either way.
  describe(`component prop defaults match the schema`, () => {
    const is_leaf = (value: unknown) =>
      value === null || typeof value !== `object` || Array.isArray(value)
    const at_path = (root: unknown, path: string[]): unknown =>
      path.reduce<unknown>(
        (node, key) => (node as Record<string, unknown> | undefined)?.[key],
        root,
      )
    const UNRESOLVED = Symbol(`unresolved`)
    // The slice of ESTree the prop defaults use (@types/estree is not resolvable from here)
    type Node = {
      type: string
      start: number
      end: number
      name?: string
      value?: unknown
      computed?: boolean
      operator?: string
      object?: Node
      property?: Node
      callee?: Node
      arguments?: Node[]
      elements?: Node[]
      expressions?: Node[]
      quasis?: { value: { cooked: string } }[]
      expression?: Node
      argument?: Node
      right?: Node
      key?: Node
      id?: Node
      init?: Node
      declarations?: Node[]
      properties?: Node[]
    }

    // Props whose name collides with a schema leaf but whose default is deliberately not
    // that leaf. Each needs a reason; anything else that differs is drift.
    const deliberate: Record<string, Record<string, string>> = {
      'brillouin/BrillouinZoneScene': {
        camera_position: `undefined auto-fits the zone; structure.camera_position is the structure viewer's`,
      },
      'fermi-surface/FermiSurfaceScene': {
        camera_position: `undefined auto-fits the zone; structure.camera_position is the structure viewer's`,
        vector_scale: `reciprocal-lattice vector length as in DEFAULTS.brillouin.vector_scale (1), not structure.vector_scale`,
      },
      'scene/SceneCamera': {
        camera_projection: `shared camera primitive; every scene passes its own schema value`,
        gizmo: `shared camera primitive; every scene passes its own schema value`,
      },
      'trajectory/Trajectory': {
        show_controls: `ShowControlsProp: undefined normalises to the schema's shown state via normalize_show_controls(.., 'always')`,
      },
    }

    const components = globSync(`src/lib/**/*.svelte`)
      .filter((path) => /\bDEFAULTS\./.test(readFileSync(path, `utf8`)))
      .map((path) => path.replace(/^src\/lib\//, ``).replace(/\.svelte$/, ``))
      .toSorted()

    test(`every component reading DEFAULTS is covered`, () => {
      expect(components.length).toBeGreaterThan(30)
      expect(Object.keys(deliberate).filter((name) => !components.includes(name))).toEqual([])
    })

    test.each(components)(`%s`, async (component) => {
      const { parse } = await import(`svelte/compiler`)
      const source = readFileSync(join(`src`, `lib`, `${component}.svelte`), `utf8`)
      // `const defaults = DEFAULTS.<group>` aliases used by Controls and hull components
      const aliases: Record<string, unknown> = {}
      const alias = /const defaults = DEFAULTS\.(?<path>[\w.]+)/.exec(source)?.groups?.path
      if (alias) aliases.defaults = at_path(DEFAULTS, alias.split(`.`))
      // Every schema group this component reads: DEFAULTS.a.b.leaf contributes group a.b
      const groups = new SvelteSet<string>()
      for (const { 1: path } of source.matchAll(/\bDEFAULTS\.(?<path>[\w.]+)/g)) {
        const parts = path.split(`.`)
        while (parts.length && is_leaf(at_path(DEFAULTS, parts))) parts.pop()
        if (parts.length) groups.add(parts.join(`.`))
      }
      // DEFAULTS[chart]: the index ranges over whichever top-level groups the file names
      if (/\bDEFAULTS\[\w+\]/.test(source)) {
        for (const [group, value] of Object.entries(DEFAULTS)) {
          if (!is_leaf(value) && new RegExp(`\\b${group}\\b`).test(source)) groups.add(group)
        }
      }
      const group_values = [...groups].map(
        (group) => at_path(DEFAULTS, group.split(`.`)) as Record<string, unknown>,
      )

      const evaluate = (node: Node | null | undefined): unknown => {
        if (!node) return undefined
        if (node.type === `CallExpression` && node.callee?.name === `$bindable`) {
          return evaluate(node.arguments?.[0])
        }
        if (node.type === `CallExpression` && node.callee?.name === `legend_mode_to_prop`) {
          const mode = evaluate(node.arguments?.[0])
          return mode === UNRESOLVED
            ? UNRESOLVED
            : legend_mode_to_prop(mode as LegendVisibilityMode)
        }
        if (node.type === `Literal`) return node.value
        if (node.type === `TemplateLiteral` && node.expressions?.length === 0) {
          return (node.quasis ?? []).map((quasi) => quasi.value.cooked).join(``)
        }
        if (node.type === `TSAsExpression` || node.type === `TSSatisfiesExpression`) {
          return evaluate(node.expression)
        }
        // `scene_props_in?.x ?? DEFAULTS.x`: the fallback is the default without props
        if (node.type === `LogicalExpression` && node.operator === `??`)
          return evaluate(node.right)
        if (node.type === `UnaryExpression` && node.operator === `-`) {
          const value = evaluate(node.argument)
          return typeof value === `number` ? -value : UNRESOLVED
        }
        if (node.type === `ArrayExpression`) {
          const values = (node.elements ?? []).map((element) => evaluate(element))
          return values.includes(UNRESOLVED) ? UNRESOLVED : values
        }
        if (node.type === `MemberExpression` || node.type === `Identifier`) {
          const path: string[] = []
          let current: Node = node
          while (current.type === `MemberExpression`) {
            const { object, property } = current
            if (!object || !property) return UNRESOLVED
            if (current.computed) {
              // DEFAULTS[chart].leaf: valid when every candidate group agrees on the leaf
              if (object.type !== `Identifier` || object.name !== `DEFAULTS`) return UNRESOLVED
              const values = group_values
                .map((group) => at_path(group, path))
                .filter((value) => value !== undefined)
              const [first, ...rest] = values.map((value) => JSON.stringify(value))
              return first !== undefined && rest.every((value) => value === first)
                ? values[0]
                : UNRESOLVED
            }
            if (property.type !== `Identifier` || !property.name) return UNRESOLVED
            path.unshift(property.name)
            current = object
          }
          if (current.type !== `Identifier` || !current.name) return UNRESOLVED
          const root = current.name === `DEFAULTS` ? DEFAULTS : aliases[current.name]
          const value = root === undefined ? undefined : at_path(root, path)
          return value === undefined ? UNRESOLVED : value
        }
        return UNRESOLVED
      }

      const ast = parse(source, { modern: true, filename: component })
      const props = ((ast.instance?.content.body ?? []) as Node[])
        .flatMap((statement) =>
          statement.type === `VariableDeclaration` ? (statement.declarations ?? []) : [],
        )
        .find(
          (declaration) =>
            declaration.init?.type === `CallExpression` &&
            declaration.init.callee?.name === `$props`,
        )?.id?.properties
      if (!props) return // reads DEFAULTS in markup or helpers only, no props to check

      const drift: string[] = []
      for (const prop of props) {
        const key = prop.key?.name
        if (prop.type === `RestElement` || !key) continue
        const schema_values = group_values
          .filter((group) => key in group && is_leaf(group[key]))
          // tri-state legend settings reach the boolean|undefined prop through
          // legend_mode_to_prop, so compare against what the prop would receive
          .map((group) =>
            key === `show_legend`
              ? legend_mode_to_prop(group[key] as LegendVisibilityMode)
              : group[key],
          )
        if (schema_values.length === 0) continue
        // Property.value is the pattern node (Literal.value above is the primitive)
        const pattern = prop.value as Node | undefined
        const fallback = pattern?.type === `AssignmentPattern` ? pattern.right : undefined
        const value = evaluate(fallback)
        const matches = schema_values.some(
          (expected) => JSON.stringify(expected) === JSON.stringify(value),
        )
        if (matches || deliberate[component]?.[key]) continue
        const shown =
          value === UNRESOLVED && fallback
            ? source.slice(fallback.start, fallback.end)
            : JSON.stringify(value)
        drift.push(
          `${key} = ${shown} (schema: ${schema_values.map((expected) => JSON.stringify(expected)).join(` | `)})`,
        )
      }
      expect(drift, `${component} hardcodes defaults that belong to the schema`).toEqual([])
      // a deliberate exception for a prop that no longer exists is stale
      const stale = Object.keys(deliberate[component] ?? {}).filter(
        (key) => !props.some((prop) => prop.key?.name === key),
      )
      expect(stale, `${component}: stale deliberate-exception entries`).toEqual([])
    })
  })

  describe(`Convex hull settings`, () => {
    test.each([
      [`ternary`, DEFAULTS.convex_hull.ternary, `uniform`],
      [`quaternary`, DEFAULTS.convex_hull.quaternary, `dominant_element`],
    ])(`%s has valid 3D hull face properties`, (_, settings, expected_color_mode) => {
      // Default color mode (ternary=uniform, quaternary=dominant_element)
      expect(settings.hull_face_color_mode).toBe(expected_color_mode)
      expect(settings.hull_face_opacity).toBeGreaterThanOrEqual(0)
      expect(settings.hull_face_opacity).toBeLessThanOrEqual(1)
    })
  })
})

test(`settings builder groups structure props`, () => {
  const props = build_structure_props_from_settings(DEFAULTS)

  expect(props.scene_props).toEqual(DEFAULTS.structure)
  expect(props.scene_props).not.toBe(DEFAULTS.structure) // embedders mutate scene_props
  expect(props.lattice_props.cell_edge_width).toBe(DEFAULTS.structure.cell_edge_width)
})

describe(`Structure viewer state serialization`, () => {
  const parse_or_throw = (json: string): StructureViewState => {
    const { state, error } = deserialize_structure_view_state(json)
    if (!state) throw new Error(error)
    return state
  }

  test(`keeps themed backgrounds unset and skips non-portable structure state`, () => {
    const scene_props = {
      get camera_position(): never {
        throw new Error(`camera_position must not be read`)
      },
    }
    const state = create_structure_view_state({ scene_props })
    expect(state.settings.background_color).toBeUndefined()
    expect(state.settings.structure).not.toHaveProperty(`camera_position`)
  })

  test(`round-trips validated settings through the shared JSON format`, () => {
    const state = create_structure_view_state({
      scene_props: {
        atom_radius: 1.25,
        camera_projection: `perspective`,
        vector_configs: { force: { visible: false } },
      },
      lattice_props: { cell_edge_opacity: 0.8 },
      color_scheme: `Jmol`,
      background_color: `#123456`,
      background_opacity: 0.4,
      show_image_atoms: false,
      atom_color_config: {
        mode: `coordination`,
        scale: `interpolatePlasma`,
        scale_type: `continuous`,
      },
      supercell_scaling: `2x3x1`,
      cell_type: `conventional`,
      multi_view: true,
      controls_pane_size: { width: 520, height: 640 },
    })

    const round_tripped = parse_or_throw(serialize_structure_view_state(state))
    expect(round_tripped).toMatchObject({
      version: STRUCTURE_VIEW_STATE_VERSION,
      settings: {
        color_scheme: `Jmol`,
        background_color: `#123456`,
        background_opacity: 0.4,
        structure: {
          atom_radius: 1.25,
          camera_projection: `perspective`,
          cell_edge_opacity: 0.8,
          show_image_atoms: false,
          atom_color_mode: `coordination`,
          atom_color_scale: `interpolatePlasma`,
        },
      },
      viewer: {
        supercell_scaling: `2x3x1`,
        cell_type: `conventional`,
        multi_view: true,
        controls_pane_size: { width: 520, height: 640 },
      },
    })
    expect(round_tripped.settings.structure).not.toHaveProperty(`vector_configs`)
  })

  test(`replaces unknown, wrong-type, and out-of-range values with schema defaults`, () => {
    const { settings, viewer } = parse_or_throw(
      JSON.stringify({
        version: STRUCTURE_VIEW_STATE_VERSION,
        unknown_top_level: true,
        settings: {
          color_scheme: 42,
          background_color: null,
          background_opacity: 2,
          unknown_group: { enabled: true },
          structure: {
            atom_radius: 99,
            show_atoms: `yes`,
            camera_projection: `fisheye`,
            rotation: [0, `bad`, 0],
            polyhedra_excluded_elements: [8],
            unknown_setting: `ignored`,
          },
        },
        viewer: {
          supercell_scaling: `0x2x2`,
          cell_type: `derived`,
          multi_view: `yes`,
          controls_pane_size: { width: -1, height: `large` },
          unknown_viewer_setting: true,
        },
      }),
    )

    expect(settings).toMatchObject({
      color_scheme: DEFAULTS.color_scheme,
      background_color: DEFAULTS.background_color,
      background_opacity: DEFAULTS.background_opacity,
      structure: {
        atom_radius: DEFAULTS.structure.atom_radius,
        show_atoms: DEFAULTS.structure.show_atoms,
        camera_projection: DEFAULTS.structure.camera_projection,
        rotation: DEFAULTS.structure.rotation,
        polyhedra_excluded_elements: DEFAULTS.structure.polyhedra_excluded_elements,
      },
    })
    expect(settings.structure).not.toHaveProperty(`unknown_setting`)
    expect(settings).not.toHaveProperty(`unknown_group`)
    expect(viewer).toEqual({
      supercell_scaling: `1x1x1`,
      cell_type: `original`,
      multi_view: false,
    })
  })

  test.each([
    [`corrupt JSON`, `{`, `Invalid JSON`],
    [`non-object JSON`, `[]`, `must be a JSON object`],
    [
      `unsupported version`,
      JSON.stringify({ version: 999 }),
      `Unsupported view-state version`,
    ],
  ])(`rejects %s`, (_description, json, expected_error) => {
    expect(deserialize_structure_view_state(json)).toEqual({
      error: expect.stringContaining(expected_error),
    })
  })

  test(`handles missing and corrupt localStorage without throwing`, () => {
    expect(load_structure_view_state()).toBeNull()

    localStorage.setItem(STRUCTURE_VIEW_STATE_STORAGE_KEY, `{bad json`)
    expect(load_structure_view_state()).toBeNull()
    expect(localStorage.getItem(STRUCTURE_VIEW_STATE_STORAGE_KEY)).toBeNull()
  })

  test(`throws on invalid program-created state`, () => {
    const invalid_state = create_structure_view_state()
    Reflect.set(invalid_state, `version`, 999)

    expect(() => save_structure_view_state(invalid_state)).toThrow(
      `Cannot serialize structure view state version 999`,
    )
  })

  test(`persists non-default state and removes a restored default state`, () => {
    const customized = create_structure_view_state({
      scene_props: { atom_radius: 1.5 },
    })
    expect(save_structure_view_state(customized)).toBe(true)
    expect(load_structure_view_state()?.settings.structure.atom_radius).toBe(1.5)

    expect(save_structure_view_state(create_structure_view_state())).toBe(true)
    expect(localStorage.getItem(STRUCTURE_VIEW_STATE_STORAGE_KEY)).toBeNull()

    // backs "Reset all" in the controls pane: the next load must not resurrect old settings
    save_structure_view_state(customized)
    expect(localStorage.getItem(STRUCTURE_VIEW_STATE_STORAGE_KEY)).not.toBeNull()
    expect(clear_structure_view_state()).toBe(true)
    expect(localStorage.getItem(STRUCTURE_VIEW_STATE_STORAGE_KEY)).toBeNull()
  })
})
