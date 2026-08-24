// Turns inline code spans that name MatterViz source into GitHub links so docs pages never
// hand-maintain source URLs: a file (`Structure`, `Trajectory.svelte`, `bonding.ts`) links to
// the file, an exported definition (`TrajectoryRun`, `open_trajectory`) to its line. Only
// exact, unambiguous names match: `index.ts` exists in many folders and `src` is a prop, so
// neither links. Links pin the commit the site was built from so line numbers stay right.
import pkg from '$root/package.json'
import { files, ref, symbols } from 'virtual:source-symbols'

// name → repo path (with `#Lline` for definitions), or null once two files claim the name
const location_by_name = new Map<string, string | null>()
const register = (name: string, location: string): void => {
  location_by_name.set(name, location_by_name.has(name) ? null : location)
}
for (const path of files) {
  const basename = path.split(`/`).pop() ?? path
  register(basename, path)
  // Components are referred to by bare name far more often than by file name
  if (basename.endsWith(`.svelte`)) register(basename.slice(0, -`.svelte`.length), path)
}
for (const [name, location] of Object.entries(symbols)) {
  if (!location_by_name.has(name)) location_by_name.set(name, location)
}

export const source_location = (name: string): string | undefined =>
  location_by_name.get(name.trim()) ?? undefined

export const source_href = (name: string): string | undefined => {
  const location = source_location(name)
  return location && `${pkg.repository}/blob/${ref}${location}`
}

// Svelte attachment: links every matching <code> under `root`, now and as content arrives
// (client-side navigation swaps the page inside the same <main>). The anchor goes inside the
// code element and adopts its existing child nodes, so Svelte's references to those nodes
// (dynamic text, block boundaries) stay valid.
export function link_source_mentions(root: HTMLElement): () => void {
  const linked = new WeakSet<Element>()
  const scan = (): void => {
    for (const code of root.querySelectorAll(`code`)) {
      if (linked.has(code) || code.closest(`a, pre`)) continue
      const location = source_location(code.textContent ?? ``)
      if (!location) continue
      linked.add(code)
      const link = document.createElement(`a`)
      link.href = `${pkg.repository}/blob/${ref}${location}`
      link.target = `_blank`
      link.rel = `noopener`
      link.title = `Source: ${location.replace(/^\//, ``)}`
      link.append(...code.childNodes)
      code.append(link)
    }
  }
  let frame = 0
  const schedule = (): void => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(scan)
  }
  schedule()
  const observer = new MutationObserver(schedule)
  observer.observe(root, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
  }
}
