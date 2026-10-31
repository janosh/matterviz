import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname } from 'node:path'
import { open_settings_pane } from './helpers'

// The prebuilt custom-element bundle (src/elements) on a plain HTML page: no Svelte, no bundler.
// Served from a routed https origin (navigator.gpu needs a secure context) so worker and chunk
// URLs resolve as on any static host.
const origin = `https://elements.test`
const cif_path = `src/site/structures/LiFePO4.cif`
const h5_path = `src/site/trajectories/flame-gold-cluster-55-atoms.h5`
let dist_dir = ``

const page_html = (body: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`

test.describe(`custom-element bundle`, () => {
  // build once for the whole file (not once per parallel worker), inside the hook's timeout
  test.describe.configure({ mode: `serial`, timeout: 120_000 })

  test.beforeAll(() => {
    dist_dir = mkdtempSync(`${tmpdir()}/matterviz-elements-`)
    const args = [`build`, `--config`, `src/elements/vite.config.ts`, `--outDir`, dist_dir]
    execFileSync(`pnpm`, [`exec`, `vp`, ...args], { stdio: `pipe` })
  })
  test.afterAll(() => rmSync(dist_dir, { recursive: true, force: true }))

  test.beforeEach(async ({ context }) => {
    await context.route(`${origin}/**`, (route) => {
      const { pathname } = new URL(route.request().url())
      if (pathname === `/structure.cif`) return route.fulfill({ path: cif_path })
      if (pathname === `/trajectory.h5`) return route.fulfill({ path: h5_path })
      if (extname(pathname) === `.js`) return route.fulfill({ path: `${dist_dir}${pathname}` })
      return route.fulfill({ status: 404 })
    })
  })

  test(`mv-structure loads a source attribute, reads the structure back and leaves the page styles alone`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on(`pageerror`, (error) => errors.push(error.message))
    await page.emulateMedia({ colorScheme: `dark` })
    await page.route(`${origin}/`, (route) =>
      route.fulfill({
        contentType: `text/html`,
        body: page_html(`
          <table><tbody><tr><td>host</td></tr></tbody></table>
          <button>host</button>
          <section data-theme="light"></section>
          <mv-structure source="/structure.cif" show_controls="false" style="height: 400px"></mv-structure>
          <script type="module" src="/matterviz-elements.js"></script>`),
      }),
    )
    await page.goto(`${origin}/`)

    const element = page.locator(`mv-structure`)
    await expect(element.locator(`canvas`)).toBeVisible()
    // `structure` is bindable: the component writes the parsed file back through the accessor,
    // as the plain object (structuredClone throws on a $state proxy, whose every read of a
    // 30k-site structure went through proxy traps)
    await expect
      .poll(() => element.evaluate((node) => Reflect.get(node, `structure`)?.sites?.length))
      .toBe(28)
    expect(
      await element.evaluate(
        (node) => structuredClone(Reflect.get(node, `structure`)).sites.length,
      ),
    ).toBe(28)
    // JSON attribute values arrive parsed, other strings verbatim, a removed attribute unsets
    expect(await element.evaluate((node) => Reflect.get(node, `show_controls`))).toBe(false)
    expect(await element.evaluate((node) => Reflect.get(node, `source`))).toBe(
      `/structure.cif`,
    )
    await element.evaluate((node) => node.removeAttribute(`show_controls`))
    expect(
      await element.evaluate((node) => Reflect.get(node, `show_controls`)),
    ).toBeUndefined()
    // the element follows the (dark) page theme on itself, and hides like any element
    expect(await element.evaluate((node) => getComputedStyle(node).colorScheme)).toBe(`dark`)
    expect(await element.evaluate((node) => getComputedStyle(node).display)).toBe(`block`)
    await element.evaluate((node) => node.toggleAttribute(`hidden`, true))
    expect(await element.evaluate((node) => getComputedStyle(node).display)).toBe(`none`)
    await element.evaluate((node) => node.toggleAttribute(`hidden`, false))

    // app.css stays off the host page (no demo-site shell, root color-scheme or bare-element
    // rules) while applying inside the elements (pointer cursor on their buttons)
    const host_and_inner_styles = () =>
      page.evaluate(() => {
        const style_of = (selector: string) =>
          getComputedStyle(document.querySelector(selector) as Element)
        return {
          body_padding: getComputedStyle(document.body).padding,
          root_scheme: getComputedStyle(document.documentElement).colorScheme,
          table_display: style_of(`table`).display,
          button_border: style_of(`body > button`).borderStyle,
          button_cursor: style_of(`body > button`).cursor,
          inner_button_cursor: style_of(`mv-structure button`).cursor,
        }
      })
    expect(await host_and_inner_styles()).toEqual({
      body_padding: `0px`,
      root_scheme: `normal`,
      table_display: `table`,
      button_border: `outset`,
      button_cursor: `default`,
      inner_button_cursor: `pointer`,
    })

    // a DOM move keeps the mounted component and its canvas past the deferred unmount, and
    // the theme follows the new ancestors (a light-themed section)
    const same_canvas_after_move = await element.evaluate(async (node) => {
      const canvas = node.querySelector(`canvas`)
      document.querySelector(`section`)?.append(node)
      await new Promise((resolve) => setTimeout(resolve, 0))
      return node.querySelector(`canvas`) === canvas
    })
    expect(same_canvas_after_move).toBe(true)
    await expect
      .poll(() => element.evaluate((node) => getComputedStyle(node).colorScheme))
      .toBe(`light`)
    // an inline color-scheme overrides the detected theme
    await element.evaluate((node) => (node.style.colorScheme = `dark`))
    expect(await element.evaluate((node) => getComputedStyle(node).colorScheme)).toBe(`dark`)

    // a real remount starts from the page's props: the old instance's parsed structure is gone
    // until the new one loads `source` again
    const structure_after_removal = await element.evaluate(async (node) => {
      const parent = node.parentElement
      node.remove()
      await new Promise((resolve) => setTimeout(resolve, 0))
      const left = Reflect.get(node, `structure`)
      parent?.append(node)
      return left
    })
    expect(structure_after_removal).toBeUndefined()
    await expect
      .poll(() => element.evaluate((node) => Reflect.get(node, `structure`)?.sites?.length))
      .toBe(28)
    expect(errors).toEqual([])
  })

  // set before mount (attribute) Svelte takes the bound-prop path, after mount (property) the
  // plain one: either way Structure's `a` shortcut mutates scene_props in place
  for (const when of [`before mount`, `after mount`] as const) {
    test(`a config object set ${when} re-renders when the component mutates it`, async ({
      page,
    }) => {
      const attr = when === `before mount` ? `scene_props='{"atom_radius": 0.5}'` : ``
      await page.route(`${origin}/`, (route) =>
        route.fulfill({
          contentType: `text/html`,
          body: page_html(`
            <mv-structure source="/structure.cif" ${attr} style="height: 400px"></mv-structure>
            <script type="module" src="/matterviz-elements.js"></script>`),
        }),
      )
      await page.goto(`${origin}/`)

      const element = page.locator(`mv-structure`)
      await expect(element.locator(`canvas`)).toBeVisible()
      if (when === `after mount`) {
        await element.evaluate((node) =>
          Reflect.set(node, `scene_props`, { atom_radius: 0.5 }),
        )
      }
      const pane = await open_settings_pane(page)
      const atoms = pane.getByRole(`checkbox`, { name: `Atoms`, exact: true })
      await expect(atoms).toBeChecked()
      await element.locator(`.structure`).focus()
      for (const checked of [false, true]) {
        await page.keyboard.press(`a`)
        await expect(atoms).toBeChecked({ checked })
      }
      expect(
        await element.evaluate((node) => {
          const { atom_radius, show_atoms } = Reflect.get(node, `scene_props`)
          return { atom_radius, show_atoms }
        }),
      ).toEqual({ atom_radius: 0.5, show_atoms: true })
    })
  }

  test(`props set before the bundle defines an element reach its component unproxied`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on(`pageerror`, (error) => errors.push(error.message))
    await page.route(`${origin}/`, (route) =>
      route.fulfill({
        contentType: `text/html`,
        body: page_html(`
          <mv-periodic-table></mv-periodic-table>
          <script>
            // a framework assigning props before the custom element is defined
            window.heatmap = { H: 1, He: 2, Fe: 3 }
            document.querySelector('mv-periodic-table').heatmap_values = window.heatmap
          </script>
          <script type="module" src="/matterviz-elements.js"></script>
          <script type="module" src="/matterviz-elements.js?again"></script>`),
      }),
    )
    await page.goto(`${origin}/`)

    const table = page.locator(`mv-periodic-table`)
    // 118 elements plus the lanthanide and actinide placeholders
    await expect(table.locator(`.element-tile`)).toHaveCount(120)
    await expect(table.locator(`div.colorbar`)).toBeVisible()
    expect(
      await table.evaluate((node) => ({
        own: Object.hasOwn(node, `heatmap_values`),
        same: Reflect.get(node, `heatmap_values`) === Reflect.get(globalThis, `heatmap`),
      })),
    ).toEqual({ own: false, same: true })
    // later assignments re-render: dropping the heatmap removes its color bar
    await table.evaluate((node) => Reflect.set(node, `heatmap_values`, undefined))
    await expect(table.locator(`div.colorbar`)).toHaveCount(0)

    // props that share a name with HTMLElement members (a plot's title) are the component's
    expect(
      await page.evaluate(() =>
        Boolean(
          Object.getOwnPropertyDescriptor(
            customElements.get(`mv-scatter-plot`)?.prototype ?? {},
            `title`,
          ),
        ),
      ),
    ).toBe(true)
    // a second copy of the bundle fails loudly instead of half-defining its tags
    expect(errors).toEqual([expect.stringContaining(`MatterViz elements loaded twice`)])
  })

  test(`mv-trajectory parses HDF5 in its self-contained worker`, async ({ page }) => {
    const workers: string[] = []
    page.on(`worker`, (worker) => workers.push(new URL(worker.url()).pathname))
    await page.route(`${origin}/`, (route) =>
      route.fulfill({
        contentType: `text/html`,
        body: page_html(`
          <mv-trajectory source="/trajectory.h5" style="height: 400px"></mv-trajectory>
          <script type="module" src="/matterviz-elements.js"></script>`),
      }),
    )
    await page.goto(`${origin}/`)

    const element = page.locator(`mv-trajectory`)
    await expect
      .poll(() => element.evaluate((node) => Reflect.get(node, `trajectory`)?.frame_count))
      .toBe(20)
    expect(workers.some((path) => path.startsWith(`/assets/parse-worker-`))).toBe(true)
    // three's DRACO/KTX2 decoders, which nothing in the bundle loads, aren't shipped
    expect(
      readdirSync(`${dist_dir}/assets`).filter((name) => /draco|basis/.test(name)),
    ).toEqual([])
  })
})
