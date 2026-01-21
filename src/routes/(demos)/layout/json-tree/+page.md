---
title: JsonTree
---

<script>
  import { JsonTree } from '$lib'

  // Example 1: Simple config-like data
  const config_data = {
    name: "my-app",
    version: "2.1.0",
    private: true,
    scripts: {
      dev: "vite dev",
      build: "vite build",
      test: "vitest run"
    },
    dependencies: {
      svelte: "^5.0.0",
      vite: "^6.0.0"
    }
  }

  // Example 2: API response with nested data
  const api_response = {
    status: "success",
    data: {
      users: [
        { id: 1, name: "Alice Chen", email: "alice@example.com", role: "admin", active: true },
        { id: 2, name: "Bob Smith", email: "bob@example.com", role: "editor", active: true },
        { id: 3, name: "Carol White", email: "carol@example.com", role: "viewer", active: false }
      ],
      pagination: { page: 1, per_page: 10, total: 3 },
      meta: { request_id: "abc-123-xyz", timestamp: new Date().toISOString() }
    }
  }

  // Example 3: Scientific/materials data (large)
  const materials_data = {
    formula: "Fe2O3",
    material_id: "mp-19770",
    nsites: 10,
    volume: 302.72,
    density: 5.27,
    band_gap: 2.1,
    is_stable: true,
    elements: ["Fe", "O"],
    sites: Array.from({ length: 10 }, (_, i) => ({
      species: i < 4 ? "Fe" : "O",
      coords: [Math.random().toFixed(4), Math.random().toFixed(4), Math.random().toFixed(4)],
      properties: { charge: i < 4 ? 3.0 : -2.0, magmom: i < 4 ? 4.2 : 0.0 }
    })),
    symmetry: {
      crystal_system: "trigonal",
      space_group: "R-3c",
      point_group: "-3m",
      hall_symbol: "-R 3 2\"c"
    },
    thermodynamics: {
      formation_energy_per_atom: -1.234,
      energy_above_hull: 0.0,
      decomposes_to: null
    }
  }

  // Example 4: All data types showcase
  const all_types = {
    string: "Hello, World!",
    number: 42,
    float: 3.14159265359,
    negative: -273.15,
    boolean_true: true,
    boolean_false: false,
    null_value: null,
    undefined_value: undefined,
    bigint: BigInt("9007199254740991"),
    symbol: Symbol("unique_id"),
    date: new Date("2024-06-15T14:30:00Z"),
    regexp: /^[a-z]+@[a-z]+\.[a-z]{2,}$/i,
    error: new Error("Something went wrong"),
    function: function calculate(x, y) { return x + y },
    arrow_fn: (x) => x * 2,
    map: new Map([["key1", "value1"], ["key2", { nested: true }]]),
    set: new Set([1, 2, 3, "four", { five: 5 }]),
    array: [1, "two", true, null, { nested: "object" }],
    object: { a: 1, b: 2, c: { d: 3 } },
    empty_array: [],
    empty_object: {},
    special_numbers: { infinity: Infinity, neg_infinity: -Infinity, nan: NaN },
    long_string: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat."
  }

  // Example 5: Large dataset for performance
  const large_dataset = {
    metadata: { generated: new Date().toISOString(), count: 100 },
    items: Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      name: `Item ${i + 1}`,
      value: Math.round(Math.random() * 1000),
      active: Math.random() > 0.3,
      tags: [`tag${i % 5}`, `category${i % 3}`]
    }))
  }

  // Example 6: Deeply nested structure
  const deep_structure = {
    level_0: {
      level_1: {
        level_2: {
          level_3: {
            level_4: {
              level_5: {
                deep_value: "You found me!",
                siblings: ["a", "b", "c"]
              }
            }
          }
        }
      }
    }
  }

  // Dynamic data for change highlighting
  let dynamic_value = $state({ counter: 0, timestamp: new Date().toISOString(), random: Math.random() })

  function update_dynamic() {
    dynamic_value = {
      counter: dynamic_value.counter + 1,
      timestamp: new Date().toISOString(),
      random: Math.random()
    }
  }

  // Callback demo state
  let last_selected = $state(null)
  let last_copied = $state(null)

  function handle_select(path, value) {
    last_selected = { path, value: typeof value === 'object' ? JSON.stringify(value) : String(value) }
  }

  function handle_copy(path, value) {
    last_copied = { path, preview: value.slice(0, 50) + (value.length > 50 ? '...' : '') }
  }
</script>

A fully-featured JSON tree viewer with folding, search, copy, keyboard navigation, and change highlighting.

## Quick Start

```svelte
<script>
  import { JsonTree } from '$lib'
  const data = { name: 'Example', values: [1, 2, 3] }
</script>

<JsonTree value={data} />
```

## Examples

### Config File

<JsonTree value={config_data} default_fold_level={3} />

### API Response with Search

Search for "alice", "admin", or "editor" to filter results:

<JsonTree value={api_response} default_fold_level={4} />

### Scientific Data (Materials)

Large nested structure with arrays of objects:

<JsonTree value={materials_data} default_fold_level={2} auto_fold_arrays={5} />

### All Supported Data Types

Every JavaScript type rendered correctly:

<JsonTree value={all_types} default_fold_level={1} show_data_types={true} />

### Large Dataset (100 items)

Performance test with auto-folding:

<JsonTree value={large_dataset} default_fold_level={2} auto_fold_arrays={20} />

### Deep Nesting with Level Controls

Use the level buttons (1, 2, 3) to control expansion depth:

<JsonTree value={deep_structure} default_fold_level={2} />

### Change Highlighting

Values flash when updated. Click the button and watch the values change:

<button onclick={update_dynamic} style="margin-bottom: 0.5em; padding: 0.25em 0.75em">
  Update Values
</button>

<JsonTree value={dynamic_value} highlight_changes={true} show_header={false} />

### Interactive Callbacks

Click nodes and values to see callbacks fire:

<div style="display: flex; gap: 1em; margin-bottom: 0.5em; font-size: 0.85em">
  <span><strong>Selected:</strong> {last_selected ? `${last_selected.path} = ${last_selected.value}` : 'None'}</span>
  <span><strong>Copied:</strong> {last_copied ? `${last_copied.path}` : 'None'}</span>
</div>

<JsonTree
value={{ user: { name: "Click me", id: 42 }, items: [1, 2, 3] }}
show_header={false}
default_fold_level={5}
onselect={handle_select}
oncopy={handle_copy}
/>

### Sorted Keys

Alphabetically sorted object keys:

<JsonTree value={{ zebra: 1, apple: 2, mango: 3, banana: 4, cherry: 5 }} sort_keys={true} show_header={false} />

### Custom Root Label

<JsonTree value={["red", "green", "blue"]} root_label="colors" show_header={false} />

### Minimal (No Header)

<JsonTree value={{ compact: true, clean: "display" }} show_header={false} />

## Keyboard Navigation

| Key         | Action                          |
| ----------- | ------------------------------- |
| ↓/↑         | Navigate between nodes          |
| →           | Expand node or move to child    |
| ←           | Collapse node or move to parent |
| Enter/Space | Toggle collapse                 |
| Ctrl+C      | Copy focused value              |

## Props Reference

| Prop                 | Type                    | Default     | Description                            |
| -------------------- | ----------------------- | ----------- | -------------------------------------- |
| `value`              | `unknown`               | required    | Data to display                        |
| `root_label`         | `string`                | -           | Label for root node                    |
| `default_fold_level` | `number`                | `2`         | Initial expansion depth                |
| `auto_fold_arrays`   | `number`                | `10`        | Auto-collapse arrays larger than this  |
| `auto_fold_objects`  | `number`                | `20`        | Auto-collapse objects larger than this |
| `collapsed_paths`    | `Set<string>`           | `new Set()` | Bindable collapse state                |
| `show_header`        | `boolean`               | `true`      | Show search/controls                   |
| `show_data_types`    | `boolean`               | `false`     | Show type annotations                  |
| `show_array_indices` | `boolean`               | `true`      | Show array indices                     |
| `sort_keys`          | `boolean`               | `false`     | Alphabetize keys                       |
| `max_string_length`  | `number`                | `200`       | Truncate long strings                  |
| `highlight_changes`  | `boolean`               | `true`      | Flash on value change                  |
| `onselect`           | `(path, value) => void` | -           | Node click callback                    |
| `oncopy`             | `(path, value) => void` | -           | Copy callback                          |

## CSS Customization

```css
.json-tree {
  --jt-string: #a31515;
  --jt-number: #098658;
  --jt-boolean: #0000ff;
  --jt-null: #808080;
  --jt-key: #001080;
  --jt-indent: 1.2em;
  --jt-font-size: 13px;
}
```

Colors auto-adapt to dark mode via `light-dark()`.
