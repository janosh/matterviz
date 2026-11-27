import { load } from '#root/src/routes/(demos)/(hide)/icon/+page.ts'
import { expect, test } from 'vite-plus/test'

// the gallery evaluates svelte-widgets' glyph modules as data: URLs, whose `./builders.js`
// import only resolves once it is re-pointed at a data: URL of its own
test(`icon gallery loads every svelte-widgets glyph, builder-made ones included`, async () => {
  const { icons } = await load()
  expect(Object.keys(icons).length).toBeGreaterThan(1000)
  for (const name of [`Search`, `AreaPlot`, `BandsDOS`])
    expect(icons[name]).toHaveProperty(`viewBox`)
})
