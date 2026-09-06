// import httpProxy from 'http-proxy'
// import registry from '../registry/tenantRegistry.js'
// import { pickServer } from '../strategies/index.js'
// import { recordFailure, recordSuccess } from '../registry/tenantRegistry.js'
// import { totalRequests, backendRequests, successRequests } from '../metrics/prometheus.js'

// let requestCounter = 0

// function normalizePath(url) {
//   try {
//     const parsed = new URL(url, 'http://smartlb.local')
//     let pathname = parsed.pathname || '/'
//     if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1)
//     return pathname
//   } catch {
//     return url.split('?')[0] || '/'
//   }
// }

// function isRetryable(req) {
//   return ['GET', 'HEAD', 'OPTIONS'].includes(req.method?.toUpperCase())
// }

// const proxy = httpProxy.createProxyServer({
//   changeOrigin: true,
//   // timeout: 10000,
//   proxyTimeout: 10000
// })

// proxy.on('error', (err, req, res) => {
//   const reqId = req.reqId
//   const serverId = req.__chosenServer
//   const host = req.__host

//   console.error(
//     `[req:${reqId}] [proxy:error] ` +
//     `server=${serverId} ` +
//     `code=${err.code || 'UNKNOWN'} ` +
//     `message=${err.message}`
//   )

//   console.error(
//     `[req:${reqId}] [proxy:error-detail] ` +
//     `code=${err.code || 'NONE'} ` +
//     `name=${err.name || 'NONE'} ` +
//     `message=${err.message} ` +
//     `upstream=${req.__chosenServerUrl}`
//   )

//   if (serverId && host) {
//     recordFailure(host, serverId)
//   }

//   if (
//     isRetryable(req) &&
//     req.__retryAttempt === 0 &&
//     req.__serverPool?.length > 1 &&
//     !res.headersSent
//   ) {
//     const nextId = req.__serverPool.find(id => id !== serverId)
//     const next = nextId ? registry.getServer(host, nextId) : null

//     if (next) {
//       console.log(
//         `[req:${reqId}] [retry] NETWORK → ${serverId} → ${next.id}`
//       )

//       registry.decrementConnections(host, serverId)
//       registry.incrementConnections(host, next.id)

//       req.__chosenServer = next.id
//       req.__chosenServerUrl = next.url
//       req.__retryAttempt = 1

//       req.__attempts.push({
//         server: next.id,
//         url: next.url,
//         start: Date.now()
//       })

//       return proxy.web(req, res, {
//         target: next.url
//       })
//     }
//   }

//   if (!res.headersSent && !res.writableEnded) {
//     res.writeHead(502, {
//       'Content-Type': 'application/json'
//     })

//     res.end(JSON.stringify({
//       error: 'Bad Gateway',
//       requestId: reqId
//     }))
//   }
// })

// proxy.on('proxyRes', (proxyRes, req, res) => {
//   const status = proxyRes.statusCode || 502
//   const serverId = req.__chosenServer
//   const host = req.__host

//   if (status >= 500) {
//     console.log(`[req:${req.reqId}] [upstream:${status}] ${serverId}`)
//     recordFailure(host, serverId)
//   } else {
//     recordSuccess(host, serverId)
//   }
// })

// export function handleRequest(req, res) {
//   const reqId = ++requestCounter
//   totalRequests.inc()

//   req.reqId = reqId
//   req.__retryAttempt = 0
//   req.__attempts = []
//   req.normalizedPath = normalizePath(req.url)

//   console.log(`\n[request:${reqId}] ${req.method} ${req.url}`)

//   const host = (req.headers.host || '').split(':')[0].toLowerCase().trim()
//   if (!host) {
//     res.writeHead(400, { 'Content-Type': 'application/json' })
//     return res.end(JSON.stringify({ error: 'Missing Host header' }))
//   }

//   const tenant = registry.getTenant(host)
//   if (!tenant) {
//     res.writeHead(404, { 'Content-Type': 'application/json' })
//     return res.end(JSON.stringify({ error: `No tenant found for: ${host}` }))
//   }

//   const serverPool = registry.getRoutableServers(host)
//   if (serverPool.length === 0) {
//     res.writeHead(503, { 'Content-Type': 'application/json' })
//     return res.end(JSON.stringify({ error: 'Service Unavailable — no servers available' }))
//   }

//   const clientIp = (
//     req.headers['x-forwarded-for'] ||
//     req.socket.remoteAddress ||
//     '0.0.0.0'
//   ).split(',')[0].trim()

//   const chosen = pickServer(tenant, serverPool, clientIp, req)
//   if (!chosen || !registry.acquireCircuitProbe(host, chosen.id)) {
//     res.writeHead(503, { 'Content-Type': 'application/json' })
//     return res.end(JSON.stringify({ error: 'No server available' }))
//   }

//   req.__chosenServer = chosen.id
//   req.__chosenServerUrl = chosen.url
//   backendRequests.inc({
//     backend: chosen.url
//   })
//   req.__host = host
//   req.__serverPool = serverPool.map(server => server.id)
//   req.__attempts.push({ server: chosen.id, url: chosen.url, start: Date.now() })

//   req.headers['x-forwarded-for'] = clientIp
//   req.headers['x-forwarded-host'] = host
//   req.headers['x-forwarded-proto'] = req.socket.encrypted ? 'https' : 'http'
//   req.headers['x-real-ip'] = clientIp
//   req.headers['x-smartlb-tenant'] = host
//   req.headers['x-smartlb-request-id'] = String(reqId)

//   registry.incrementConnections(host, chosen.id)

//   let cleaned = false
//   const cleanup = () => {
//     if (cleaned) return
//     cleaned = true

//     if (res.statusCode >= 200 && res.statusCode < 500) {
//       successRequests.inc()
//     }

//     registry.decrementConnections(host, req.__chosenServer)

//     for (const attempt of req.__attempts) {
//       const elapsed = Date.now() - attempt.start

//       registry.recordResponseTime(
//         host,
//         attempt.server,
//         elapsed,
//         req.method,
//         req.normalizedPath
//       )
//     }

//     console.log(
//       `[req:${reqId}] ` +
//       `${req.method} ${host}${req.url} → ${req.__chosenServerUrl} ` +
//       `[${tenant.strategy}] ` +
//       `status=${res.statusCode || 'NO_RESPONSE'} ` +
//       `attempts=${req.__attempts.length}`
//     )
//   }

//   res.on('finish', cleanup)
//   res.on('close', cleanup)

//   proxy.web(req, res, { target: chosen.url })
// }





import httpProxy from 'http-proxy'
import registry from '../registry/tenantRegistry.js'
import { pickServer } from '../strategies/index.js'
import { recordFailure, recordSuccess } from '../registry/tenantRegistry.js'
import {
  totalRequests,
  successRequests,
  failedRequests,
  backendRequests,
  backendErrors,
  requestDuration,
  backendConnections
} from '../metrics/prometheus.js'

let requestCounter = 0

function normalizePath(url) {
  try {
    const parsed = new URL(url, 'http://smartlb.local')
    let pathname = parsed.pathname || '/'
    if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1)
    return pathname
  } catch {
    return url.split('?')[0] || '/'
  }
}

function isRetryable(req) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(req.method?.toUpperCase())
}

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  // timeout: 10000,
  proxyTimeout: 10000
})

proxy.on('error', (err, req, res) => {
  const reqId = req.reqId
  const serverId = req.__chosenServer
  const host = req.__host

  console.error(
    `[req:${reqId}] [proxy:error] ` +
    `server=${serverId} ` +
    `code=${err.code || 'UNKNOWN'} ` +
    `message=${err.message}`
  )

  console.error(
    `[req:${reqId}] [proxy:error-detail] ` +
    `code=${err.code || 'NONE'} ` +
    `name=${err.name || 'NONE'} ` +
    `message=${err.message} ` +
    `upstream=${req.__chosenServerUrl}`
  )

  if (serverId && host) {
    recordFailure(host, serverId)
  }

  // Metric: backend/network/proxy error
  if (req.__chosenServerUrl) {
    backendErrors.inc({
      backend: req.__chosenServerUrl
    })
  }

  if (
    isRetryable(req) &&
    req.__retryAttempt === 0 &&
    req.__serverPool?.length > 1 &&
    !res.headersSent
  ) {
    const nextId = req.__serverPool.find(id => id !== serverId)
    const next = nextId ? registry.getServer(host, nextId) : null

    if (next) {
      console.log(
        `[req:${reqId}] [retry] NETWORK → ${serverId} → ${next.id}`
      )

      registry.decrementConnections(host, serverId)

      backendConnections.dec({
        backend: req.__chosenServerUrl
      })

      registry.incrementConnections(host, next.id)

      backendConnections.inc({
        backend: next.url
      })

      req.__chosenServer = next.id
      req.__chosenServerUrl = next.url
      req.__retryAttempt = 1

      req.__attempts.push({
        server: next.id,
        url: next.url,
        start: Date.now()
      })

      backendRequests.inc({
        backend: next.url
      })

      return proxy.web(req, res, {
        target: next.url
      })
    }
  }

  if (!res.headersSent && !res.writableEnded) {
    res.writeHead(502, {
      'Content-Type': 'application/json'
    })

    res.end(JSON.stringify({
      error: 'Bad Gateway',
      requestId: reqId
    }))
  }
})

proxy.on('proxyRes', (proxyRes, req, res) => {
  const status = proxyRes.statusCode || 502
  const serverId = req.__chosenServer
  const host = req.__host

  if (status >= 500) {
    console.log(`[req:${req.reqId}] [upstream:${status}] ${serverId}`)

    backendErrors.inc({
      backend: req.__chosenServerUrl
    })

    recordFailure(host, serverId)
  } else {
    recordSuccess(host, serverId)
  }
})

export function handleRequest(req, res) {
  const reqId = ++requestCounter
  totalRequests.inc()

  req.reqId = reqId
  req.__retryAttempt = 0
  req.__attempts = []
  req.normalizedPath = normalizePath(req.url)

  console.log(`\n[request:${reqId}] ${req.method} ${req.url}`)

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

  const serverPool = registry.getRoutableServers(host)
  if (serverPool.length === 0) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: 'Service Unavailable — no servers available' }))
  }

  const clientIp = (
    req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress ||
    '0.0.0.0'
  ).split(',')[0].trim()

  const chosen = pickServer(tenant, serverPool, clientIp, req)
  if (!chosen || !registry.acquireCircuitProbe(host, chosen.id)) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: 'No server available' }))
  }

  req.__chosenServer = chosen.id
  req.__chosenServerUrl = chosen.url

  // Metric: request routed to backend
  backendRequests.inc({
    backend: chosen.url
  })

  req.__host = host
  req.__serverPool = serverPool.map(server => server.id)
  req.__attempts.push({
    server: chosen.id,
    url: chosen.url,
    start: Date.now()
  })

  req.headers['x-forwarded-for'] = clientIp
  req.headers['x-forwarded-host'] = host
  req.headers['x-forwarded-proto'] = req.socket.encrypted ? 'https' : 'http'
  req.headers['x-real-ip'] = clientIp
  req.headers['x-smartlb-tenant'] = host
  req.headers['x-smartlb-request-id'] = String(reqId)

  registry.incrementConnections(host, chosen.id)

  // Metric: active connection to this backend
  backendConnections.inc({
    backend: chosen.url
  })

  let cleaned = false

  const cleanup = () => {
    if (cleaned) return
    cleaned = true

    // Metric: final request result
    if (res.statusCode >= 200 && res.statusCode < 500) {
      successRequests.inc()
    } else {
      failedRequests.inc()
    }

    registry.decrementConnections(host, req.__chosenServer)

    // Metric: backend connection finished
    backendConnections.dec({
      backend: req.__chosenServerUrl
    })

    for (const attempt of req.__attempts) {
      const elapsed = Date.now() - attempt.start

      registry.recordResponseTime(
        host,
        attempt.server,
        elapsed,
        req.method,
        req.normalizedPath
      )

      // Metric: request latency
      requestDuration.observe(
        {
          backend: attempt.url
        },
        elapsed / 1000
      )
    }

    console.log(
      `[req:${reqId}] ` +
      `${req.method} ${host}${req.url} → ${req.__chosenServerUrl} ` +
      `[${tenant.strategy}] ` +
      `status=${res.statusCode || 'NO_RESPONSE'} ` +
      `attempts=${req.__attempts.length}`
    )
  }

  res.on('finish', cleanup)
  res.on('close', cleanup)

  proxy.web(req, res, { target: chosen.url })
}