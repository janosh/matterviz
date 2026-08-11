import type { ReactionPath } from '$lib/neb'
import { NebViewer } from '$lib/neb'
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { create_drop_event, make_trajectory_frame } from '../setup'

const make_path = (...energies: number[]): ReactionPath => ({
  images: energies.map((energy, idx) => {
    const structure = make_trajectory_frame(idx, 1).structure
    structure.sites[0].xyz = [idx, 0, 0]
    return { energy, label: `image ${idx}`, structure }
  }),
})

let mounted_component: ReturnType<typeof mount> | undefined

const flush_render = async () => {
  flushSync()
  await tick()
}

const mount_viewer = async (props: Record<string, unknown>) => {
  const target = document.createElement(`div`)
  document.body.append(target)
  mounted_component = mount(NebViewer, { target, props })
  await flush_render()
  return target
}

afterEach(async () => {
  if (mounted_component) await unmount(mounted_component)
  mounted_component = undefined
  document.body.innerHTML = ``
  Object.defineProperty(document, `fullscreenElement`, { value: null, configurable: true })
  vi.restoreAllMocks()
})

const mount_fullscreen_viewer = async () => {
  const props = $state({
    paths: make_path(0, 1),
    fullscreen: false,
    on_fullscreen_change: vi.fn(),
  })
  const target = await mount_viewer(props)
  const wrapper = target.querySelector<HTMLDivElement>(`.neb-viewer`)
  const button = target.querySelector<HTMLButtonElement>(`.fullscreen-button`)
  if (!wrapper || !button) throw new Error(`NEB fullscreen controls not found`)
  return { props, wrapper, button }
}

describe(`NebViewer bindings`, () => {
  test(`updates path and image bindings through shared navigation`, async () => {
    const props = $state({
      paths: {
        direct: make_path(0, 1, 0.2),
        curved: make_path(0, 2, 1, 0.2),
      },
      active_path_key: `direct`,
      active_image_idx: 0,
    })
    const target = await mount_viewer(props)

    target.querySelector<HTMLButtonElement>(`button[aria-label="Next image"]`)?.click()
    await flush_render()
    expect(props.active_image_idx).toBe(1)

    const slider = target.querySelector<HTMLInputElement>(`.step-slider`)
    if (!slider) throw new Error(`NEB image slider not found`)
    slider.value = `2`
    slider.dispatchEvent(new Event(`input`, { bubbles: true }))
    await flush_render()
    expect(props.active_image_idx).toBe(2)

    const path_select = target.querySelector<HTMLSelectElement>(`.path-control select`)
    if (!path_select) throw new Error(`NEB path selector not found`)
    path_select.value = `curved`
    path_select.dispatchEvent(new Event(`change`, { bubbles: true }))
    await flush_render()
    expect(props.active_path_key).toBe(`curved`)
    expect(props.active_image_idx).toBe(0)

    props.active_image_idx = 99
    await flush_render()
    expect(props.active_image_idx).toBe(3)
  })

  test(`auto-plays images and can be paused`, async () => {
    vi.useFakeTimers()
    try {
      const props = $state({
        paths: make_path(0, 1, 0.2),
        active_image_idx: 0,
        fps: 2,
        auto_play: true,
      })
      const target = await mount_viewer(props)
      const play = target.querySelector<HTMLButtonElement>(`.play-button`)
      if (!play) throw new Error(`NEB play button not found`)

      vi.advanceTimersByTime(550)
      flushSync()
      expect(props.active_image_idx).toBe(1)

      play.click()
      flushSync()
      vi.advanceTimersByTime(1000)
      flushSync()
      expect(props.active_image_idx).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  test(`preserves arbitrary FPS values and exact ranges`, async () => {
    const props = $state({
      paths: make_path(0, 1),
      fps: 0.73,
      fps_range: [0.6, 0.9] as [number, number],
    })
    const target = await mount_viewer(props)

    expect(props.fps).toBe(0.73)
    const fps_input = target.querySelector<HTMLInputElement>(
      `.fps-section input[type="number"]`,
    )
    const fps_slider = target.querySelector<HTMLInputElement>(
      `.fps-section input[type="range"]`,
    )
    if (!fps_input || !fps_slider) throw new Error(`NEB FPS controls not found`)
    expect([fps_input.min, fps_input.max, fps_input.step, fps_input.value]).toEqual([
      `0.6`,
      `0.9`,
      `any`,
      `0.73`,
    ])
    expect([fps_slider.step, fps_slider.value]).toEqual([`any`, `0.73`])

    fps_input.value = `1.2`
    fps_input.dispatchEvent(new Event(`input`, { bubbles: true }))
    await flush_render()
    expect(props.fps).toBe(0.9)
    expect([fps_input.value, fps_slider.value]).toEqual([`0.9`, `0.9`])
  })

  test(`loads valid drops and reports invalid ones`, async () => {
    const props = $state({
      active_path_key: ``,
      active_image_idx: 1,
      error_msg: undefined as string | undefined,
    })
    const target = await mount_viewer(props)
    const wrapper = target.querySelector<HTMLElement>(`.neb-viewer`)
    if (!wrapper) throw new Error(`NEB viewer not found`)
    const content = JSON.stringify({
      format: `matterviz-reaction-path`,
      label: `dropped`,
      images: make_path(0, 2, 1).images,
    })

    wrapper.dispatchEvent(create_drop_event(new File([content], `path.json`)))
    await vi.waitFor(() => expect(props.active_path_key).toBe(`dropped`))
    expect(props.active_image_idx).toBe(0)
    expect(target.querySelector(`.scatter`)).not.toBeNull()

    vi.spyOn(console, `error`).mockImplementation(() => undefined)
    wrapper.dispatchEvent(create_drop_event(new File([`{`], `bad.json`)))
    await vi.waitFor(() =>
      expect(props.error_msg).toMatch(/bad\.json.*Failed to parse structure/),
    )
  })

  test(`keeps fullscreen state false when entry is rejected`, async () => {
    const { button, props, wrapper } = await mount_fullscreen_viewer()
    wrapper.requestFullscreen = vi.fn().mockRejectedValue(new Error(`fullscreen denied`))
    vi.spyOn(console, `error`).mockImplementation(() => undefined)

    button.click()
    await flush_render()

    expect(props.fullscreen).toBe(false)
    expect(button.getAttribute(`aria-pressed`)).toBe(`false`)
    expect(props.on_fullscreen_change).not.toHaveBeenCalled()
  })

  test(`reports successful user fullscreen entry once`, async () => {
    let fullscreen_element: Element | null = null
    Object.defineProperty(document, `fullscreenElement`, {
      configurable: true,
      get: () => fullscreen_element,
    })
    const { button, props, wrapper } = await mount_fullscreen_viewer()
    wrapper.requestFullscreen = vi.fn(async () => {
      fullscreen_element = wrapper
      document.dispatchEvent(new Event(`fullscreenchange`))
    })

    button.click()
    await flush_render()

    expect(wrapper.requestFullscreen).toHaveBeenCalledOnce()
    expect(props.fullscreen).toBe(true)
    expect(button.getAttribute(`aria-pressed`)).toBe(`true`)
    expect(props.on_fullscreen_change).toHaveBeenCalledExactlyOnceWith(true)
  })
})
