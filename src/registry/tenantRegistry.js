/**
 * Single source of truth for all tenants and their server pools.
 *
 * Each server object shape:
 * {
 *   url:             string,
 *   healthy:         null | true | false,
 *   draining:        boolean,   // graceful shutdown — no new requests
 *   connections:     number,    // active right now
 *   responseTimes:   number[],  // rolling window of last 20 response times (ms)
 *   avgResponseTime: number,    // computed average — used by fastest-response
 *   totalRequests:   number,    // lifetime request count
 *   addedAt:         Date
 * }
 */

const registry = {}

const RESPONSE_WINDOW = 20 



function addTenant(domain, strategy = 'round-robin') {
  if (registry[domain]) return
  registry[domain] = {
    strategy,
    rrIndex: 0,
    servers: [],
    rules: []    // routing rules for this tenant (path/header/method)
  }
  console.log(`[registry] Tenant added: ${domain} (strategy: ${strategy})`)
}

function getTenant(domain) {
  return registry[domain] || null
}

function getAllTenants() {
  return Object.entries(registry).map(([domain, data]) => ({
    domain,
    strategy: data.strategy,
    servers:  data.servers,
    rules:    data.rules
  }))
}

function setStrategy(domain, strategy) {
  if (!registry[domain]) return
  registry[domain].strategy = strategy
  console.log(`[registry] Strategy updated: ${domain} → ${strategy}`)
}


function registerServer(domain, url) {
  if (!registry[domain]) addTenant(domain)

  const tenant = registry[domain]
  const exists = tenant.servers.find(s => s.url === url)

  if (exists) {
    if (exists.draining) {
      exists.draining = false
      console.log(`[registry] Server re-activated (was draining): ${url} → ${domain}`)
    } else {
      console.log(`[registry] Already registered: ${url} → ${domain}`)
    }
    return
  }

  tenant.servers.push({
    url,
    healthy:         null,   // null = not yet checked
    draining:        false,
    connections:     0,
    responseTimes:   [],     // rolling window
    avgResponseTime: Infinity, // Infinity so untested servers are last resort in fastest-response
    totalRequests:   0,
    endpointStats: {
      // key: "GET:/products"
      // value: { avg: number, samples: number }
     },
    addedAt:         new Date() 
  }) 

  console.log(`[registry] Server registered: ${url} → ${domain}`)
}

function deregisterServer(domain, url) {
  if (!registry[domain]) return
  registry[domain].servers = registry[domain].servers.filter(s => s.url !== url)
  console.log(`[registry] Server removed: ${url} from ${domain}`)
}

function drainServer(domain, url) {
  const server = registry[domain]?.servers.find(s => s.url === url)
  if (!server) return false
  server.draining = true
  console.log(`[registry] Server draining: ${url} (${domain}) — waiting for ${server.connections} active connections`)
  return true
}

function getRoutableServers(domain) {
  return registry[domain]?.servers.filter(
    s => s.healthy !== false && !s.draining
  ) ?? []
}

function getHealthyServers(domain) {
  return getRoutableServers(domain)
}


function recordResponseTime(domain, url, timeMs, method, path) {
  const server = registry[domain]?.servers.find(s => s.url === url)
  if (!server) return

  server.responseTimes.push(timeMs)

  if (server.responseTimes.length > RESPONSE_WINDOW) {
    server.responseTimes.shift()
  }

  const sum = server.responseTimes.reduce((a, b) => a + b, 0)
  server.avgResponseTime = Math.round(sum / server.responseTimes.length)
  server.totalRequests++

  const key = `${method}:${path}`

  if (!server.endpointStats[key]) {
    server.endpointStats[key] = {
      total: 0,
      count: 0,
      avg: Infinity
    }
  }

  const stat = server.endpointStats[key]
  stat.total += timeMs
  stat.count++
  stat.avg = Math.round(stat.total / stat.count)
}

function markServerHealth(domain, url, isHealthy) {
  const server = registry[domain]?.servers.find(s => s.url === url)
  if (!server) return

  const prev = server.healthy

  if (prev !== isHealthy) {
    const status = isHealthy ? 'UP   ✓' : 'DOWN ✗'
    const tag    = prev === null ? '[first check]' : '[changed]'
    console.log(`[health] ${status}  ${url}  (${domain})  ${tag}`)
  }

  server.healthy = isHealthy
}


function incrementConnections(domain, url) {
  const server = registry[domain]?.servers.find(s => s.url === url)
  if (server) server.connections++
}

function decrementConnections(domain, url) {
  const server = registry[domain]?.servers.find(s => s.url === url)
  if (!server || server.connections <= 0) return
  server.connections--

  if (server.draining && server.connections === 0) {
    console.log(`[registry] Drain complete, removing: ${url} from ${domain}`)
    registry[domain].servers = registry[domain].servers.filter(s => s.url !== url)
  }
}



function addRule(domain, rule) {
  if (!registry[domain]) return
  registry[domain].rules.push(rule)
  console.log(`[registry] Rule added for ${domain}:`, rule)
}

function getRules(domain) {
  return registry[domain]?.rules ?? []
}


const tenantRegistry = {
  addTenant,
  getTenant,
  getAllTenants,
  setStrategy,
  registerServer,
  deregisterServer,
  drainServer,
  getRoutableServers,
  getHealthyServers,
  recordResponseTime,
  markServerHealth,
  incrementConnections,
  decrementConnections,
  addRule,
  getRules
}

export {
  addTenant,
  getTenant,
  getAllTenants,
  setStrategy,
  registerServer,
  deregisterServer,
  drainServer,
  getRoutableServers,
  getHealthyServers,
  recordResponseTime,
  markServerHealth,
  incrementConnections,
  decrementConnections,
  addRule,
  getRules
}

export default tenantRegistry