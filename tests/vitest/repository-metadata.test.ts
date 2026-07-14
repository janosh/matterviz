import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = join(import.meta.dirname, `../..`)
const read = (path: string): string => readFileSync(join(root, path), `utf8`)

describe(`repository documentation and metadata`, () => {
  test(`trajectory docs distinguish browser compression support`, () => {
    const readme = read(`readme.md`)
    expect(readme).toContain(`decompress .zip/.bz2/.xz first`)
    expect(readme).not.toMatch(/supports[^\n]*\.zip[^\n]*\.bz2[^\n]*\.xz/)
  })

  test(`VS Code docs describe the hard in-memory file limit`, () => {
    const readme = read(`extensions/vscode/readme.md`)
    expect(readme).toContain(`Files larger than 1 GiB are rejected`)
    expect(readme).toContain(`read into extension memory in one operation`)
    expect(readme).not.toContain(`streamed in chunks`)
  })

  test(`documented scatter keys are registered settings`, () => {
    const readme = read(`extensions/vscode/readme.md`)
    const extension = JSON.parse(read(`extensions/vscode/package.json`)) as {
      contributes: { configuration: { properties: Record<string, unknown> } }
    }
    const documented = [
      ...readme.matchAll(/"(?<setting>matterviz\.scatter\.(?:point|line)[^"]+)"/g),
    ].flatMap((match) => match.groups?.setting ?? [])
    expect(documented).toContain(`matterviz.scatter.point.size`)
    expect(documented).toContain(`matterviz.scatter.line.width`)
    for (const key of documented) {
      expect(extension.contributes.configuration.properties).toHaveProperty(key)
    }
  })
})
