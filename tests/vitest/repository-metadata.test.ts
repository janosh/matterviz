import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { load } from 'js-yaml'
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
    expect(readme).toContain(`Non-text files larger than 1 GiB are rejected`)
    expect(readme).toContain(`XYZ/EXTXYZ text trajectories are limited`)
    expect(readme).toContain(`512 MiB`)
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
    ].flatMap((match) => {
      const setting = match.groups?.setting
      return setting ? [setting] : []
    })
    expect(documented).toContain(`matterviz.scatter.point.size`)
    expect(documented).toContain(`matterviz.scatter.line.width`)
    for (const key of documented) {
      expect(extension.contributes.configuration.properties).toHaveProperty(key)
    }
  })

  test(`Open Graph image points to a tracked static asset`, () => {
    const app_html = read(`src/app.html`)
    const image_url = /property="og:image"\s+content="(?<url>[^"]+)"/.exec(app_html)?.groups
      ?.url
    expect(image_url).toBeDefined()
    const image = new URL(image_url as string)
    expect(image.origin).toBe(`https://raw.githubusercontent.com`)
    const repo_path = image.pathname.replace(/^\/janosh\/matterviz\/main\//, ``)
    expect(repo_path).toBe(`static/favicon.svg`)
    expect(existsSync(join(root, repo_path))).toBe(true)
    execFileSync(`git`, [`ls-files`, `--error-unmatch`, repo_path], {
      cwd: root,
      stdio: `ignore`,
    })
  })

  test(`citation metadata matches the current package release`, () => {
    const pkg = JSON.parse(read(`package.json`)) as { version: string }
    const citation = load(read(`citation.cff`)) as {
      version: string
      'date-released': Date | string
    }
    const release_date =
      citation[`date-released`] instanceof Date
        ? citation[`date-released`].toISOString().slice(0, 10)
        : citation[`date-released`]
    const bibtex = /```bib(?<entry>[\s\S]*?)```/.exec(read(`readme.md`))?.groups?.entry ?? ``

    expect(citation.version).toBe(pkg.version)
    expect(release_date).toBe(`2026-07-09`)
    expect(bibtex).toContain(`date = {2026-07-09}`)
    expect(bibtex).toContain(`version = {${pkg.version}}`)
  })

  test(`server error reports use the package bug tracker`, () => {
    const pkg = JSON.parse(read(`package.json`)) as { bugs: string }
    const error_page = read(`src/routes/+error.svelte`)
    expect(pkg.bugs).toBe(`https://github.com/janosh/matterviz/issues`)
    expect(error_page).toContain(`href={pkg.bugs}`)
    expect(error_page).not.toContain(`{pkg.homepage}/issues`)
  })
})
