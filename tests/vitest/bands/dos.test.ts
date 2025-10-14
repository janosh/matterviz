import Dos from '$lib/bands/Dos.svelte'
import type { PhononDos } from '$lib/bands/types'
import { render } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'

const mock_dos: PhononDos = {
  frequencies: [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0],
  densities: [0.0, 1.0, 2.0, 3.0, 2.0, 1.0, 0.0],
}

describe(`Dos component`, () => {
  it(`renders single DOS`, () => {
    const { container } = render(Dos, { props: { doses: mock_dos } })
    const svg = container.querySelector(`svg`)
    expect(svg).toBeTruthy()
  })

  it(`renders multiple DOS with legend`, () => {
    const { container } = render(Dos, {
      props: { doses: { DOS1: mock_dos, DOS2: mock_dos } },
    })
    const svg = container.querySelector(`svg`)
    expect(svg).toBeTruthy()
    const legend = svg?.querySelector(`.legend`)
    expect(legend).toBeTruthy()
  })

  it.each([
    { name: `max normalization`, props: { normalize: `max` } },
    { name: `sum normalization`, props: { normalize: `sum` } },
    { name: `stacked DOS`, props: { stack: true } },
    { name: `gaussian smearing`, props: { sigma: 0.2 } },
    { name: `horizontal orientation`, props: { orientation: `horizontal` } },
    { name: `eV units`, props: { units: `eV` } },
    { name: `meV units`, props: { units: `meV` } },
  ])(`applies $name`, ({ props }) => {
    const { container } = render(Dos, {
      props: { doses: mock_dos, ...props },
    })
    expect(container.querySelector(`svg`)).toBeTruthy()
  })

  it(`handles stacked DOS with multiple entries`, () => {
    const { container } = render(Dos, {
      props: {
        doses: { DOS1: mock_dos, DOS2: mock_dos },
        stack: true,
      },
    })
    const svg = container.querySelector(`svg`)
    expect(svg).toBeTruthy()
  })

  it(`handles electronic DOS without explicit energies`, () => {
    const { container } = render(Dos, {
      props: { doses: { densities: [0.0, 1.0, 2.0, 1.0, 0.0] } },
    })
    expect(container.querySelector(`svg`)).toBeTruthy()
  })

  it(`handles multiple DOS with varying data lengths`, () => {
    const { container } = render(Dos, {
      props: {
        doses: {
          Short: { frequencies: [0.0, 1.0], densities: [1.0, 2.0] },
          Long: mock_dos,
        },
      },
    })
    expect(container.querySelector(`svg`)).toBeTruthy()
  })
})
