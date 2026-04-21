// import Table from 'cli-table3'
// import fetch from 'node-fetch'

// const API = 'http://localhost:9000/servers'

// async function render() {
//   console.clear()
//   console.log('🚀 SMART LOAD BALANCER MONITOR\n')

//   let data

//   try {
//     const res = await fetch(API)
//     data = await res.json()
//   } catch (err) {
//     console.log('❌ Failed to fetch data from API\n')
//     return
//   }

//   for (const tenant of data.tenants) {
//     console.log(`🌐 Tenant: ${tenant.domain} | Strategy: ${tenant.strategy}\n`)

//     // ───────── SERVER TABLE ─────────
//     const table = new Table({
//       head: ['Server', 'Healthy', 'Connections', 'P95 (ms)'],
//       colWidths: [30, 10, 15, 15]
//     })

//     for (const server of tenant.servers) {
//       table.push([
//         server.url,
//         server.healthy ? '✅' : '❌',
//         server.connections,
//         server.p95 && server.p95 !== Infinity
//           ? server.p95.toFixed(0)
//           : 'N/A'
//       ])
//     }

//     console.log(table.toString())

//     // ───────── ENDPOINT STATS ─────────
//     console.log('\n📊 Endpoint Performance\n')

//     const endpointMap = {}

//     // collect endpoints from all servers
//     for (const server of tenant.servers) {
//       for (const key in server.endpointStats || {}) {
//         if (!endpointMap[key]) endpointMap[key] = []
//       }
//     }

//     for (const key of Object.keys(endpointMap)) {
//       console.log(`🔹 ${key}`)

//       let best = null

//       for (const server of tenant.servers) {
//         const stat = server.endpointStats?.[key]

//         if (!stat || stat.count === 0) continue

//         if (!best || stat.avg < best.avg) {
//           best = { url: server.url, avg: stat.avg }
//         }
//       }

//       for (const server of tenant.servers) {
//         const stat = server.endpointStats?.[key]

//         if (!stat || stat.count === 0) continue

//         const isBest = best && best.url === server.url

//         console.log(
//           `   ${server.url} → ${stat.avg.toFixed(2)} ms (n=${stat.count}) ${
//             isBest ? '🔥 BEST' : ''
//           }`
//         )
//       }

//       console.log('')
//     }
//   }

//   console.log('⏱ Refreshing every 2 seconds...\n')
// }

// setInterval(render, 2000)







import Table from 'cli-table3'
import fetch from 'node-fetch'

const API = 'http://localhost:9000/servers'

function formatCircuit(server) {
  const c = server.circuit || {}

  switch (c.state) {
    case 'OPEN':
      return `🔴 OPEN (${c.failures || 0})`
    case 'HALF':
      return `🟡 HALF`
    case 'CLOSED':
      return `🟢 CLOSED`
    default:
      return `No state`
  }
}

async function render() {
  console.clear()
  console.log('🚀 SMART LOAD BALANCER MONITOR\n')

  let data

  try {
    const res = await fetch(API)
    data = await res.json()
  } catch (err) {
    console.log('❌ Failed to fetch data from API\n')
    return
  }

  for (const tenant of data.tenants) {
    console.log(`🌐 Tenant: ${tenant.domain} | Strategy: ${tenant.strategy}\n`)

    // ───────── SERVER TABLE ─────────
    const table = new Table({
      head: ['Server', 'Healthy', 'Circuit', 'Conn', 'P95 (ms)'],
      colWidths: [30, 10, 20, 10, 15]
    })

    for (const server of tenant.servers) {
      table.push([
        server.url,
        server.healthy ? '✅' : '❌',
        formatCircuit(server),
        server.connections,
        server.p95 && server.p95 !== Infinity
          ? server.p95.toFixed(0)
          : 'N/A'
      ])
    }

    console.log(table.toString())

    // ───────── ENDPOINT STATS ─────────
    console.log('\n📊 Endpoint Performance\n')

    const endpointMap = {}

    // collect all endpoints
    for (const server of tenant.servers) {
      for (const key in server.endpointStats || {}) {
        if (!endpointMap[key]) endpointMap[key] = true
      }
    }

    for (const key of Object.keys(endpointMap)) {
      console.log(`🔹 ${key}`)

      let best = null

      for (const server of tenant.servers) {
        const stat = server.endpointStats?.[key]
        if (!stat || stat.count === 0) continue

        if (!best || stat.avg < best.avg) {
          best = { url: server.url, avg: stat.avg }
        }
      }

      for (const server of tenant.servers) {
        const stat = server.endpointStats?.[key]
        if (!stat || stat.count === 0) continue

        const isBest = best && best.url === server.url

        console.log(
          `   ${server.url} → ${stat.avg.toFixed(2)} ms (n=${stat.count}) ${
            isBest ? ' BEST' : ''
          }`
        )
      }

      console.log('')
    }
  }

  console.log('⏱ Refreshing every 2 seconds...\n')
}

setInterval(render, 2000)