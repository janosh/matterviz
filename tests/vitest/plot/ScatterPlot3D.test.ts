import { ScatterPlot3D } from '$lib'
import type { DataSeries3D, Surface3DConfig } from '$lib/plot/types'
import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Smoke tests to ensure component mounts without errors.
// Meaningful 3D rendering tests require Playwright visual regression testing,
// not jsdom-based unit tests which cannot verify WebGL/Three.js output.

const basic_series: DataSeries3D = {
  x: [1, 2, 3, 4, 5],
  y: [2, 4, 6, 8, 10],
  z: [1, 1, 2, 2, 3],
  point_style: { fill: `steelblue`, radius: 5 },
  label: `Test Series`,
}

const grid_surface: Surface3DConfig = {
  type: `grid`,
  x_range: [-1, 1],
  y_range: [-1, 1],
  resolution: 10,
  z_fn: (x_coord, y_coord) => x_coord * x_coord + y_coord * y_coord,
  color: `#3498db`,
  opacity: 0.7,
}

const parametric_surface: Surface3DConfig = {
  type: `parametric`,
  u_range: [0, Math.PI * 2],
  v_range: [0, Math.PI],
  resolution: [10, 10],
  parametric_fn: (u_param, v_param) => ({
    x: Math.sin(v_param) * Math.cos(u_param) * 0.5,
    y: Math.sin(v_param) * Math.sin(u_param) * 0.5,
    z: Math.cos(v_param) * 0.5,
  }),
  opacity: 0.6,
}

const triangulated_surface: Surface3DConfig = {
  type: `triangulated`,
  points: [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0.5, y: 1, z: 0.5 },
  ],
  triangles: [[0, 1, 2]],
  opacity: 0.8,
}

describe(`ScatterPlot3D smoke tests`, () => {
  let container: HTMLDivElement
  let mounted_component: ReturnType<typeof mount> | null = null

  beforeEach(() => {
    container = document.createElement(`div`)
    document.body.appendChild(container)
    // Suppress WebGL warnings in jsdom environment
    vi.spyOn(console, `warn`).mockImplementation(() => {})
    vi.spyOn(console, `error`).mockImplementation(() => {})
  })

  afterEach(() => {
    if (mounted_component) {
      unmount(mounted_component)
      mounted_component = null
    }
    container.remove()
    vi.restoreAllMocks()
  })

  test(`mounts with series data and creates expected DOM structure`, () => {
    mounted_component = mount(ScatterPlot3D, {
      target: container,
      props: { series: [basic_series] },
    })

    expect(container.querySelector(`.scatter-3d`)).toBeTruthy()
  })

  test(`mounts with empty series without throwing`, () => {
    expect(() => {
      mounted_component = mount(ScatterPlot3D, {
        target: container,
        props: { series: [] },
      })
    }).not.toThrow()

    expect(container.querySelector(`.scatter-3d`)).toBeTruthy()
  })

  test(`mounts with all surface types`, () => {
    mounted_component = mount(ScatterPlot3D, {
      target: container,
      props: {
        series: [basic_series],
        surfaces: [grid_surface, parametric_surface, triangulated_surface],
      },
    })

    expect(container.querySelector(`.scatter-3d`)).toBeTruthy()
  })

  test(`mounts with comprehensive configuration options`, () => {
    const series_with_scales: DataSeries3D = {
      ...basic_series,
      color_values: [0, 0.25, 0.5, 0.75, 1],
      size_values: [1, 2, 3, 4, 5],
      line_style: { stroke: `red`, stroke_width: 2, line_dash: `5 3` },
    }

    mounted_component = mount(ScatterPlot3D, {
      target: container,
      props: {
        series: [series_with_scales],
        surfaces: [grid_surface],
        x_axis: { label: `X Dimension`, range: [0, 10], ticks: [1, 5, 10] },
        y_axis: { label: `Y Dimension`, range: [0, 20], ticks: 4 },
        z_axis: { label: `Z Dimension`, range: [0, 5], format: `.2f` },
        display: { show_axes: false, show_grid: false },
        camera_position: [10, 10, 10],
        camera_projection: `orthographic`,
        gizmo: false,
        auto_rotate: 2,
        color_scale: { scheme: `interpolateViridis` },
        size_scale: { radius_range: [0.05, 0.3] },
      },
    })

    expect(container.querySelector(`.scatter-3d`)).toBeTruthy()
  })

  test(`handles surface-only plot without series`, () => {
    mounted_component = mount(ScatterPlot3D, {
      target: container,
      props: {
        series: [],
        surfaces: [grid_surface],
      },
    })

    expect(container.querySelector(`.scatter-3d`)).toBeTruthy()
  })

  test(`handles mismatched array lengths in series gracefully`, () => {
    const mismatched_series: DataSeries3D = {
      x: [1, 2, 3],
      y: [1, 2], // shorter
      z: [1, 2, 3, 4], // longer
    }

    expect(() => {
      mounted_component = mount(ScatterPlot3D, {
        target: container,
        props: { series: [mismatched_series] },
      })
    }).not.toThrow()

    expect(container.querySelector(`.scatter-3d`)).toBeTruthy()
  })
})
