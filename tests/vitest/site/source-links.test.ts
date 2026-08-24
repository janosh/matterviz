import { link_source_mentions, source_href, source_location } from '$site/source-links'
import { ref } from 'virtual:source-symbols'
import { describe, expect, it } from 'vitest'

const REPO = `https://github.com/janosh/matterviz/blob/${ref}`

describe(`source links`, () => {
  it.each([
    [`TrajectoryFileViewer`, `/src/lib/trajectory/TrajectoryFileViewer.svelte`],
    [`Structure.svelte`, `/src/lib/structure/Structure.svelte`],
    [` bonding.ts `, `/src/lib/structure/bonding.ts`],
    [`index.ts`, undefined], // one per folder: ambiguous
    [`src`, undefined], // a prop, not a file
    [`structure`, undefined], // folders and lower-case names never link
  ])(`resolves %j to %j`, (name, location) => {
    expect(source_location(name)).toBe(location)
    expect(source_href(name)).toBe(location && `${REPO}${location}`)
  })

  it(`links exported definitions to their line and pins the build commit`, () => {
    expect(ref).toMatch(/^(?:[0-9a-f]{40}|main)$/)
    expect(source_location(`TrajectoryRun`)).toMatch(/^\/src\/lib\/trajectory\/run\.ts#L\d+$/)
    expect(source_location(`open_trajectory`)).toMatch(
      /^\/src\/lib\/trajectory\/open\.ts#L\d+$/,
    )
    expect(source_location(`PhononModeExplorer`)).toBe(
      `/src/lib/spectral/PhononModeExplorer.svelte`,
    )
    // defined in several files, so deliberately unlinked
    expect(source_location(`dot`)).toBeUndefined()
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
    expect(links[0].getAttribute(`href`)).toBe(`${REPO}/src/lib/structure/Structure.svelte`)
    expect(links[0].textContent).toBe(`Structure`)
    // late-arriving content is picked up too
    root.insertAdjacentHTML(`beforeend`, `<p><code>TrajectoryRun</code></p>`)
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    expect(root.querySelectorAll(`code > a`)[1]?.getAttribute(`href`)).toMatch(/run\.ts#L\d+$/)
    detach()
    root.remove()
  })
})
