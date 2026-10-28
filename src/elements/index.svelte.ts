// Custom elements (<mv-structure>, <mv-periodic-table>, ...) for pages without Svelte. Each
// element mounts its MatterViz component into its own light DOM, so tooltips the components
// portal to <body> keep their styles. Bundled into dist/elements/ by ./vite.config.ts.
import { watch_theme } from '#lib/theme/embedded'
import { disable_workers } from '#lib/worker-client.svelte'
import { mount, unmount } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import elements, { css } from 'virtual:matterviz-elements'

const tags = Object.keys(elements)
const defined = tags.filter((tag) => customElements.get(tag))
if (defined.length) {
  throw new Error(`MatterViz elements loaded twice: ${defined.join(`, `)} already defined`)
}

// Bundled workers load relative to this file, which browsers refuse cross-origin (a CDN copy)
// and from file:// (origin `null`), so jobs there run on the main thread
const { origin } = new URL(import.meta.url)
if (origin === `null` || origin !== location.origin) disable_workers()

// First in <head>, so the page's own stylesheets win where they set the same tokens
const style = document.createElement(`style`)
style.id = `matterviz-elements`
style.textContent = css
document.head.prepend(style)

// A bare attribute (`<mv-structure show_controls>`) is true, values that parse as JSON
// (`false`, `400`, `[1, 2]`) arrive parsed, anything else as a string
const parse_attribute = (value: string): unknown => {
  if (value === ``) return true
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

// What Svelte expects of a bound value: components mutate bindable props in place (e.g.
// Structure's scene_props), which re-renders only through a $state proxy
const as_state = <T>(value: T): T => {
  const state = $state(value)
  return state
}

for (const [tag, spec] of Object.entries(elements)) {
  const { load, props: prop_names, seeded } = spec
  const bindable = new Set(spec.bindable)

  class MatterVizElement extends HTMLElement {
    static observedAttributes = prop_names
    // Set props, reactive per key. Only bindable ones become $state proxies, so `el.x = obj`
    // keeps obj itself for every other prop.
    readonly #values = new SvelteMap<string, unknown>()
    // Props the page set, as opposed to ones the component wrote back into seeded keys
    readonly #page_set = new Set<string>()
    // The component's props. Keys set at mount get a setter, through which Svelte writes
    // bindable props back (e.g. the structure a `source` loads) for the accessors to read.
    readonly #props = new Proxy(
      {},
      {
        get: (_, key) => (typeof key === `string` ? this.#values.get(key) : undefined),
        has: (_, key) => typeof key === `string` && this.#values.has(key),
        ownKeys: () => [...this.#values.keys()],
        getOwnPropertyDescriptor: (_, key) =>
          typeof key === `string` && this.#values.has(key)
            ? {
                get: () => this.#values.get(key),
                set: (value: unknown) => this.#store(key, value),
                enumerable: true,
                configurable: true,
              }
            : undefined,
      },
    )
    readonly #internals = this.attachInternals()
    #app: Record<string, unknown> | undefined
    #stop_theme: (() => void) | undefined

    static {
      for (const name of prop_names) {
        Object.defineProperty(this.prototype, name, {
          get(this: MatterVizElement) {
            return this.#values.get(name)
          },
          set(this: MatterVizElement, value: unknown) {
            this.#set(name, value)
          },
        })
      }
    }

    constructor() {
      super()
      // A framework may set props before this bundle defines the element; those own
      // properties would shadow the accessors, so move them into the props
      const own = this as unknown as Record<string, unknown>
      for (const name of prop_names) {
        if (!Object.hasOwn(this, name)) continue
        const value = own[name]
        Reflect.deleteProperty(own, name)
        this.#set(name, value)
      }
    }

    #set(name: string, value: unknown) {
      if (value === undefined) this.#page_set.delete(name)
      else this.#page_set.add(name)
      this.#store(name, value)
    }

    // Unset props leave the map: Svelte rejects an undefined key whose prop has a default
    #store(name: string, value: unknown) {
      if (value === undefined) this.#values.delete(name)
      else this.#values.set(name, bindable.has(name) ? as_state(value) : value)
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
      this.#set(name, value === null ? undefined : parse_attribute(value))
    }

    async connectedCallback() {
      // The page theme, read from this element's ancestors (which a DOM move changes), as a
      // :state() the stylesheet maps to color-scheme, so an inline color-scheme still wins
      this.#stop_theme?.()
      this.#stop_theme = watch_theme(this, (theme) => {
        this.#internals.states.delete(theme === `dark` ? `light` : `dark`)
        this.#internals.states.add(theme)
      })
      if (this.#app) return
      const { default: component } = await load()
      if (!this.isConnected || this.#app) return
      // Bindable props without a default write back only if their key exists at mount, where
      // undefined is their own value rather than an unset marker
      for (const name of seeded) {
        if (!this.#values.has(name)) this.#values.set(name, undefined)
      }
      this.#app = mount(component, { target: this, props: this.#props })
    }

    disconnectedCallback() {
      // A move through the DOM disconnects and reconnects in one task: keep the mounted
      // component (and its WebGL context) instead of rebuilding it
      queueMicrotask(() => {
        if (this.isConnected) return
        this.#stop_theme?.()
        this.#stop_theme = undefined
        if (this.#app) void unmount(this.#app)
        this.#app = undefined
        // What the component wrote back (its scene, camera, parsed structure) belongs to it:
        // a later mount starts from the page's props only
        for (const name of this.#values.keys()) {
          if (!this.#page_set.has(name)) this.#values.delete(name)
        }
      })
    }
  }

  customElements.define(tag, MatterVizElement)
}
