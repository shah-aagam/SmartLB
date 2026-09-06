import { randomUUID } from 'crypto'
import { incrementConnectionsRedis, decrementConnectionsRedis, incrementSuccessRedis, incrementFailureRedis } from '../redis/redisMetrics.js'
import {
  backendHealth,
  circuitState
} from '../metrics/prometheus.js'

const tenants = new Map()

export const validStrategies = [
  'round-robin',
  'least-connections',
  'ip-hash',
  'fastest-response',
  'weighted-response',
  'adaptive'
]

function normalizeDomain(domain) {
  return String(domain || '').trim().toLowerCase().replace(/:\d+$/, '')
}

function setBackendHealthMetric(server) {
  backendHealth.set(
    { backend: server.url },
    server.healthy === false ? 0 : 1
  )
}

function setCircuitStateMetric(server) {
  const stateMap = {
    CLOSED: 0,
    OPEN: 1,
    HALF_OPEN: 2
  }

  circuitState.set(
    { backend: server.url },
    stateMap[server.circuit.state]
  )
}

function createServer(url, options = {}) {
  return {
    id: options.id || randomUUID(),
    url,
    healthPath: options.healthPath || process.env.HEALTH_CHECK_PATH || '/health',
    healthy: null,
    draining: false,
    connections: 0,
    circuit: {
      state: 'CLOSED',
      failures: 0,
      lastFailureTime: 0,
      probeInFlight: false
    },
    failureThreshold: 3,
    cooldownMs: 10000,
    latencies: [],
    maxSamples: 50,
    avgResponseTime: Infinity,
    p95: Infinity,
    endpointStats: {},
    totalRequests: 0
  }
}

function updateStats(obj, elapsed) {
  obj.latencies.push(elapsed)
  if (obj.latencies.length > obj.maxSamples) obj.latencies.shift()

  const sum = obj.latencies.reduce((a, b) => a + b, 0)
  obj.avg = sum / obj.latencies.length

  const sorted = [...obj.latencies].sort((a, b) => a - b)
  obj.p95 = sorted[Math.min(Math.floor(0.95 * sorted.length), sorted.length - 1)]
}

function findServer(domain, idOrUrl) {
  const tenant = tenants.get(normalizeDomain(domain))
  if (!tenant) return null
  return tenant.servers.find(server => server.id === idOrUrl || server.url === idOrUrl) || null
}

export function recordFailure(domain, idOrUrl) {
  const server = findServer(domain, idOrUrl)
  if (!server) return

  server.circuit.failures++
  server.circuit.lastFailureTime = Date.now()
  incrementFailureRedis(server.url).catch(() => {})

  if (server.circuit.state === 'HALF_OPEN' || server.circuit.failures >= server.failureThreshold) {
    server.circuit.state = 'OPEN'
    server.circuit.probeInFlight = false

    setCircuitStateMetric(server)

    console.log(`[circuit] OPEN → ${server.url}`)
  }
}

export function recordSuccess(domain, idOrUrl) {
  const server = findServer(domain, idOrUrl)
  if (!server) return

  server.circuit.failures = 0
  incrementSuccessRedis(server.url).catch(() => {})

  if (server.circuit.state === 'HALF_OPEN') {
    server.circuit.state = 'CLOSED'
    server.circuit.probeInFlight = false

    setCircuitStateMetric(server)

    console.log(`[circuit] CLOSED → ${server.url}`)
  }
}

function isCircuitAvailable(server) {
  if (server.circuit.state === 'OPEN') {
    return Date.now() - server.circuit.lastFailureTime >= server.cooldownMs
  }

  return server.circuit.state === 'CLOSED'
}

function acquireCircuitProbe(domain, id) {
  const server = findServer(domain, id)
  if (!server) return false

  if (server.circuit.state === 'CLOSED') return true

  if (server.circuit.state === 'OPEN') {
    if (Date.now() - server.circuit.lastFailureTime < server.cooldownMs) return false
    if (server.circuit.probeInFlight) return false

    server.circuit.state = 'HALF_OPEN'
    server.circuit.probeInFlight = true

    setCircuitStateMetric(server)
    
    console.log(`[circuit] HALF-OPEN probe → ${server.url}`)
    return true
  }

  return false
}

export function recordResponseTime(domain, idOrUrl, elapsed, method, path) {
  const server = findServer(domain, idOrUrl)
  if (!server) return

  updateStats(server, elapsed)
  server.avgResponseTime = server.avg
  server.totalRequests++

  const key = `${method}:${path}`
  if (!server.endpointStats[key]) {
    server.endpointStats[key] = {
      latencies: [],
      maxSamples: 50,
      avg: Infinity,
      p95: Infinity,
      count: 0
    }
  }

  const stat = server.endpointStats[key]
  stat.count++
  updateStats(stat, elapsed)
}

export function incrementConnections(domain, idOrUrl) {
  const server = findServer(domain, idOrUrl)
  if (!server) return

  server.connections++
  incrementConnectionsRedis(server.url).catch(() => {})
}

export function decrementConnections(domain, idOrUrl) {
  const tenant = tenants.get(normalizeDomain(domain))
  const server = findServer(domain, idOrUrl)
  if (!server || server.connections <= 0) return

  server.connections--
  decrementConnectionsRedis(server.url).catch(() => {})

  if (server.draining && server.connections === 0 && tenant) {
    tenant.servers = tenant.servers.filter(s => s.id !== server.id)
    console.log(`[registry] Drain complete → removed ${server.id}`)
  }
}

export function markServerHealth(domain, idOrUrl, isHealthy) {
  const server = findServer(domain, idOrUrl)
  if (!server) return

  const previous = server.healthy
  server.healthy = isHealthy

  setBackendHealthMetric(server)

  if (previous !== isHealthy) {
    console.log(`[health] ${isHealthy ? 'UP ✓' : 'DOWN ✗'} ${server.url} (${normalizeDomain(domain)})`)
  }
}

export function getAllTenants() {
  return Array.from(tenants.values())
}

function addTenant(domain, strategy = 'adaptive') {
  const normalized = normalizeDomain(domain)
  if (!normalized) throw new Error('Invalid domain')
  if (!validStrategies.includes(strategy)) throw new Error(`Invalid strategy: ${strategy}`)
  if (tenants.has(normalized)) throw new Error(`Tenant already exists: ${normalized}`)

  tenants.set(normalized, {
    domain: normalized,
    strategy,
    servers: [],
    rrIndex: 0
  })
  return tenants.get(normalized)
}

function registerServer(domain, url, options = {}) {
  const tenant = tenants.get(normalizeDomain(domain))
  if (!tenant) throw new Error(`Tenant not found: ${domain}`)
  if (tenant.servers.some(s => s.url === url)) throw new Error(`Server already registered: ${url}`)

  const server = createServer(url, options)
  tenant.servers.push(server)

  setBackendHealthMetric(server)
  setCircuitStateMetric(server)

  return server
}

function deregisterServer(domain, id) {
  const tenant = tenants.get(normalizeDomain(domain))
  if (!tenant) return false

  const server = tenant.servers.find(s => s.id === id || s.url === id)
  if (!server) return false

  if (server.connections > 0) return false
  tenant.servers = tenant.servers.filter(s => s.id !== server.id)
  return true
}

function drainServer(domain, id) {
  const tenant = tenants.get(normalizeDomain(domain))
  const server = tenant?.servers.find(s => s.id === id || s.url === id)
  if (!server) return false

  if (server.connections === 0) {
    tenant.servers = tenant.servers.filter(s => s.id !== server.id)
    console.log(`[registry] Immediate drain → removed ${server.id}`)
  } else {
    server.draining = true
    console.log(`[registry] Draining ${server.id} (${server.connections} active requests)`)
  }
  return true
}

function setStrategy(domain, strategy) {
  const tenant = tenants.get(normalizeDomain(domain))
  if (!tenant) return false
  if (!validStrategies.includes(strategy)) throw new Error(`Invalid strategy: ${strategy}`)
  tenant.strategy = strategy
  return true
}

export default {
  addTenant,
  registerServer,
  deregisterServer,
  drainServer,
  getTenant: domain => tenants.get(normalizeDomain(domain)),
  getRoutableServers(domain) {
    const tenant = tenants.get(normalizeDomain(domain))
    return tenant?.servers.filter(server =>
      server.healthy !== false &&
      !server.draining &&
      isCircuitAvailable(server)
    ) || []
  },
  getAllTenants,
  getServer(domain, id) {
    return findServer(domain, id)
  },
  acquireCircuitProbe,
  deleteTenant(domain) {
    return tenants.delete(normalizeDomain(domain))
  },
  setStrategy,
  incrementConnections,
  decrementConnections,
  recordResponseTime,
  markServerHealth,
  validStrategies
}
