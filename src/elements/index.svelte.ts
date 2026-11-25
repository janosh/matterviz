// Custom elements (<mv-structure>, <mv-periodic-table>, ...) for pages without Svelte. Each
// element mounts its MatterViz component into its own light DOM, so tooltips the components
// portal to <body> keep their styles. Bundled into dist/elements/ by ./vite.config.ts.
import { watch_theme } from '#lib/theme/embedded'
import { check_blob_workers, disable_workers } from '#lib/worker-client.svelte'
import { mount, unmount } from 'svelte'
import elements, { css } from 'virtual:matterviz-elements'
import { prop_store } from './prop-store.svelte'

const tags = Object.keys(elements)
const defined = tags.filter((tag) => customElements.get(tag))
if (defined.length) {
  throw new Error(`MatterViz elements loaded twice: ${defined.join(`, `)} already defined`)
}

// Bundled workers load relative to this file: never from file:// (origin `null`), and from
// another origin (a CDN copy) via cross-origin-worker.ts's blob: shim, if the page's CSP allows
const { origin } = new URL(import.meta.url)
if (origin === `null`) disable_workers()
else if (origin !== location.origin) await check_blob_workers(`MatterViz elements`)

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

// Bindable data the components replace but never mutate in place, so it stays unproxied: a
// deep proxy over a 30k-site structure (set by the page or parsed from `source`) put every
// read behind $state traps and took mv-structure 2.8 s to render
const DATA_PROPS = new Set(
  `structure bonds fermi_data band_data bz_data trajectory volumetric_data`.split(` `),
)

for (const [tag, spec] of Object.entries(elements)) {
  const { load, props: prop_names, seeded } = spec
  // only bindable props outside DATA_PROPS become proxies: `el.x = obj` keeps obj for the rest
  const proxied = new Set(spec.bindable.filter((name) => !DATA_PROPS.has(name)))

  class MatterVizElement extends HTMLElement {
    static observedAttributes = prop_names
    // The component's props, through whose setters it writes bindable props back (e.g. the
    // structure a `source` loads) for the accessors to read. Bindables without a default stay
    // held while undefined, where undefined is their own value rather than an unset marker.
    readonly #store = prop_store(
      prop_names,
      (name) => proxied.has(name),
      (name) => seeded.includes(name),
    )
    // Props the page set, as opposed to ones the component wrote back into seeded keys
    readonly #page_set = new Set<string>()
    readonly #internals = this.attachInternals()
    #app: Record<string, unknown> | undefined
    #stop_theme: (() => void) | undefined

    static {
      for (const name of prop_names) {
        Object.defineProperty(this.prototype, name, {
          get(this: MatterVizElement) {
            return this.#store.get(name)
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
      this.#store.store(name, value)
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
      const { props, store } = this.#store
      for (const name of seeded) if (!(name in props)) store(name, undefined)
      this.#app = mount(component, { target: this, props })
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
        for (const name of Object.keys(this.#store.props)) {
          if (!this.#page_set.has(name)) this.#store.store(name, undefined)
        }
      })
    }
  }

  customElements.define(tag, MatterVizElement)
}
