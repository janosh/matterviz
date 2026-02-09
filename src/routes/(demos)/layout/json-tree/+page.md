---
title: JsonTree
---

<script lang="ts">
  import { JsonTree } from '$lib'

  // API response with nested data
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

  // Scientific/materials data (large)
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

  // All data types showcase
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
  }

  // Edge cases including URL/color auto-detection
  const edge_cases = {
    // URLs auto-linked, CSS colors get swatches
    urls: {
      website: "https://github.com/janosh/matterviz",
      api: "https://api.example.com/v2/materials?page=1&limit=100#section",
      not_a_url: "just a regular string",
    },
    colors: {
      hex: "#3b82f6",
      rgb: "rgb(139, 92, 246)",
      hsl: "hsl(330, 80%, 60%)",
      oklch: "oklch(0.8 0.15 85)",
      transparent: "rgba(0, 0, 0, 0.5)",
      not_a_color: "blue sky",
    },
    // Long strings, special chars, unicode
    long_paragraph: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
    multiline: "First line\nSecond line\nThird line with\ttab",
    "key.with.dots": "dot notation won't work here",
    "key with spaces": "needs bracket notation",
    'key"with"quotes': "escaped in paths",
    "émojis_🎉_work": "unicode keys supported",
    unicode_text: "日本語テキスト • Ελληνικά • العربية",
    emojis: "🚀 🎨 🔧 💡 ⚡ 🌈",
    math_symbols: "∑∏∫∂∇ε δ→∞ √π ≈ ≠ ≤ ≥",
    // Number edge cases
    huge_number: 9999999999999999999999n,
    scientific: 6.022e23,
    // Nested collections
    nested_collections: new Map([
      ["set_value", new Set([{ inner: [1, 2, 3] }])],
      ["map_value", new Map([["deep", { very: { deep: true } }]])]
    ]),
    empty_string: "",
    html_content: "<div class='test'><span>HTML &amp; entities</span></div>",
  }

  // Large dataset for performance
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

  // Diff mode (old vs new data)
  const old_config = {
    name: "my-app",
    version: "1.0.0",
    port: 3000,
    features: { auth: true, logging: false, cache_ttl: 300, deprecated_flag: true },
    plugins: ["svelte", "tailwind"],
  }
  const new_config = {
    name: "my-app",
    version: "2.0.0",
    port: 8080,
    features: { auth: true, logging: true, cache_ttl: 600, dark_mode: true },
    plugins: ["svelte", "tailwind", "mdsvex"],
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
  let last_selected: { path: string; value: string } | null = $state(null)
  let last_copied: { path: string; preview: string } | null = $state(null)

  function handle_select(path: string, value: unknown) {
    last_selected = { path, value: typeof value === 'object' ? JSON.stringify(value) : String(value) }
  }

  function handle_copy(path: string, value: string) {
    last_copied = { path, preview: value.slice(0, 50) + (value.length > 50 ? '...' : '') }
  }
</script>

A fully-featured JSON tree viewer with folding, search, copy, keyboard navigation, diff mode, and change highlighting.

## Quick Start

```svelte
<script lang="ts">
  import { JsonTree } from '$lib'
  const data = { name: 'Example', values: [1, 2, 3] }
</script>

<JsonTree value={data} />
```

## Examples

### API Response with Search

Search for "alice", "admin", or "editor". Right-click any node for the context menu. Ctrl+click to select, Shift+click a key to copy its path:

<JsonTree value={api_response} default_fold_level={4} />

### Scientific Data

Large nested structure. Note the **size annotations** on collapsed nodes, **sticky headers** as you scroll, and the **⊟ button** on hover to collapse children:

<JsonTree value={materials_data} default_fold_level={2} auto_fold_arrays={5} />

### All Supported Data Types

Every JavaScript type rendered correctly with type annotations:

<JsonTree value={all_types} default_fold_level={1} show_data_types={true} />

### Edge Cases, URLs & Colors

URLs render as clickable links. CSS color strings show inline swatches. Special characters and unicode in keys and values:

<JsonTree value={edge_cases} default_fold_level={2} />

### Large Dataset (100 items)

Performance test with auto-folding. Use the level buttons (1, 2, 3) to control depth:

<JsonTree value={large_dataset} default_fold_level={2} auto_fold_arrays={20} />

### Diff Mode

Pass `compare_value` to highlight additions (green), changes (yellow), and removals (red strikethrough):

<JsonTree value={new_config} compare_value={old_config} default_fold_level={5} />

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

### Prop Variants

Sorted keys, custom root label, and headerless mode:

<JsonTree value={{ zebra: 1, apple: 2, mango: 3, banana: 4 }} sort_keys={true} show_header={false} />

<JsonTree value={["red", "green", "blue"]} root_label="colors" show_header={false} />

<JsonTree value={{ compact: true, clean: "display" }} show_header={false} />

## Interactions

All built-in — no props needed:

- **Right-click** any node → context menu with Copy value, Copy path, Expand/Collapse children, Pin path
- **Click a closed key** → expands it. **Click an open key** → copies value
- **Shift+click** or **middle-click** any key → copies the path
- **Ctrl+click** nodes to select (blue highlight), **Ctrl+Shift+click** for range select
- **Ctrl+C** with selection → copies all selected values. **Escape** clears
- **Hover** a key → shows `▸` expand hint or clipboard icon
- **⊟ button** on hover → collapses children while keeping node open
- **Pinned paths** panel appears between header and content after pinning via context menu

## Keyboard Navigation

| Key             | Action                                      |
| --------------- | ------------------------------------------- |
| ↓/↑             | Navigate between nodes                      |
| →               | Expand node or move to child                |
| ←               | Collapse node or move to parent             |
| Enter/Space     | Toggle collapse (expandable) or copy (leaf) |
| Ctrl/Cmd+C      | Copy focused value (or all selected)        |
| Ctrl/Cmd+click  | Toggle node selection                       |
| Shift+click key | Copy path to clipboard                      |
| Escape          | Close context menu, then clear selection    |

## Props Reference

| Prop                 | Type                    | Default     | Description                                          |
| -------------------- | ----------------------- | ----------- | ---------------------------------------------------- |
| `value`              | `unknown`               | required    | Data to display                                      |
| `root_label`         | `string`                | -           | Label for root node                                  |
| `default_fold_level` | `number`                | `2`         | Initial expansion depth                              |
| `auto_fold_arrays`   | `number`                | `10`        | Auto-collapse arrays larger than this                |
| `auto_fold_objects`  | `number`                | `20`        | Auto-collapse objects larger than this               |
| `collapsed_paths`    | `Set<string>`           | `new Set()` | Bindable collapse state                              |
| `show_header`        | `boolean`               | `true`      | Show search/controls                                 |
| `show_data_types`    | `boolean`               | `false`     | Show type annotations                                |
| `show_array_indices` | `boolean`               | `true`      | Show array indices                                   |
| `sort_keys`          | `boolean`               | `false`     | Alphabetize keys                                     |
| `max_string_length`  | `number`                | `200`       | Truncate long strings                                |
| `highlight_changes`  | `boolean`               | `true`      | Flash on value change                                |
| `compare_value`      | `unknown`               | -           | Diff against this value (shows adds/removes/changes) |
| `onselect`           | `(path, value) => void` | -           | Node click callback                                  |
| `oncopy`             | `(path, value) => void` | -           | Copy callback                                        |
| `download_filename`  | `string`                | auto        | Custom filename for JSON download                    |

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
