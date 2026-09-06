import 'dotenv/config'
import express from 'express'
import registry from '../registry/tenantRegistry.js'
import { saveTenants } from '../registry/persistence.js'

const ADMIN_SECRET = process.env.SMARTLB_ADMIN_SECRET

const router = express.Router()

function requireAdmin(req, res, next) {
  if (!ADMIN_SECRET) {
    console.error('[auth] SMARTLB_ADMIN_SECRET is not configured')

    return res.status(500).json({
      error: 'Admin authentication is not configured'
    })
  }

  const authorization = req.headers.authorization || ''

  const [scheme, token] = authorization.split(' ')

  if (scheme !== 'Bearer' || token !== ADMIN_SECRET) {
    return res.status(401).json({
      error: 'Unauthorized'
    })
  }

  next()
}

router.use(requireAdmin)

function normalizeDomain(domain) {
  return String(domain || '').trim().toLowerCase().replace(/:\d+$/, '')
}

function publicServer(server) {
  return {
    id: server.id,
    url: server.url,
    healthPath: server.healthPath,
    healthy: server.healthy,
    draining: server.draining,
    connections: server.connections,
    circuit: {
      state: server.circuit.state,
      failures: server.circuit.failures
    },
    avgResponseTime: server.avgResponseTime,
    p95: server.p95,
    totalRequests: server.totalRequests,
    endpointStats: server.endpointStats
  }
}

router.post('/tenants', (req, res) => {
  const domain = normalizeDomain(req.body.domain)
  const strategy = req.body.strategy || 'adaptive'

  if (!domain) return res.status(400).json({ error: 'Missing domain' })

  try {
    const tenant = registry.addTenant(domain, strategy)
    saveTenants(registry.getAllTenants())
    return res.status(201).json({ success: true, tenant })
  } catch (err) {
    return res.status(err.message.includes('already exists') ? 409 : 400).json({ error: err.message })
  }
})

router.get('/tenants', (req, res) => {
  res.json({ tenants: registry.getAllTenants().map(t => ({
    domain: t.domain,
    strategy: t.strategy,
    servers: t.servers.map(publicServer)
  })) })
})

router.get('/tenants/:domain', (req, res) => {
  const tenant = registry.getTenant(normalizeDomain(req.params.domain))
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' })

  res.json({
    domain: tenant.domain,
    strategy: tenant.strategy,
    servers: tenant.servers.map(publicServer)
  })
})

router.patch('/tenants/:domain', (req, res) => {
  const domain = normalizeDomain(req.params.domain)
  const tenant = registry.getTenant(domain)
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' })

  if (req.body.strategy !== undefined) {
    try {
      registry.setStrategy(domain, req.body.strategy)
    } catch (err) {
      return res.status(400).json({ error: err.message, valid: registry.validStrategies })
    }
  }

  saveTenants(registry.getAllTenants())
  res.json({ success: true, tenant: registry.getTenant(domain) })
})

router.delete('/tenants/:domain', (req, res) => {
  const domain = normalizeDomain(req.params.domain)
  const tenant = registry.getTenant(domain)
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' })
  if (tenant.servers.some(s => s.connections > 0)) {
    return res.status(409).json({ error: 'Tenant has active requests; drain servers first' })
  }

  registry.deleteTenant(domain)
  saveTenants(registry.getAllTenants())
  res.json({ success: true })
})

router.post('/servers', (req, res) => {
  const domain = normalizeDomain(req.body.domain)
  const url = String(req.body.url || '').trim()

  if (!domain || !url) {
    return res.status(400).json({ error: 'domain and url are required' })
  }

  try { new URL(url) } catch {
    return res.status(400).json({ error: `Invalid URL: ${url}` })
  }

  if (!registry.getTenant(domain)) {
    return res.status(404).json({ error: `Tenant not found: ${domain}` })
  }

  try {
    const server = registry.registerServer(domain, url, { healthPath: req.body.healthPath })
    saveTenants(registry.getAllTenants())
    return res.status(201).json({ success: true, server: publicServer(server) })
  } catch (err) {
    return res.status(err.message.includes('already registered') ? 409 : 400).json({ error: err.message })
  }
})

router.get('/servers', (req, res) => {
  const servers = []
  for (const tenant of registry.getAllTenants()) {
    for (const server of tenant.servers) {
      servers.push({ domain: tenant.domain, ...publicServer(server) })
    }
  }
  res.json({ servers })
})

router.get('/servers/:id', (req, res) => {
  for (const tenant of registry.getAllTenants()) {
    const server = tenant.servers.find(s => s.id === req.params.id)
    if (server) return res.json({ domain: tenant.domain, ...publicServer(server) })
  }
  res.status(404).json({ error: 'Server not found' })
})

router.post('/servers/:id/drain', (req, res) => {
  for (const tenant of registry.getAllTenants()) {
    const server = tenant.servers.find(s => s.id === req.params.id)
    if (server) {
      registry.drainServer(tenant.domain, server.id)
      saveTenants(registry.getAllTenants())
      return res.json({ success: true, message: 'Server draining', serverId: server.id })
    }
  }
  res.status(404).json({ error: 'Server not found' })
})

router.delete('/servers/:id', (req, res) => {
  for (const tenant of registry.getAllTenants()) {
    const server = tenant.servers.find(s => s.id === req.params.id)
    if (server) {
      const removed = registry.deregisterServer(tenant.domain, server.id)
      if (!removed) return res.status(409).json({ error: 'Server has active requests; drain it first' })
      saveTenants(registry.getAllTenants())
      return res.json({ success: true })
    }
  }
  res.status(404).json({ error: 'Server not found' })
})

export default router
