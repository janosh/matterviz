// Turns inline code spans that name a MatterViz source file (`Structure`, `Trajectory.svelte`,
// `bonding.ts`) into links to that file on GitHub, so docs pages never hand-maintain source
// URLs. Only exact, unambiguous names match: `index.ts` exists in many folders and `src` is a
// prop, so neither links.
import pkg from '$root/package.json'

const SOURCE_PATHS = Object.keys(import.meta.glob(`$lib/**/*.{svelte,ts}`))

// name → repo path, or null once two files claim the same name
const path_by_name = new Map<string, string | null>()
const register = (name: string, path: string): void => {
  path_by_name.set(name, path_by_name.has(name) ? null : path)
}
for (const path of SOURCE_PATHS) {
  const basename = path.split(`/`).pop() ?? path
  register(basename, path)
  // Components are referred to by bare name far more often than by file name
  if (basename.endsWith(`.svelte`)) register(basename.slice(0, -`.svelte`.length), path)
}

export const source_path = (name: string): string | undefined =>
  path_by_name.get(name.trim()) ?? undefined

export const source_href = (name: string): string | undefined => {
  const path = source_path(name)
  return path && `${pkg.repository}/blob/main${path}`
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
      const path = source_path(code.textContent ?? ``)
      if (!path) continue
      linked.add(code)
      const link = document.createElement(`a`)
      link.href = `${pkg.repository}/blob/main${path}`
      link.target = `_blank`
      link.rel = `noopener`
      link.title = `Source: ${path.replace(/^\//, ``)}`
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
