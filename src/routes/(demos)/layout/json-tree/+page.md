---
title: JsonTree
---

<script>
  import { JsonTree } from '$lib'

  // Sample data showcasing various types
  const sample_data = {
    string: "Hello, World!",
    number: 42,
    float: 3.14159,
    boolean: true,
    null_value: null,
    array: [1, 2, 3, "four", { nested: true }],
    object: {
      name: "John Doe",
      age: 30,
      email: "john@example.com",
      address: {
        street: "123 Main St",
        city: "Anytown",
        country: "USA"
      }
    },
    long_array: Array.from({ length: 15 }, (_, i) => `item_${i}`),
    date: new Date("2024-01-15T10:30:00Z"),
    regexp: /hello\s+world/gi,
    special_numbers: {
      infinity: Infinity,
      neg_infinity: -Infinity,
      nan: NaN
    },
    deeply_nested: {
      level1: {
        level2: {
          level3: {
            level4: {
              value: "Deep!"
            }
          }
        }
      }
    },
    long_string: "This is a very long string that should be truncated when displayed in the JSON tree viewer. It contains a lot of text to demonstrate the truncation feature and how users can expand it to see the full content.",
    empty_object: {},
    empty_array: []
  }

  // Circular reference example (handled gracefully)
  const circular_data = { name: "circular" }

  // Dynamic data for change highlighting demo
  let dynamic_value = $state({ counter: 0, timestamp: new Date().toISOString() })

  function update_dynamic() {
    dynamic_value = {
      counter: dynamic_value.counter + 1,
      timestamp: new Date().toISOString()
    }
  }

  // Controlled collapse state
  let collapsed_paths = $state(new Set())

  // Search demo
  let search_demo_data = {
    users: [
      { id: 1, name: "Alice", role: "admin" },
      { id: 2, name: "Bob", role: "user" },
      { id: 3, name: "Charlie", role: "user" }
    ],
    settings: {
      theme: "dark",
      notifications: true,
      language: "en"
    }
  }
</script>

A fully-featured, themeable JSON tree viewer component with folding, search, copy functionality, and keyboard navigation.

## Basic Usage

```svelte
<script>
  import { JsonTree } from '$lib'

  const data = {
    name: 'Example',
    values: [1, 2, 3],
  }
</script>

<JsonTree value={data} />
```

<JsonTree value={sample_data} />

## Features

### Search and Filter

Use the search box to filter nodes. Matching keys and values are highlighted, and ancestor nodes automatically expand to show matches.

<JsonTree value={search_demo_data} />

Try searching for "Alice", "admin", or "dark".

### Fold Levels

Control how many levels are expanded by default:

**Level 1 (shallow):**

<JsonTree value={sample_data} default_fold_level={1} show_header={false} />

**Level 3 (deeper):**

<JsonTree value={sample_data} default_fold_level={3} show_header={false} />

### Auto-Fold Large Collections

Arrays with more than `auto_fold_arrays` items (default: 10) are automatically collapsed:

<JsonTree
value={{ small_array: [1, 2, 3], large_array: Array.from({ length: 20 }, (_, i) => i) }}
default_fold_level={5}
/>

### Change Highlighting

Values that change between renders are highlighted with a flash animation:

<div style="margin-bottom: 1em">
  <button onclick={update_dynamic}>Update Values</button>
</div>

<JsonTree value={dynamic_value} highlight_changes={true} show_header={false} />

### Show Data Types

Display type annotations next to values:

<JsonTree
value={{ string: "hello", number: 42, bool: true, arr: [1, 2] }}
show_data_types={true}
show_header={false}
/>

### Sort Keys

Alphabetically sort object keys:

<JsonTree
value={{ zebra: 1, apple: 2, mango: 3, banana: 4 }}
sort_keys={true}
show_header={false}
/>

### Without Header

Hide the search bar and controls:

<JsonTree value={{ compact: true, minimal: "view" }} show_header={false} />

### Root Label

Add a custom label for the root node:

<JsonTree value={["a", "b", "c"]} root_label="items" show_header={false} />

## Keyboard Navigation

- **Arrow Down/Up**: Navigate between nodes
- **Arrow Right**: Expand collapsed node or move to first child
- **Arrow Left**: Collapse expanded node or move to parent
- **Enter/Space**: Toggle collapse state
- **Ctrl+C / Cmd+C**: Copy focused node's value

## Copy Functionality

- Click on a **key** to copy the key name
- Click on a **value** to copy the value (JSON-formatted for objects/arrays)
- A "Copied!" indicator appears briefly after copying

## Supported Data Types

<JsonTree
value={{
string: "text",
number: 123,
float: 3.14,
boolean: true,
null: null,
undefined: undefined,
array: [1, 2, 3],
object: { key: "value" },
date: new Date(),
regexp: /pattern/g,
bigint: BigInt(9007199254740991),
symbol: Symbol("description"),
error: new Error("Something went wrong"),
function: function example() { return 42 },
map: new Map([["key1", "value1"], ["key2", "value2"]]),
set: new Set([1, 2, 3, 4, 5])
}}
default_fold_level={10}
show_header={false}
/>

## Props

| Prop                 | Type          | Default     | Description                            |
| -------------------- | ------------- | ----------- | -------------------------------------- |
| `value`              | `unknown`     | required    | The data to display                    |
| `root_label`         | `string`      | `undefined` | Label for the root node                |
| `default_fold_level` | `number`      | `2`         | Levels to expand by default            |
| `auto_fold_arrays`   | `number`      | `10`        | Auto-collapse arrays longer than this  |
| `auto_fold_objects`  | `number`      | `20`        | Auto-collapse objects larger than this |
| `collapsed_paths`    | `Set<string>` | `new Set()` | Bindable set of collapsed paths        |
| `show_header`        | `boolean`     | `true`      | Show search and controls               |
| `show_data_types`    | `boolean`     | `false`     | Show type annotations                  |
| `show_array_indices` | `boolean`     | `true`      | Show numeric indices for arrays        |
| `sort_keys`          | `boolean`     | `false`     | Sort object keys alphabetically        |
| `max_string_length`  | `number`      | `200`       | Truncate strings longer than this      |
| `highlight_changes`  | `boolean`     | `true`      | Highlight changed values               |
| `onselect`           | `function`    | `undefined` | Callback when node is selected         |
| `oncopy`             | `function`    | `undefined` | Callback when value is copied          |

## CSS Variables

Customize the appearance with CSS variables:

```css
.json-tree {
  --jt-string: #a31515;
  --jt-number: #098658;
  --jt-boolean: #0000ff;
  --jt-null: #808080;
  --jt-key: #001080;
  --jt-bracket: #000000;
  --jt-indent: 1.2em;
  --jt-font-size: 13px;
  --jt-font-family: 'SF Mono', monospace;
}
```

All colors automatically adapt to dark mode using `light-dark()`.
