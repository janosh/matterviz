// Compatibility surface that lets the whole dependency graph resolve to three's WebGPU
// build. Our build configs alias bare `three` to this module so the bundle carries exactly
// one copy of three: matterviz imports `three/webgpu` directly, while three's own addons and
// @threlte still import `three`. Without the alias both builds get bundled (~125 KB brotli
// of duplication) and cross-copy `instanceof` checks start failing.
//
// `three/webgpu` re-exports all of `three` except these seven WebGL-only names. Each is
// stubbed below rather than re-exported from `three`, because importing `three` here would
// pull in the very build the alias exists to eliminate.
export * from 'three/webgpu'

// Several @threlte/extras components (Stars, MeshLine, FakeGlowMaterial,
// MeshRefractionMaterial, SoftShadows) and three-viewport-gizmo read these GLSL/uniform
// registries at module scope, and the extras barrel evaluates them all on import. They are
// WebGL-only features matterviz never renders, so empty entries keep the barrel importable.
// Proxies cover every key without enumerating them, and stay writable because callers patch
// entries (SoftShadows swaps a chunk and restores it; the gizmo registers its own).
const registry = <T>(make_default: () => T): Record<string, T> =>
  new Proxy<Record<string, T>>(
    {},
    {
      get: (target, key) =>
        typeof key === `string` ? (target[key] ?? make_default()) : undefined,
    },
  )

export const ShaderChunk = registry(() => ``)
export const UniformsLib = registry(() => ({}))
export const ShaderLib = registry(() => ({
  uniforms: {},
  vertexShader: ``,
  fragmentShader: ``,
}))

// three-viewport-gizmo builds its material uniforms through these. Uniform values are three
// math objects (Vector2, Color...), so clone through each value's own .clone() —
// structuredClone would strip their prototypes and leave inert plain objects behind.
type Uniform = { value?: unknown }

const clone_uniforms = (uniforms: Record<string, Uniform> = {}): Record<string, Uniform> =>
  Object.fromEntries(
    Object.entries(uniforms).map(([name, uniform]) => {
      const value = uniform?.value as { clone?: () => unknown } | undefined
      return [name, { ...uniform, value: value?.clone?.() ?? value }]
    }),
  )

export const UniformsUtils = {
  clone: clone_uniforms,
  merge: (uniforms: Record<string, Uniform>[]): Record<string, Uniform> =>
    Object.assign({}, ...uniforms.map(clone_uniforms)),
}

// Constructing any of these means something asked for a WebGL-only renderer path. Threlte's
// renderer context imports WebGLRenderer as its default, but every <Canvas> here passes an
// explicit createRenderer, so these should never be reached — fail loudly if they are.
const webgl_only = (name: string) =>
  function () {
    throw new Error(`${name} is unavailable: matterviz renders only through WebGPURenderer.`)
  }

export const WebGLRenderer = webgl_only(`WebGLRenderer`) // @threlte/core's default renderer
export const WebGLCubeRenderTarget = webgl_only(`WebGLCubeRenderTarget`) // extras' useCubeCamera
