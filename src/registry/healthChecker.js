
import http from 'http'
import { getAllTenants, markServerHealth } from './tenantRegistry.js'

const inFlight = new Set()

function checkServer(domain, server, timeoutMs, healthPath) {
  const key = `${domain}::${server.url}`

  if (inFlight.has(key)) return Promise.resolve()
  inFlight.add(key)

  return new Promise((resolve) => {
    let targetUrl

    try {
      targetUrl = new URL(healthPath, server.url).toString()
    } catch {
      markServerHealth(domain, server.url, false)
      inFlight.delete(key)
      return resolve()
    }

    const req = http.get(targetUrl, (res) => {
      // Accept anything below 500 — so fake servers returning 404 on /health still count as UP
      const isHealthy = res.statusCode < 500
      markServerHealth(domain, server.url, isHealthy)
      res.resume()
      inFlight.delete(key)
      resolve()
    })

    req.setTimeout(timeoutMs, () => {
      req.destroy()
      markServerHealth(domain, server.url, false)
      inFlight.delete(key)
      resolve()
    })

    req.on('error', () => {
      markServerHealth(domain, server.url, false)
      inFlight.delete(key)
      resolve()
    })
  })
}

export function startHealthChecks(config) {
  const { intervalMs, timeoutMs, path: healthPath } = config.healthCheck

  console.log(`[health] Checks every ${intervalMs}ms → ${healthPath}`)

  const runChecks = async () => {
    const tenants = getAllTenants()
    const checks = []

    for (const tenant of tenants) {
      for (const server of tenant.servers) {
        checks.push(checkServer(tenant.domain, server, timeoutMs, healthPath))
      }
    }

    await Promise.all(checks)
    setTimeout(runChecks, intervalMs)
  }

  setTimeout(runChecks, intervalMs)
}