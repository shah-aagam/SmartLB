import express from 'express'
import registry from '../registry/tenantRegistry.js'
import { saveTenants } from '../registry/persistence.js'

const router = express.Router()

router.post('/register', (req, res) => {
  const { domain, url, strategy } = req.body

  if (!domain || !url) {
    return res.status(400).json({
      error: 'Missing required fields',
      required: ['domain', 'url'],
      example: { domain: 'amazon.com', url: 'http://10.0.0.4:8080', strategy: 'round-robin' }
    })
  }

  try { new URL(url) } catch {
    return res.status(400).json({ error: `Invalid URL: ${url}` })
  }

  if (strategy && !registry.getTenant(domain)) {
    registry.addTenant(domain, strategy)
  }

  registry.registerServer(domain, url)
  saveTenants(registry.getAllTenants())

  res.status(201).json({
    success: true,
    message: `Registered ${url} under ${domain}`,
    tenant:  registry.getTenant(domain)
  })
})

router.delete('/register', (req, res) => {
  const { domain, url } = req.body

  if (!domain || !url) {
    return res.status(400).json({ error: 'Missing domain or url' })
  }

  registry.deregisterServer(domain, url)
  saveTenants(registry.getAllTenants())

  res.json({ success: true, message: `Removed ${url} from ${domain}` })
})

router.post('/drain', (req, res) => {
  const { domain, url } = req.body

  if (!domain || !url) {
    return res.status(400).json({ error: 'Missing domain or url' })
  }

  const success = registry.drainServer(domain, url)

  if (!success) {
    return res.status(404).json({ error: `Server not found: ${url} under ${domain}` })
  }

  res.json({
    success: true,
    message: `Server ${url} is now draining — will be removed when active requests finish`
  })
})

router.get('/servers', (req, res) => {
  const tenants = registry.getAllTenants().map(tenant => ({
    domain:   tenant.domain,
    strategy: tenant.strategy,
    rules:    tenant.rules,

    servers: tenant.servers.map(s => ({
      url:         s.url,
      healthy:     s.healthy,
      draining:    s.draining,
      connections: s.connections,

      circuit: {
        state: s.circuit?.state || 'CLOSED',
        failures: s.circuit?.failures || 0
      },

      avgResponseTime: s.avgResponseTime,
      p95: s.p95,

      totalRequests: s.totalRequests,

      endpointStats: s.endpointStats
    }))
  }))

  res.json({ tenants })
})

router.post('/tenants', (req, res) => {
  const { domain, strategy } = req.body

  if (!domain) {
    return res.status(400).json({ error: 'Missing domain' })
  }

  registry.addTenant(domain, strategy || 'round-robin')
  saveTenants(registry.getAllTenants())

  res.status(201).json({
    success: true,
    message: `Tenant created: ${domain}`,
    tenant:  registry.getTenant(domain)
  })
})


router.patch('/tenants/:domain/strategy', (req, res) => {
  const { domain } = req.params
  const { strategy } = req.body

  const validStrategies = ['round-robin', 'least-connections', 'ip-hash', 'fastest-response', 'weighted-response' , 'adaptive']

  if (!strategy || !validStrategies.includes(strategy)) {
    return res.status(400).json({
      error: 'Invalid strategy',
      valid: validStrategies
    })
  }

  if (!registry.getTenant(domain)) {
    return res.status(404).json({ error: `Tenant not found: ${domain}` })
  }

  registry.setStrategy(domain, strategy)
  saveTenants(registry.getAllTenants())

  res.json({
    success:  true,
    message:  `Strategy updated for ${domain} → ${strategy}`,
    tenant:   registry.getTenant(domain)
  })
})


router.post('/tenants/:domain/rules', (req, res) => {
  const { domain } = req.params
  const rule = req.body

  if (!registry.getTenant(domain)) {
    return res.status(404).json({ error: `Tenant not found: ${domain}` })
  }

  if (!rule.match || !rule.target?.servers) {
    return res.status(400).json({
      error: 'Invalid rule format',
      example: {
        description: 'POST /checkout → premium servers',
        match:  { path: '/checkout', method: 'POST' },
        target: { servers: ['http://localhost:3001'], strategy: 'least-connections' }
      }
    })
  }

  registry.addRule(domain, rule)

  res.status(201).json({
    success: true,
    message: `Rule added for ${domain}`,
    rules:   registry.getRules(domain)
  })
})


router.delete('/tenants/:domain/rules', (req, res) => {
  const { domain } = req.params
  const tenant = registry.getTenant(domain)

  if (!tenant) {
    return res.status(404).json({ error: `Tenant not found: ${domain}` })
  }

  tenant.rules = []
  res.json({ success: true, message: `All rules cleared for ${domain}` })
})

export default router






/**

 * Management API — all routes for controlling SmartLB.
 *
 * Server lifecycle:
 *   POST   /register          — register a server
 *   DELETE /register          — hard remove a server immediately
 *   POST   /drain             — graceful remove (finish active requests first)
 *
 * Tenant management:
 *   POST   /tenants           — create a tenant
 *   GET    /servers           — list all tenants + servers + stats
 *   PATCH  /tenants/:domain/strategy — change routing strategy live
 *
 * Routing rules:
 *   POST   /tenants/:domain/rules    — add a routing rule
 *   DELETE /tenants/:domain/rules    — clear all rules for a tenant
 */