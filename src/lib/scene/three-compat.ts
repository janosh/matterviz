// Lets the whole dependency graph resolve to three's WebGPU build: our build configs alias
// bare `three` to this module so the bundle carries one copy of three (matterviz imports
// `three/webgpu`, three's addons and @threlte import `three`). Without it both builds ship
// (~125 KB brotli of duplication) and cross-copy `instanceof` checks fail.
//
// `three/webgpu` re-exports all of `three` bar the WebGL-only names stubbed below. Stubbed
// rather than re-exported, since importing `three` here would pull in the build we're eliding.
export * from 'three/webgpu'

// Several @threlte/extras components (Stars, MeshLine, FakeGlowMaterial, SoftShadows...) read
// these GLSL/uniform registries at module scope and the extras barrel evaluates them all on
// import. They're WebGL-only features matterviz never renders, so empty entries keep the
// barrel importable. Proxies cover every key without enumerating them.
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

// Uniform values are three math objects (Vector2, Color...), so clone through each value's own
// .clone() — structuredClone would strip their prototypes and leave inert plain objects.
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

// Constructing either means something asked for a WebGL-only renderer path. Threlte imports
// WebGLRenderer as its default, but every <Canvas> here passes createRenderer explicitly.
const webgl_only = (name: string) =>
  function () {
    throw new Error(`${name} is unavailable: matterviz renders only through WebGPURenderer.`)
  }

export const WebGLRenderer = webgl_only(`WebGLRenderer`) // @threlte/core's default renderer
export const WebGLCubeRenderTarget = webgl_only(`WebGLCubeRenderTarget`) // extras' useCubeCamera
