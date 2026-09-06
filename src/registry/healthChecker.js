import http from 'http'
import https from 'https'
import { getAllTenants, markServerHealth } from './tenantRegistry.js'

const inFlight = new Set()
const intervalMs = Number(process.env.HEALTH_CHECK_INTERVAL_MS || 10000)
const timeoutMs = Number(process.env.HEALTH_CHECK_TIMEOUT_MS || 3000)

function checkServer(domain, server) {
  const key = `${domain}::${server.id}`
  if (inFlight.has(key)) return Promise.resolve()
  inFlight.add(key)

  return new Promise(resolve => {
    let targetUrl
    try {
      targetUrl = new URL(server.healthPath || '/health', server.url)
    } catch {
      markServerHealth(domain, server.id, false)
      inFlight.delete(key)
      return resolve()
    }

    const transport = targetUrl.protocol === 'https:' ? https : http
    const request = transport.get(targetUrl, response => {
      const healthy = response.statusCode >= 200 && response.statusCode < 400
      markServerHealth(domain, server.id, healthy)
      response.resume()
      inFlight.delete(key)
      resolve()
    })

    request.setTimeout(timeoutMs, () => {
      request.destroy()
      markServerHealth(domain, server.id, false)
      inFlight.delete(key)
      resolve()
    })

    request.on('error', () => {
      markServerHealth(domain, server.id, false)
      inFlight.delete(key)
      resolve()
    })
  })
}

export function startHealthChecks() {
  console.log(`[health] Checks every ${intervalMs}ms`)

  const runChecks = async () => {
    const checks = []
    for (const tenant of getAllTenants()) {
      for (const server of tenant.servers) checks.push(checkServer(tenant.domain, server))
    }
    await Promise.all(checks)
    setTimeout(runChecks, intervalMs)
  }

  runChecks()
}
