export function evaluateRules(rules, req, host, allServers) {
  if (!rules || rules.length === 0) return null

  const method  = req.method?.toUpperCase()
  const url     = req.url || '/'
  const headers = req.headers

  // Extract subdomain from host (api.amazon.com → "api")
  const hostParts = host.split('.')
  const subdomain = hostParts.length > 2 ? hostParts[0] : null

  for (const rule of rules) {
    if (matchesRule(rule.match, { method, url, headers, subdomain })) {
      const targetServers = resolveTargetServers(rule.target.servers, allServers)

      if (targetServers.length === 0) {
        console.warn(`[rules] Rule matched but no target servers available:`, rule.description ?? rule)
        continue 
      }

      console.log(`[rules] Rule matched: "${rule.description ?? 'unnamed'}" → ${targetServers.length} server(s)`)

      return {
        servers:  targetServers,
        strategy: rule.target.strategy ?? null  
      }
    }
  }

  return null 
}


function matchesRule(match, { method, url, headers, subdomain }) {
  if (!match) return false

  if (match.path && !url.startsWith(match.path)) return false

  if (match.method && method !== match.method.toUpperCase()) return false

  if (match.header) {
    const headerVal = headers[match.header.name.toLowerCase()]
    if (headerVal !== match.header.value) return false
  }

  if (match.subdomain && subdomain !== match.subdomain) return false

  return true 
}

function resolveTargetServers(targetUrls, allServers) {
  if (!targetUrls || targetUrls.length === 0) return allServers

  const urlSet = new Set(targetUrls)
  return allServers.filter(s => urlSet.has(s.url))
}