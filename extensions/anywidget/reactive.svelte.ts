// Reactive bridge helpers for the MatterViz anywidget.
//
// Lives in a `.svelte.ts` module so it can use runes ($state/$effect) to make
// widget props two-way reactive:
//   - Python trait changes flow into the mounted Svelte component (drive), so
//     ipywidgets link()/observe()/manual assignment updates the live view.
//   - Component interaction state (selected sites, current step, ...) flows back
//     to Python (writeback), so user interaction can drive other linked widgets.
// Without this, the bridge was fire-once: props were read at mount and never
// synced in either direction.

import type { AnyModel } from 'anywidget/types'

// Read a trait, mapping null/undefined (and read errors for absent traits) to
// undefined so missing values are simply omitted from the component props.
export const get_prop = (model: AnyModel, key: string): unknown => {
  try {
    return model.get(key) ?? undefined
  } catch {
    return undefined
  }
}

// Structural equality good enough for JSON-able trait values. Used to skip no-op
// reads/writes and thereby break Python<->JS echo loops. null and undefined are
// treated as equal so an unset trait doesn't trigger a spurious writeback.
const equal = (val_a: unknown, val_b: unknown): boolean => {
  const a = val_a ?? null
  const b = val_b ?? null
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== `object` || typeof b !== `object`) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

// Next monotonic event id for a click-style trait (read from the trait's own
// current `event_id`, so it survives re-mounts of the same widget model). Lets
// repeated identical clicks become distinct trait values -- traitlets/Backbone
// skip equal reassignments, so without this a repeat click of the same point
// would not notify Python.
export const next_event_id = (model: AnyModel, key: string): number => {
  const prev = get_prop(model, key) as { event_id?: number } | undefined
  return (prev?.event_id ?? 0) + 1
}

// Set a trait and flush it to Python, but only when the value actually changed
// (guards against echo loops when the same value just arrived from Python).
export const set_model = (model: AnyModel, key: string, value: unknown): void => {
  const next = value === undefined ? null : value
  if (equal(get_prop(model, key), next)) return // equal() treats undefined as null
  model.set(key, next)
  model.save_changes()
}

export interface Throttled<Args extends unknown[]> {
  (...args: Args): void
  // Cancel a pending trailing call (e.g. on widget cleanup) so it can't fire
  // after unmount.
  cancel: () => void
}

// Trailing-edge throttle for high-frequency writebacks (e.g. pointer hover) so
// they don't flood the Jupyter comm channel.
export const throttle = <Args extends unknown[]>(
  fn: (...args: Args) => void,
  ms: number,
): Throttled<Args> => {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let queued: Args | null = null
  const clear = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    queued = null
  }
  const invoke = (args: Args): void => {
    last = Date.now()
    fn(...args)
  }
  const throttled = ((...args: Args): void => {
    const elapsed = Date.now() - last
    if (elapsed >= ms) {
      clear() // drop any stale trailing call so it can't fire after this fresher one
      invoke(args)
      return
    }
    queued = args
    timer ??= setTimeout(() => {
      timer = null
      const pending = queued
      queued = null
      if (pending) invoke(pending)
    }, ms - elapsed)
  }) as Throttled<Args>
  throttled.cancel = clear
  return throttled
}

export interface ReactiveWidget {
  // Reactive ($state) props object to pass straight into Svelte's mount().
  props: Record<string, unknown>
  // Unregister model listeners and stop writeback effects (call on cleanup).
  dispose: () => void
}

// Build a reactive $state props object mirroring the model's traits:
//   - drive_keys: Python -> JS (`change:<key>` updates props[key])
//   - writeback_keys: JS -> Python ($bindable the component mutates is pushed back
//     via set_model, deduped to avoid loops)
//   - extra: static props/callbacks merged in, not synced
// Keys can appear in both lists for full two-way sync.
export function reactive_widget(
  model: AnyModel,
  drive_keys: readonly string[],
  writeback_keys: readonly string[] = [],
  extra: Record<string, unknown> = {},
): ReactiveWidget {
  const writeback_set = new Set(writeback_keys)

  // Seed props. Omit undefined so the component uses its fallback: passing undefined
  // for a $bindable-with-fallback via a $state props object trips props_invalid_value.
  const initial: Record<string, unknown> = { ...extra }
  for (const key of drive_keys) {
    const value = get_prop(model, key)
    if (value !== undefined) initial[key] = value
  }
  // Writeback keys must be present + defined at mount to establish the binding;
  // null is fine (only undefined is rejected). An absent/None trait seeds null, so
  // array-typed writeback keys MUST be non-nullable Python-side (e.g. List(default=[])),
  // else the component gets null and crashes on .length/.includes.
  for (const key of writeback_keys) {
    const value = get_prop(model, key)
    initial[key] = value === undefined ? null : value
  }
  const props = $state(initial)

  const unsubs: (() => void)[] = []

  // Python -> JS
  for (const key of drive_keys) {
    const handler = (): void => {
      const next = get_prop(model, key)
      // common path: a new value arrived from Python
      if (next !== undefined) {
        if (!equal(props[key], next)) props[key] = next
      } else if (writeback_set.has(key)) {
        // trait cleared (None): writeback keys stay bound, reverting to null
        if (props[key] !== null) props[key] = null
      } else if (key in props) {
        // trait cleared (None): drop drive-only keys so the component falls back
        delete props[key]
      }
    }
    model.on(`change:${key}`, handler)
    unsubs.push(() => model.off(`change:${key}`, handler))
  }

  // JS -> Python (only meaningful for $bindable props the component writes to)
  if (writeback_keys.length > 0) {
    const stop = $effect.root(() => {
      for (const key of writeback_keys) {
        $effect(() => {
          const value = $state.snapshot(props[key])
          set_model(model, key, value)
        })
      }
    })
    unsubs.push(stop)
  }

  return { props, dispose: () => unsubs.forEach((fn) => fn()) }
}
