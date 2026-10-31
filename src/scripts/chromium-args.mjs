// Chromium flags for every browser that renders the 3D viewers: the Playwright suite and the
// agent CLIs (movie, snapshot). Without them headless Chromium exposes navigator.gpu but hands
// out no adapter, and WebGPURenderer quietly falls back to WebGL2, hiding regressions in the
// backend we ship. The software adapter is CI-only (its runners have no GPU), so local runs
// exercise the one users actually get.
const is_ci = [`true`, `1`].includes(process.env.CI ?? ``)

export const CHROMIUM_GPU_ARGS = [
  `--enable-unsafe-webgpu`,
  `--enable-features=Vulkan`,
  `--enable-unsafe-swiftshader`,
  // Select SwiftShader directly in ANGLE: its generic Vulkan backend requires native surface
  // extensions that Chromium's bundled SwiftShader does not provide, leaving a blank canvas.
  ...(is_ci
    ? [
        `--use-webgpu-adapter=swiftshader`,
        `--use-vulkan=swiftshader`,
        `--use-angle=swiftshader`,
        `--disable-vulkan-surface`,
        // Large instanced draws on a CPU can outlast Chromium's GPU watchdog. Callers'
        // timeouts still bound a genuinely stuck renderer.
        `--disable-gpu-watchdog`,
      ]
    : []),
]
