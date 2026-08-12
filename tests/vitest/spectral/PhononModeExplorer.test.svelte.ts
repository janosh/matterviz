import { PhononModeExplorer, parse_phonon_modes } from '$lib/spectral'
import band_yaml from '$site/phonons/ir-raman/NaCl-Gamma-X-band.yaml?raw'
import { mount, type ComponentProps, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'
import { create_drop_event, gzip_bytes } from '../setup'

type ExplorerProps = ComponentProps<typeof PhononModeExplorer>

const render = (props: Partial<ExplorerProps>): HTMLElement => {
  const target = document.createElement(`div`)
  document.body.append(target)
  const component = mount(PhononModeExplorer, {
    target,
    props: {
      auto_play: false,
      n_frames: 4,
      supercell: [1, 1, 1],
      ...props,
    },
  })
  onTestFinished(() => unmount(component))
  return target
}

test.each([
  [`parsed mode_data`, { mode_data: parse_phonon_modes(band_yaml) }],
  [`raw yaml`, { yaml: band_yaml }],
] as [string, Partial<ExplorerProps>][])(`loads %s`, async (_name, props) => {
  const target = render(props)
  await vi.waitFor(() =>
    expect(target.querySelector(`[data-testid="phonon-mode-summary"]`)?.textContent).toContain(
      `Mode 4`,
    ),
  )
})

test(`rejects conflicting direct sources`, async () => {
  const on_error = vi.fn()
  const target = render({
    mode_data: parse_phonon_modes(band_yaml),
    yaml: band_yaml,
    on_error,
  })
  await vi.waitFor(() =>
    expect(target.querySelector(`[role="alert"]`)?.textContent).toContain(
      `Provide exactly one of mode_data, yaml, or data_url`,
    ),
  )
  expect(on_error).toHaveBeenCalledWith({
    error_msg: `Provide exactly one of mode_data, yaml, or data_url`,
    filename: undefined,
  })
})

test(`loads a raw YAML URL`, async () => {
  const fetch_mock = vi.fn(async () => new Response(band_yaml))
  vi.stubGlobal(`fetch`, fetch_mock)
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })
  const target = render({ data_url: `https://example.com/band.yaml` })
  await vi.waitFor(() =>
    expect(target.querySelector(`[data-testid="phonon-mode-summary"]`)?.textContent).toContain(
      `Mode 4`,
    ),
  )
  expect(fetch_mock).toHaveBeenCalledOnce()
})

test(`reports missing real-space lattice errors through the UI and callback`, async () => {
  const on_error = vi.fn()
  const mode_data = { ...parse_phonon_modes(band_yaml), lattice: null }
  const target = render({ mode_data, on_error })
  await vi.waitFor(() => {
    expect(target.querySelector(`[role="alert"]`)?.textContent).toContain(
      `animation needs a real-space lattice`,
    )
    expect(on_error).toHaveBeenCalledWith({
      error_msg: `Phonon mode animation needs a real-space lattice`,
      filename: undefined,
    })
  })
})

test(`loads one gzip-compressed YAML drop and reports stable file identity`, async () => {
  const on_file_load = vi.fn()
  const on_error = vi.fn()
  const target = render({ on_file_load, on_error })
  const content = await gzip_bytes(band_yaml)
  const file = new File([content], `band.yaml.gz`)
  const explorer = target.querySelector<HTMLElement>(`.phonon-mode-explorer`)
  if (!explorer) throw new Error(`Phonon explorer root not found`)
  explorer.dispatchEvent(create_drop_event(file))

  await vi.waitFor(() =>
    expect(on_file_load).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: `band.yaml`,
        source_filename: `band.yaml.gz`,
        mode_data: expect.objectContaining({ n_atoms: 2 }),
      }),
    ),
  )
  expect(on_error).not.toHaveBeenCalled()
})
