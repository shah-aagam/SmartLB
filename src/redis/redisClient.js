import { createClient } from 'redis'

const redisUrl = process.env.REDIS_URL
let client = null
let connectPromise = null

if (redisUrl) {
  client = createClient({ url: redisUrl })
  client.on('error', err => console.error('[redis] Error:', err.message))
}

export async function getRedisClient() {
  if (!client) return null
  if (!connectPromise) {
    connectPromise = client.connect().catch(err => {
      console.error('[redis] Connection failed:', err.message)
      connectPromise = null
      return null
    })
  }
  await connectPromise
  return client.isReady ? client : null
}

export default client
