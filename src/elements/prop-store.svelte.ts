// Props for Svelte's mount(), shared by the custom elements (./index.svelte.ts) and the anywidget
// bridge (extensions/anywidget/reactive.svelte.ts): one $state.raw slot per key, so reading an
// unset key tracks that key alone. (A SvelteMap's missing-key reads track its version, which a
// write to any key bumps: WulffShape writing wulff_data from an effect re-ran itself forever.)

// A key's value as one signal, unproxied: the store picks what gets a proxy
class PropSlot {
  value = $state.raw<unknown>()
}

// `keys` get their slots up front, outside any reaction: a slot first made by a read inside an
// effect wouldn't be tracked by it. Values of keys `proxied` picks become $state proxies, which
// re-render the component when it mutates them in place (a pane toggling display.x_grid); data
// it replaces but never mutates stays unproxied (a deep proxy over a 30k-site structure put
// every read behind $state traps). The component sees held keys only: Svelte rejects an
// undefined key whose $bindable has a default, so a key is held while defined, or while
// undefined if `keep` picks it (a $bindable without a default, which writes back only if held).
// Held keys get a setter, through which Svelte writes $bindable props back.
export function prop_store(
  keys: Iterable<string>,
  proxied: (key: string) => boolean,
  keep: (key: string) => boolean,
) {
  const slots = new Map([...keys].map((key) => [key, new PropSlot()]))
  const held = new Set<string>()
  let held_keys = $state.raw<string[]>([])
  const store = (key: string, value: unknown): void => {
    const hold = value !== undefined || keep(key)
    let slot = slots.get(key)
    if (!slot) slots.set(key, (slot = new PropSlot()))
    slot.value = proxied(key) ? as_state(value) : value
    if (hold === held.has(key)) return
    if (hold) held.add(key)
    else held.delete(key)
    held_keys = [...held]
  }
  const get = (key: string): unknown => slots.get(key)?.value
  const props = new Proxy<Record<string, unknown>>(
    {},
    {
      get: (_, key) => (typeof key === `string` ? get(key) : undefined),
      set: (_, key, value) => typeof key === `string` && (store(key, value), true),
      has: (_, key) => typeof key === `string` && held_keys.includes(key),
      ownKeys: () => held_keys,
      getOwnPropertyDescriptor: (_, key) =>
        typeof key === `string` && held_keys.includes(key)
          ? {
              get: () => get(key),
              set: (value: unknown) => store(key, value),
              enumerable: true,
              configurable: true,
            }
          : undefined,
    },
  )
  return { props, store, get }
}

// A $state proxy of value (primitives pass through): what Svelte expects of a bound value a
// component mutates in place
const as_state = <T>(value: T): T => {
  const state = $state(value)
  return state
}
