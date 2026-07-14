import { readFileSync } from 'node:fs'
import process from 'node:process'
import type { PhaseData } from '$lib/convex-hull/types'
import MockThrelteNode from './MockThrelteNode.svelte'
import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock(`@threlte/core`, () => ({
  Canvas: MockThrelteNode,
  T: new Proxy({}, { get: () => MockThrelteNode }),
}))
vi.mock(`@threlte/extras`, () => ({
  HTML: MockThrelteNode,
  OrbitControls: MockThrelteNode,
  interactivity: vi.fn(),
}))

const { default: ChemPotDiagram3D } = await import(
  `$lib/chempot-diagram/ChemPotDiagram3D.svelte`
)

const chempot_3d_source = readFileSync(
  `${process.cwd()}/src/lib/chempot-diagram/ChemPotDiagram3D.svelte`,
  `utf8`,
)

const entries: PhaseData[] = [
  { composition: { Fe: 1 }, energy: -6.7, energy_per_atom: -6.7 },
  { composition: { Li: 1 }, energy: -1.9, energy_per_atom: -1.9 },
  { composition: { O: 1 }, energy: -8.0, energy_per_atom: -8.0 },
  { composition: { Fe: 1, O: 1 }, energy: -17.0, energy_per_atom: -8.5 },
  { composition: { Li: 1, O: 1 }, energy: -10.5, energy_per_atom: -5.25 },
  { composition: { Fe: 1, Li: 1, O: 2 }, energy: -29.0, energy_per_atom: -7.25 },
]

let mounted: ReturnType<typeof mount> | undefined

afterEach(() => {
  if (mounted) {
    void unmount(mounted)
    mounted = undefined
  }
})

describe(`ChemPotDiagram3D rendering contracts`, () => {
  test(`clips HTML portal labels at the component root`, () => {
    expect(chempot_3d_source).toMatch(/<extras\.HTML[\s\S]*?portal=\{wrapper\}/)
    expect(chempot_3d_source).toMatch(
      /\.chempot-diagram-3d\s*\{\s*position:\s*relative;\s*overflow:\s*clip;/,
    )
  })

  test(`sanitizes custom axis labels at the rendered raw-HTML sink`, async () => {
    Object.defineProperty(globalThis, `WebGLRenderingContext`, {
      value: class WebGLRenderingContext {
        getExtension(): null {
          return null
        }
      },
      configurable: true,
    })
    mounted = mount(ChemPotDiagram3D, {
      target: document.body,
      props: {
        entries,
        config: { elements: [`Fe`, `Li`, `O`], formal_chempots: false },
        width: 850,
        height: 650,
        controls_open: true,
        fullscreen_toggle: false,
      },
    })
    for (let idx = 0; idx < 8; idx++) await tick()

    const input = document.querySelector<HTMLInputElement>(`input[aria-label="X label"]`)
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`Expected X label input to render`)
    }
    const payload = `MZ_AXIS_SENTINEL <img src=x onerror=alert(1)> <span class="axis-unit">(eV)</span>`
    input.value = payload
    input.dispatchEvent(new Event(`input`, { bubbles: true }))
    await tick()

    const axis_label = Array.from(document.querySelectorAll<HTMLElement>(`.axis-label`)).find(
      (label) => label.textContent?.includes(`MZ_AXIS_SENTINEL`),
    )
    if (!(axis_label instanceof HTMLElement)) {
      throw new Error(`Expected custom axis label to render`)
    }
    expect(axis_label.querySelector(`img`)).toBeNull()
    expect(axis_label.innerHTML).not.toMatch(/\son\w+\s*=/i)
    expect(axis_label.querySelector(`span.axis-unit`)?.textContent).toBe(`(eV)`)
  })
})
