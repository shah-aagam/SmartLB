const tenants = new Map()

const validStrategies = [
  'round-robin',
  'least-connections',
  'ip-hash',
  'fastest-response',
  'weighted-response',
  'adaptive'
]

function createServer(url) {
  return {
    url,
    healthy: true,
    draining: false,
    connections: 0,

    circuit: {
      state: 'CLOSED',    
      failures: 0,
      lastFailureTime: 0
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

  if (obj.latencies.length > obj.maxSamples) {
    obj.latencies.shift()
  }

  const sum = obj.latencies.reduce((a, b) => a + b, 0)
  obj.avg = sum / obj.latencies.length

  const sorted = [...obj.latencies].sort((a, b) => a - b)
  const index = Math.floor(0.95 * sorted.length)
  obj.p95 = sorted[index]
}


export function recordFailure(domain, url) {
  const tenant = tenants.get(domain)
  const server = tenant?.servers.find(s => s.url === url)
  if (!server) return

  server.circuit.failures++
  server.circuit.lastFailureTime = Date.now()

  console.log(`[circuit] failure ${server.circuit.failures} → ${url}`)

  if (server.circuit.failures >= server.failureThreshold) {
    server.circuit.state = 'OPEN'
    server.circuit.lastFailureTime = Date.now()
    console.log(`[circuit] OPEN → ${url}`)
  }
}

export function recordSuccess(domain, url) {
  const tenant = tenants.get(domain)
  const server = tenant?.servers.find(s => s.url === url)
  if (!server) return

  if (server.circuit.state === 'HALF') {
    server.circuit.state = 'CLOSED'
    server.circuit.failures = 0
    console.log(`[circuit] CLOSED → ${url}`)
  }
}


function isCircuitAvailable(server) {
  if (server.circuit.state === 'OPEN') {
    const now = Date.now()

    if (now - server.circuit.lastFailureTime > server.cooldownMs) {
      server.circuit.state = 'HALF'
      console.log(`[circuit] HALF-OPEN → ${server.url}`)
      return true
    }

    return false
  }

  return true
}

function setStrategy(domain, strategy) {
  const tenant = tenants.get(domain)
  if (!tenant) return false

  if (!validStrategies.includes(strategy)) {
    throw new Error(`Invalid strategy: ${strategy}`)
  }

  tenant.strategy = strategy
  return true
}

export function recordResponseTime(domain, url, elapsed, method, path) {
  const tenant = tenants.get(domain)
  if (!tenant) return

  const server = tenant.servers.find(s => s.url === url)
  if (!server) return

  // GLOBAL
  updateStats(server, elapsed)
  server.avgResponseTime = server.avg
  server.totalRequests++

  // ENDPOINT
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

export function incrementConnections(domain, url) {
  const tenant = tenants.get(domain)
  const server = tenant?.servers.find(s => s.url === url)
  if (server) server.connections++
}

export function decrementConnections(domain, url) {
  const tenant = tenants.get(domain)
  const server = tenant?.servers.find(s => s.url === url)
  if (!server || server.connections <= 0) return

  server.connections--

  if (server.draining && server.connections === 0) {
    tenant.servers = tenant.servers.filter(s => s.url !== url)
    console.log(`[registry] Drain complete → removed ${url}`)
  }
}


export function markServerHealth(domain, url, isHealthy) {
  const tenant = tenants.get(domain)
  const server = tenant?.servers.find(s => s.url === url)

  if (!server) return

  const prev = server.healthy

  if (prev !== isHealthy) {
    const status = isHealthy ? 'UP   ✓' : 'DOWN ✗'
    const tag    = prev === null ? '[first check]' : '[changed]'
    console.log(`[health] ${status}  ${url}  (${domain})  ${tag}`)
  }

  server.healthy = isHealthy
}

export function getAllTenants() {
  return Array.from(tenants.values())
}


export default {
  addTenant(domain, strategy) {
    if (!tenants.has(domain)) {
      tenants.set(domain, {
        domain,
        strategy,
        servers: [],
        rrIndex: 0,
        rules: []
      })
    }
  },

  registerServer(domain, url) {
    const tenant = tenants.get(domain)
    if (!tenant) return
    tenant.servers.push(createServer(url))
  },

  getTenant(domain) {
    return tenants.get(domain)
  },

  getRoutableServers(domain) {
    const tenant = tenants.get(domain)

    return tenant?.servers.filter(s =>
      s.healthy &&
      !s.draining &&
      isCircuitAvailable(s)  
    ) || []
  },

  getRules(domain) {
    return tenants.get(domain)?.rules || []
  },

  incrementConnections,
  decrementConnections,
  recordResponseTime,
  markServerHealth,
  getAllTenants,
  setStrategy
}