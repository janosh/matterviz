// Linked hover between viewers on one page: hovering a mark in one viewer highlights the same
// entity in the others, both ways. A host calls hover_links() during init; each viewer whose
// `link_hover` prop names a channel joins it (join_hover_link), publishes the key of what it
// hovers (an entry id, a q-point or site index) and reads the key another member hovers into
// its existing highlight props. Channels live in the host's context, so separate hosts, pages
// and nested viewers never cross-talk, and the channels of one host stay apart.
import { getContext, setContext, untrack } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'

type KeyKinds = { string: string; number: number }
export type HoverKey = KeyKinds[keyof KeyKinds]

export class HoverLinks {
  // per channel, the hovered key and the member hovering it
  readonly #hovers = new SvelteMap<string, { key: HoverKey; member: symbol }>()

  // The key a member other than `member` hovers on `channel`
  linked = (channel: string, member: symbol): HoverKey | null => {
    const hover = this.#hovers.get(channel)
    return hover && hover.member !== member ? hover.key : null
  }

  // `member` hovers `key` on `channel`; null ends its own hover, never another member's
  publish = (channel: string, member: symbol, key: HoverKey | null): void =>
    untrack(() => {
      const hover = this.#hovers.get(channel)
      if (key === null) {
        if (hover?.member === member) this.#hovers.delete(channel)
      } else if (hover?.key !== key || hover.member !== member) {
        this.#hovers.set(channel, { key, member })
      }
    })
}

// In a host, during init: the channels its viewers' `link_hover` props name. Keyed by the
// class, so a viewer can also be mounted with `context: new Map([[HoverLinks, links]])`.
export const hover_links = (): HoverLinks => setContext(HoverLinks, new HoverLinks())

export type HoverLink<Key extends HoverKey> = {
  readonly linked: Key | null // what another member of the channel hovers
  publish: (key: Key | null) => void // what this viewer hovers, null for nothing
}

// In a viewer, during init: its membership of the channel its `link_hover` prop names (none
// while undefined), whose keys are all of one `kind`. Leaving the channel or unmounting ends
// the viewer's hover there.
export function join_hover_link<Kind extends keyof KeyKinds>(
  channel: () => string | undefined,
  kind: Kind,
): HoverLink<KeyKinds[Kind]> {
  const links = getContext<HoverLinks | undefined>(HoverLinks)
  const member = Symbol(`hover-link`)
  const links_of = (name: string): HoverLinks => {
    if (links) return links
    throw new Error(`link_hover="${name}" needs hover_links() in an enclosing component`)
  }
  const is_kind = (key: HoverKey): key is KeyKinds[Kind] => typeof key === kind
  $effect(() => {
    const name = channel()
    if (name === undefined) return undefined
    const joined = links_of(name)
    return () => joined.publish(name, member, null)
  })
  return {
    get linked() {
      const name = channel()
      const key = name === undefined ? null : links_of(name).linked(name, member)
      if (key === null || is_kind(key)) return key
      throw new Error(`link_hover="${name}" carries ${kind} keys, got ${JSON.stringify(key)}`)
    },
    publish: (key) => {
      const name = channel()
      if (name !== undefined) links_of(name).publish(name, member, key)
    },
  }
}
