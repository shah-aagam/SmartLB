/**
 * Handles every incoming request.
 *
 * Upgraded flow per request:
 *   1. Read Host header          → which tenant?
 *   2. Look up tenant            → exists?
 *   3. Get routable servers      → healthy + not draining
 *   4. Evaluate routing rules    → rule match overrides pool + strategy
 *   5. Pick server via strategy
 *   6. Add proxy headers
 *   7. Measure response time     → feed back to registry
 *   8. Forward + return response
 */

import httpProxy from 'http-proxy'
import registry from '../registry/tenantRegistry.js'
import { pickServer } from '../strategies/index.js'
import { evaluateRules } from '../routing/rules.js'
import { recordFailure, recordSuccess } from '../registry/tenantRegistry.js'

let requestCounter = 0

function normalizePath(url) {
  try {
    const parsed = new URL(url, 'http://dummy') 

    let path = parsed.pathname

    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1)
    }

    return path
  } catch {
    return url.split('?')[0] 
  }
}

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  timeout: 10000
})

proxy.on('error', (err, req, res) => {
  const reqId = req.reqId || 'unknown'
  const server = req.__chosenServer || 'unknown'
  const host   = req.__host || 'unknown'

  // Log the error clearly
  console.error(
    `[req:${reqId}] [proxy:error] ${req.method} ${req.url} → ${server} | ${err.code || err.message}`
  )

  // Circuit breaker: network failure
  if (req.__chosenServer && req.__host) {
    console.log(
      `[req:${reqId}] [circuit] NETWORK FAILURE → ${server}`
    )

    recordFailure(host, server)
  }

  // Send fallback response (only if not already sent)
  if (!res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      error: 'Bad Gateway',
      type: 'NETWORK_ERROR',
      message: err.message
    }))
  }
})

proxy.on('proxyRes', (proxyRes, req) => {
  const reqId = req.reqId || 'unknown'
  const server = req.__chosenServer
  const host = req.__host

  if (!server || !host) return

  const status = proxyRes.statusCode

  if (status >= 500) {
    console.log(
      `[req:${reqId}] [circuit] HTTP ${status} FAILURE → ${server}`
    )
    recordFailure(host, server)
  } else {
    console.log(
      `[req:${reqId}] [circuit] SUCCESS (${status}) → ${server}`
    )
    recordSuccess(host, server)
  }
})


export function handleRequest(req, res) {
  const reqId = ++requestCounter
  req.reqId = reqId

  console.log(`\n REQUEST ${reqId} `)
  console.log(`[req:${reqId}] Incoming → ${req.method} ${req.url}`)

  const host = (req.headers.host || '').split(':')[0].toLowerCase().trim()

  if (!host) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: 'Missing Host header' }))
  }

  const tenant = registry.getTenant(host)

  if (!tenant) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: `No tenant found for: ${host}` }))
  }


  const routableServers = registry.getRoutableServers(host)

  if (routableServers.length === 0) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: 'Service Unavailable — no servers available' }))
  }

  const rules       = registry.getRules(host)
  const ruleMatch   = evaluateRules(rules, req, host, routableServers)

  const serverPool  = ruleMatch?.servers   ?? routableServers
  const strategy    = ruleMatch?.strategy  ?? tenant.strategy

  const effectiveTenant = strategy !== tenant.strategy
    ? { ...tenant, strategy }
    : tenant


  const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '0.0.0.0')
    .split(',')[0].trim()

  req.normalizedPath = normalizePath(req.url)

  const chosen = pickServer(effectiveTenant, serverPool, clientIp , req)

  if (!chosen) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: 'No server available' }))
  }
  req.__chosenServer = chosen.url
  req.__host = host


  req.headers['x-forwarded-for']  = clientIp
  req.headers['x-forwarded-host'] = host
  req.headers['x-real-ip']        = clientIp


  const startTime = Date.now()

  registry.incrementConnections(host, chosen.url)

  let cleaned = false

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    const elapsed = Date.now() - startTime

    registry.decrementConnections(host, chosen.url)

    registry.recordResponseTime(
      host,
      chosen.url,
      elapsed,
      req.method,
      req.normalizedPath
    )

    console.log(
      `[req:${reqId}] [proxy] ${req.method} ${host}${req.url} → ${chosen.url} ` +
      `[${strategy}] ${elapsed}ms`
    )
  }

  res.on('finish', cleanup)
  res.on('close',  cleanup)


  proxy.web(req, res, { target: chosen.url })
}