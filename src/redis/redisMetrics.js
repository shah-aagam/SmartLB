import { getRedisClient } from './redisClient.js'

async function increment(key, amount) {
  const client = await getRedisClient()
  if (!client) return
  await client.incrBy(key, amount)
}

function key(type, url) {
  return `server:${url}:${type}`
}

export const incrementConnectionsRedis = url => increment(key('connections', url), 1)
export const decrementConnectionsRedis = url => increment(key('connections', url), -1)
export const incrementSuccessRedis = url => increment(key('success', url), 1)
export const incrementFailureRedis = url => increment(key('failure', url), 1)

export async function getConnectionsRedis(url) {
  const client = await getRedisClient()
  if (!client) return 0
  return Number((await client.get(key('connections', url))) || 0)
}

export async function getSuccessRedis(url) {
  const client = await getRedisClient()
  if (!client) return 0
  return Number((await client.get(key('success', url))) || 0)
}

export async function getFailureRedis(url) {
  const client = await getRedisClient()
  if (!client) return 0
  return Number((await client.get(key('failure', url))) || 0)
}
