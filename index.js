import http from 'http'
import express from 'express'

import { handleRequest } from './src/core/proxy.js'
import registry from './src/registry/tenantRegistry.js'
import { startHealthChecks } from './src/registry/healthChecker.js'
import registerRoutes from './src/api/register.js'
import { loadTenants } from './src/registry/persistence.js'
import { register } from './src/metrics/prometheus.js'

const PROXY_PORT = Number(process.env.PORT || process.env.PROXY_PORT || 8080)
const API_PORT = Number(process.env.ADMIN_PORT || 9000)

console.log('[SmartLB] Starting API-driven load balancer...')

const persistedTenants = loadTenants()
for (const tenant of persistedTenants) {
  try {
    registry.addTenant(tenant.domain, tenant.strategy)
    for (const server of tenant.servers || []) {
      registry.registerServer(tenant.domain, server.url, {
        id: server.id,
        healthPath: server.healthPath
      })
    }
  } catch (err) {
    console.error(`[boot] Failed to restore ${tenant.domain}: ${err.message}`)
  }
}

startHealthChecks()

const proxyServer = http.createServer(handleRequest)
proxyServer.listen(PROXY_PORT, () => {
  console.log(`[proxy] Traffic server listening on :${PROXY_PORT}`)
})

const app = express()
app.use(express.json())
// Public endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime()
  })
})

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType)
  res.end(await register.metrics())
})

// Protected management API
app.use('/', registerRoutes)


const apiServer = app.listen(API_PORT, () => {
  console.log(`[api] Management API listening on :${API_PORT}`)
  console.log('[boot] SmartLB ready — configure tenants and servers through the API')
})

function shutdown() {
  console.log('\n[shutdown] Graceful shutdown...')
  proxyServer.close(() => {
    apiServer.close(() => process.exit(0))
  })
  setTimeout(() => process.exit(1), 10000).unref()
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
