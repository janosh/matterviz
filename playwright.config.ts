/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  browser: `chromium`,
  webServer: {
    command: `vite dev --port 3005`,
    port: 3005,
  },
}

export default config
