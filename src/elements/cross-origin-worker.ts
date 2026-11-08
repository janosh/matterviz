// Stands in for the global Worker in the custom-element bundle (see ./vite.config.ts). Browsers
// refuse `new Worker(url)` for a script on another origin, such as the CDN serving this bundle,
// so such a worker starts from a same-origin blob: that imports it. Module imports fetch with
// CORS, which a host of this cross-origin module bundle already serves.
export class CrossOriginWorker extends Worker {
  constructor(url: string | URL, options?: WorkerOptions) {
    const href = new URL(url, location.href)
    if (href.origin === location.origin) super(href, options)
    else {
      const shim = `import ${JSON.stringify(href.href)}\nURL.revokeObjectURL(import.meta.url)`
      const blob = new Blob([shim], { type: `text/javascript` })
      super(URL.createObjectURL(blob), { ...options, type: `module` })
    }
  }
}
