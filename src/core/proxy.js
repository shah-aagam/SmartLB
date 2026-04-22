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

function isRetryable(req) {
  const method = req.method?.toUpperCase()
  return ['GET', 'HEAD', 'OPTIONS'].includes(method)
}

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  timeout: 10000,
  selfHandleResponse: true
})



proxy.on('error', (err, req, res) => {
  const reqId = req.reqId
  const server = req.__chosenServer
  const host = req.__host

  console.error(`[req:${reqId}] [proxy:error] ${server} → ${err.message}`)

  if (server && host) {
    recordFailure(host, server)
  }

  if (
    isRetryable(req) &&
    req.__retryAttempt === 0 &&
    req.__serverPool?.length > 1 &&
    !res.headersSent
  ) {
    const next = req.__serverPool.find(s => s !== server)

    if (next) {
      console.log(`[req:${reqId}] [retry] NETWORK → ${server} → ${next}`)

      registry.decrementConnections(host, server)
      registry.incrementConnections(host, next)

      req.__chosenServer = next
      req.__retryAttempt = 1

      req.__attempts.push({ server: next, start: Date.now() })

      return proxy.web(req, res, { target: next })
    }
  }

  if (!res.headersSent) {
    res.writeHead(502)
    res.end('Bad Gateway')
  }
})



proxy.on('proxyRes', (proxyRes, req, res) => {
  const reqId = req.reqId
  const server = req.__chosenServer
  const host = req.__host

  let body = []

  proxyRes.on('data', chunk => body.push(chunk))

  proxyRes.on('end', () => {
    body = Buffer.concat(body).toString()
    const status = proxyRes.statusCode

    if (status >= 500) {
      console.log(`[req:${reqId}] [FAIL] ${server}`)
      recordFailure(host, server)

      if (
        isRetryable(req) &&
        req.__retryAttempt === 0 &&
        req.__serverPool?.length > 1
      ) {
        const next = req.__serverPool.find(s => s !== server)

        if (next) {
          console.log(`[req:${reqId}] [retry] ${server} → ${next}`)

          registry.decrementConnections(host, server)
          registry.incrementConnections(host, next)

          req.__chosenServer = next
          req.__retryAttempt = 1

          req.__attempts.push({ server: next, start: Date.now() })

          return proxy.web(req, res, { target: next })
        }
      }

      res.writeHead(status)
      return res.end(body)
    }

    recordSuccess(host, server)

    res.writeHead(status)
    res.end(body)
  })
})

export function handleRequest(req, res) {
  const reqId = ++requestCounter
  req.reqId = reqId
  req.__retryAttempt = 0
  req.__attempts = []

  console.log(`\n REQUEST ${reqId}`)
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

  const rules     = registry.getRules(host)
  const ruleMatch = evaluateRules(rules, req, host, routableServers)

  const serverPool = ruleMatch?.servers  ?? routableServers
  const strategy   = ruleMatch?.strategy ?? tenant.strategy

  const effectiveTenant =
    strategy !== tenant.strategy
      ? { ...tenant, strategy }
      : tenant

  const clientIp = (
    req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress ||
    '0.0.0.0'
  )
    .split(',')[0]
    .trim()

  req.normalizedPath = normalizePath(req.url)

  const chosen = pickServer(effectiveTenant, serverPool, clientIp, req)

  if (!chosen) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: 'No server available' }))
  }

  req.__chosenServer = chosen.url
  req.__host = host
  req.__serverPool = serverPool.map(s => s.url)

  req.__attempts.push({
    server: chosen.url,
    start: Date.now()
  })

  req.headers['x-forwarded-for']  = clientIp
  req.headers['x-forwarded-host'] = host
  req.headers['x-real-ip']        = clientIp

  registry.incrementConnections(host, chosen.url)

  const startTime = Date.now()
  let cleaned = false

  const cleanup = () => {
    if (cleaned) return
    cleaned = true

    const totalElapsed = Date.now() - startTime

    registry.decrementConnections(host, req.__chosenServer)

    for (const attempt of req.__attempts) {
      const elapsed = Date.now() - attempt.start

      registry.recordResponseTime(
        host,
        attempt.server,
        elapsed,
        req.method,
        req.normalizedPath
      )
    }

    console.log(
      `[req:${reqId}] [proxy] ${req.method} ${host}${req.url} → ${req.__chosenServer} ` +
      `[${strategy}] total=${totalElapsed}ms attempts=${req.__attempts.length}`
    )
  }

  res.on('finish', cleanup)
  res.on('close',  cleanup)

  proxy.web(req, res, { target: chosen.url })
}