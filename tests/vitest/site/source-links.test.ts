import { link_source_mentions, source_href, source_path } from '$site/source-links'
import { describe, expect, it } from 'vitest'

describe(`source links`, () => {
  it.each([
    [`TrajectoryFileViewer`, `/src/lib/trajectory/TrajectoryFileViewer.svelte`],
    [`Structure.svelte`, `/src/lib/structure/Structure.svelte`],
    [` bonding.ts `, `/src/lib/structure/bonding.ts`],
    [`index.ts`, undefined], // one per folder: ambiguous
    [`src`, undefined], // a prop, not a file
    [`structure`, undefined], // folders and lower-case names never link
  ])(`resolves %j to %j`, (name, path) => {
    expect(source_path(name)).toBe(path)
    expect(source_href(name)).toBe(
      path && `https://github.com/janosh/matterviz/blob/main${path}`,
    )
  })

  it(`links matching code spans in place, skipping pre blocks and existing links`, async () => {
    const root = document.createElement(`main`)
    root.innerHTML =
      `<p><code>Structure</code> and <code>src</code></p>` +
      `<pre><code>Structure</code></pre><a href="/x"><code>Structure</code></a>`
    document.body.append(root)
    const detach = link_source_mentions(root)
    await new Promise(requestAnimationFrame)
    const links = root.querySelectorAll(`code > a`)
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute(`href`)).toBe(
      `https://github.com/janosh/matterviz/blob/main/src/lib/structure/Structure.svelte`,
    )
    expect(links[0].textContent).toBe(`Structure`)
    // late-arriving content is picked up too
    root.insertAdjacentHTML(`beforeend`, `<p><code>Trajectory</code></p>`)
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    expect(root.querySelectorAll(`code > a`)).toHaveLength(2)
    detach()
    root.remove()
  })
})
