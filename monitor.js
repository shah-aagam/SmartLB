import http from 'http'
import Table from 'cli-table3'

function fetchServers(callback) {
  http.get('http://localhost:9000/servers', (res) => {
    let data = ''

    res.on('data', chunk => data += chunk)

    res.on('end', () => {
      try {
        const parsed = JSON.parse(data)
        callback(parsed)
      } catch (err) {
        console.log('JSON Parse Error:', err.message)
        callback(null)
      }
    })
  }).on('error', (err) => {
    console.log('HTTP Error:', err.message)
    callback(null)
  })
}

function formatResponseTime(value) {
  if (value === null || value === undefined) return 'N/A'

  if (typeof value === 'string') return value

  if (typeof value === 'number') return `${value.toFixed(2)} ms`

  return 'N/A'
}

function render() {
  fetchServers((data) => {
    console.clear()
    console.log('SMART LOAD BALANCER MONITOR\n')

    if (!data || !data.tenants) {
      console.log('Failed to fetch data from API\n')
      console.log('Make sure LB is running on port 9000')
      return
    }

    for (const tenant of data.tenants) {
      console.log(`Tenant: ${tenant.domain} | Strategy: ${tenant.strategy}\n`)


      const table = new Table({
        head: ['Server', 'Healthy', 'Draining', 'Connections', 'Avg Resp'],
        colWidths: [30, 10, 12, 15, 15]
      })

      for (const server of tenant.servers) {
        table.push([
          server.url,
          server.healthy ? 'UP' : 'DOWN',
          server.draining ? '🟡' : '—',
          server.connections ?? 0,
          formatResponseTime(server.avgResponseTime)
        ])
      }

      console.log(table.toString())
      console.log('\n')

      console.log('Endpoint Performance\n')

      const endpointMap = {}

      for (const server of tenant.servers) {
        for (const stat of server.endpointStats || []) {
          if (!endpointMap[stat.endpoint]) {
            endpointMap[stat.endpoint] = []
          }

          endpointMap[stat.endpoint].push({
            url: server.url,
            avg: stat.avg,
            count: stat.count
          })
        }
      }

      if (Object.keys(endpointMap).length === 0) {
        console.log('No endpoint data yet (send some traffic)\n')
        continue
      }

      for (const [endpoint, list] of Object.entries(endpointMap)) {
        console.log(`🔹 ${endpoint}`)

        const best = list.reduce((min, s) => s.avg < min.avg ? s : min)

        for (const s of list) {
          const isBest = s.url === best.url ? ' BEST' : ''
          console.log(
            `   ${s.url} → ${s.avg.toFixed(2)} ms (n=${s.count}) ${isBest}`
          )
        }

        console.log('')
      }
    }

    console.log('⏱ Refreshing every 2 seconds...')
  })
}

// ── Start monitor ────────────────────────────────────────────────────────────
setInterval(render, 2000)