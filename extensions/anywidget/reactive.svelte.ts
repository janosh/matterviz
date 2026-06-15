// Reactive bridge helpers for the MatterViz anywidget. This `.svelte.ts` module
// uses runes ($state/$effect) to make widget props two-way reactive: Python trait
// changes drive the mounted Svelte view (ipywidgets link()/observe()/assignment),
// and component interaction state (selected sites, current step, ...) writes back
// to Python so user actions can drive linked widgets. Without this, the bridge
// was fire-once: props were read at mount and never synced either way.
//
// Why not @anywidget/svelte: it targets one purpose-built widget with a `bindings`
// prop that binds every trait two-way. We adapt ~20 existing matterviz components,
// each with its own prop API / $bindables, via explicit per-widget contracts:
// drive-generic, writeback-opt-in, plus trait renames, derived/composed props,
// throttling and click event_ids. Wrapping @anywidget/svelte would mostly
// reimplement it, so we use AFM's model API (on/get/set/save_changes) directly.

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
// JSON.stringify is key-order-sensitive, but trait payloads are built with stable
// key order by the bridge.
const equal = (val_a: unknown, val_b: unknown): boolean => {
  const norm_a = val_a ?? null
  const norm_b = val_b ?? null
  if (norm_a === norm_b) return true
  if (norm_a === null || norm_b === null) return false
  if (typeof norm_a !== `object` || typeof norm_b !== `object`) return false
  return JSON.stringify(norm_a) === JSON.stringify(norm_b)
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

// One reactive component prop, described uniformly so the engine can handle plain
// driven keys, renamed traits, and props composed from several traits the same way:
//   - prop:    the component prop name
//   - deps:    model traits to listen on; a `change:<dep>` recomputes this prop
//   - compute: derive the value from the model; undefined => use the component's own
//              fallback (the prop is omitted at mount / deleted on clear)
//   - writeback: also push prop -> trait via set_model ($bindable the component mutates)
//   - fallback:  seed/revert value for a writeback prop whose trait is absent/None
//                (null would crash components that expect [], 0, ...)
export type DrivenProp = {
  prop: string
  deps: readonly string[]
  compute: (model: AnyModel) => unknown
  writeback?: boolean
  fallback?: unknown
}

// Spec backed by reading a single trait (the prop name may differ from the trait).
const trait_prop = (trait: string, prop: string): DrivenProp => ({
  prop,
  deps: [trait],
  compute: (model) => get_prop(model, trait),
})

// Plain driven key (trait name == component prop name).
export const drive_prop = (key: string): DrivenProp => trait_prop(key, key)

export const drive_props = (keys: readonly string[]): DrivenProp[] => keys.map(drive_prop)

// Driven trait surfaced under a different component prop name.
export const rename_prop = (trait: string, prop: string): DrivenProp => trait_prop(trait, prop)

// Prop composed from several traits; recomputed whenever any dep changes.
export const derived_prop = (
  prop: string,
  deps: readonly string[],
  compute: (model: AnyModel) => unknown,
): DrivenProp => ({ prop, deps, compute })

// Two-way prop: driven from Python AND written back on component mutation. fallback
// seeds/reverts the value when the trait is absent/None.
export const writeback_prop = (prop: string, fallback?: unknown): DrivenProp => ({
  ...trait_prop(prop, prop),
  writeback: true,
  fallback,
})

export interface ReactiveWidget {
  // Reactive ($state) props object to pass straight into Svelte's mount().
  props: Record<string, unknown>
  // Unregister model listeners and stop writeback effects (call on cleanup).
  dispose: () => void
}

// Build a reactive $state props object from a list of DrivenProps plus static
// `extra` props (callbacks etc. that aren't synced). Python -> JS: a `change:<dep>`
// recomputes every prop that depends on it. JS -> Python: each writeback prop is
// pushed back via set_model (deduped to avoid echo loops).
export function reactive_widget(
  model: AnyModel,
  driven: readonly DrivenProp[],
  extra: Record<string, unknown> = {},
): ReactiveWidget {
  // Compute a prop's value, falling back to its writeback default (else undefined).
  const value_of = (spec: DrivenProp): unknown => {
    const value = spec.compute(model)
    if (value !== undefined) return value
    return spec.writeback ? (spec.fallback ?? null) : undefined
  }

  // Seed props. Omit undefined drive-only props so the component uses its own
  // fallback: passing undefined for a $bindable-with-fallback via a $state props
  // object trips Svelte's props_invalid_value. Writeback props are always seeded
  // (their fallback, never undefined) so the two-way binding is established.
  const initial: Record<string, unknown> = { ...extra }
  for (const spec of driven) {
    const value = value_of(spec)
    if (value !== undefined) initial[spec.prop] = value
  }
  const props = $state(initial)

  // Re-apply one prop after a relevant trait changed.
  const apply = (spec: DrivenProp): void => {
    const value = value_of(spec)
    if (value !== undefined) {
      if (!equal(props[spec.prop], value)) props[spec.prop] = value
    } else if (spec.prop in props) {
      // drive-only trait cleared (None): drop the key so the component falls back
      delete props[spec.prop]
    }
  }

  // Map each trait to the props that depend on it (a trait may feed several props,
  // a prop may have several deps), so one listener per trait recomputes them all.
  const specs_by_dep = new Map<string, DrivenProp[]>()
  for (const spec of driven) {
    for (const dep of spec.deps) {
      const list = specs_by_dep.get(dep) ?? []
      list.push(spec)
      specs_by_dep.set(dep, list)
    }
  }

  const unsubs: (() => void)[] = []

  // Python -> JS
  for (const [dep, specs] of specs_by_dep) {
    const handler = (): void => specs.forEach(apply)
    model.on(`change:${dep}`, handler)
    unsubs.push(() => model.off(`change:${dep}`, handler))
  }

  // JS -> Python (one $effect per writeback prop so each tracks only its own key)
  const writeback_specs = driven.filter((spec) => spec.writeback)
  if (writeback_specs.length > 0) {
    const stop = $effect.root(() => {
      for (const spec of writeback_specs) {
        $effect(() => {
          const value = $state.snapshot(props[spec.prop])
          // Only write genuine component mutations: skip values still matching the
          // model-derived value (the mount seed/fallback, or a Python clear/drive
          // echo), so an absent/None trait doesn't save_changes() before interaction.
          if (!equal(value, value_of(spec))) set_model(model, spec.prop, value)
        })
      }
    })
    unsubs.push(stop)
  }

  return { props, dispose: () => unsubs.forEach((fn) => fn()) }
}
