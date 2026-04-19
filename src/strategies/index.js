
function roundRobin(tenant, servers) {
  if (servers.length === 0) return null
  const server = servers[tenant.rrIndex % servers.length]
  tenant.rrIndex = (tenant.rrIndex + 1) % servers.length
  return server
}

function leastConnections(servers) {
  if (servers.length === 0) return null
  return servers.reduce((min, s) => s.connections < min.connections ? s : min)
}

function ipHash(servers, clientIp) {
  if (servers.length === 0) return null
  const hash = clientIp
    .split('.')
    .reduce((acc, octet) => acc + (parseInt(octet) || 0), 0)
  return servers[hash % servers.length]
}

function fastestResponse(servers) {
  if (servers.length === 0) return null

  const untested = servers.filter(s => s.avgResponseTime === Infinity)
  if (untested.length > 0) {
    return untested[Math.floor(Math.random() * untested.length)]
  }

  return servers.reduce((fastest, s) =>
    s.avgResponseTime < fastest.avgResponseTime ? s : fastest
  )
}

function weightedResponse(servers) {
  if (servers.length === 0) return null

  const untested = servers.filter(s => s.avgResponseTime === Infinity)
  if (untested.length > 0) {
    return untested[Math.floor(Math.random() * untested.length)]
  }

  const weights = servers.map(s => 1 / s.avgResponseTime)
  const total   = weights.reduce((a, b) => a + b, 0)

  let rand = Math.random() * total
  for (let i = 0; i < servers.length; i++) {
    rand -= weights[i]
    if (rand <= 0) return servers[i]
  }

  return servers[servers.length - 1]
}

function adaptive(servers, req) {
  if (servers.length === 0) return null

  const key = `${req.method}:${req.normalizedPath}`
  const C = 2
  const TEMPERATURE = 70
  const EPSILON = 0.05

  // Random exploration safety
  if (Math.random() < EPSILON) {
    const random = servers[Math.floor(Math.random() * servers.length)]
    console.log('[adaptive] RANDOM EXPLORE →', random.url)
    return random
  }

  let totalCount = 0

  const stats = servers.map(s => {
    const stat = s.endpointStats?.[key]
    const count = stat?.count ?? 0
    const avg   = stat?.avg ?? Infinity
    const connections = s.connections ?? 0

    totalCount += count

    return { server: s, count, avg, connections }
  })

  // FORCE unseen
  const unseen = stats.filter(s => s.count === 0)
  if (unseen.length > 0) {
    const chosen = unseen[Math.floor(Math.random() * unseen.length)]
    console.log('[adaptive] FORCED EXPLORE →', chosen.server.url)
    return chosen.server
  }

  const logN = Math.log(totalCount)

  const scored = stats.map(s => {
    const exploitation = -s.avg
    const exploration  = C * Math.sqrt(logN / s.count)
    const loadPenalty  = -0.7 * s.connections

    let score = exploitation + exploration + loadPenalty

    score = Math.max(-200, Math.min(200, score))

    return { server: s.server, score }
  })

  const expScores = scored.map(s => Math.exp(s.score / TEMPERATURE))
  const total = expScores.reduce((a, b) => a + b, 0)

  let rand = Math.random() * total

  for (let i = 0; i < scored.length; i++) {
    rand -= expScores[i]
    if (rand <= 0) {
      console.log('[adaptive] PICK →', scored[i].server.url)
      return scored[i].server
    }
  }

  return scored[scored.length - 1].server
}


export function pickServer(tenant, servers, clientIp, req) {
  switch (tenant.strategy) {
    case 'round-robin':
      return roundRobin(tenant, servers)

    case 'least-connections':
      return leastConnections(servers)

    case 'ip-hash':
      return ipHash(servers, clientIp)

    case 'fastest-response':
      return fastestResponse(servers)

    case 'weighted-response':
      return weightedResponse(servers)

    case 'adaptive':
      return adaptive(servers, req)

    default:
      console.warn(`[strategy] Unknown strategy "${tenant.strategy}", fallback`)
      return roundRobin(tenant, servers)
  }
}

export {
  roundRobin,
  leastConnections,
  ipHash,
  fastestResponse,
  weightedResponse,
  adaptive
}