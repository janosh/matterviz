// Export Fermi surface to various 3D formats
import type { Scene } from 'three'

// Dynamic imports for Three.js exporters (tree-shaking friendly)
async function get_stl_exporter() {
  const { STLExporter } = await import(`three/addons/exporters/STLExporter.js`)
  return new STLExporter()
}

async function get_obj_exporter() {
  const { OBJExporter } = await import(`three/addons/exporters/OBJExporter.js`)
  return new OBJExporter()
}

async function get_gltf_exporter() {
  const { GLTFExporter } = await import(`three/addons/exporters/GLTFExporter.js`)
  return new GLTFExporter()
}

// Helper to trigger file download
function download_file(
  content: string | ArrayBuffer,
  filename: string,
  mime_type: string,
) {
  const blob = new Blob([content], { type: mime_type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement(`a`)
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// Export scene to STL format (good for 3D printing)
export async function export_to_stl(scene: Scene, filename: string): Promise<void> {
  const exporter = await get_stl_exporter()
  const result = exporter.parse(scene, { binary: true })
  // Binary STL returns DataView, convert to ArrayBuffer for Blob
  const buffer = result instanceof DataView ? result.buffer : result
  download_file(buffer, `${filename}.stl`, `application/octet-stream`)
}

// Export scene to OBJ format (widely compatible)
export async function export_to_obj(scene: Scene, filename: string): Promise<void> {
  const exporter = await get_obj_exporter()
  const result = exporter.parse(scene)
  download_file(result, `${filename}.obj`, `text/plain`)
}

// Export scene to GLTF format (modern web/AR standard)
export async function export_to_gltf(scene: Scene, filename: string): Promise<void> {
  const exporter = await get_gltf_exporter()

  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (gltf) => {
        const output = JSON.stringify(gltf, null, 2)
        download_file(output, `${filename}.gltf`, `application/json`)
        resolve()
      },
      (error) => reject(error),
      { binary: false },
    )
  })
}

// Main export function that dispatches to the appropriate format
export function export_scene(
  scene: Scene,
  format: `stl` | `obj` | `gltf`,
  filename: string,
): Promise<void> {
  switch (format) {
    case `stl`:
      return export_to_stl(scene, filename)
    case `obj`:
      return export_to_obj(scene, filename)
    case `gltf`:
      return export_to_gltf(scene, filename)
    default:
      return Promise.reject(new Error(`Unsupported export format: ${format}`))
  }
}
