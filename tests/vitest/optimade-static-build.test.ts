import { existsSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { optimade_permalink } from '$site/optimade-routing'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const build_dir = resolve(import.meta.dirname, `../../build`)
const optimade_html_candidates = [
  join(build_dir, `optimade.html`),
  join(build_dir, `optimade`, `index.html`),
]

function read_optimade_html(): string | null {
  const html_path = optimade_html_candidates.find((path) => existsSync(path))
  return html_path ? readFileSync(html_path, `utf8`) : null
}

describe(`static OPTIMADE output`, () => {
  let server: Server
  let origin = ``

  beforeAll(async () => {
    server = createServer((request, response) => {
      const headers = {
        'access-control-allow-origin': `*`,
        'access-control-allow-methods': `GET, OPTIONS`,
      }
      if (request.method === `OPTIONS`) {
        response.writeHead(204, headers).end()
        return
      }

      const url = new URL(request.url ?? `/`, `http://static.test`)
      if (url.pathname !== `/optimade`) {
        response.writeHead(404, headers).end(`not found`)
        return
      }

      const html = read_optimade_html()
      if (!html) {
        response.writeHead(404, headers).end(`missing optimade html`)
        return
      }

      response
        .writeHead(200, { ...headers, 'content-type': `text/html; charset=utf-8` })
        .end(html)
    })

    await new Promise<void>((resolve_listen) => {
      server.listen(0, `127.0.0.1`, resolve_listen)
    })
    const address = server.address() as AddressInfo
    origin = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve_close, reject) => {
      server.close((error) => (error ? reject(error) : resolve_close()))
    })
  })

  test(`serves helper-generated OPTIMADE permalinks from the static /optimade route`, async () => {
    const permalink = optimade_permalink(`mp-149`)
    expect(permalink).toBe(`/optimade?id=mp-149`)

    const response = await fetch(`${origin}${permalink}`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain(`OPTIMADE Explorer`)
  })
})
