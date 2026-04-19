/**
 * index.js — Load Balancer entry point
 *
 * Starts two HTTP servers:
 *   :8080  — Proxy server (receives real client traffic)
 *   :9000  — Management API (registration, admin)
 *
 * Boot sequence:
 *   1. Load config.yaml
 *   2. Seed tenant registry from config (Mode A)
 *   3. Start health checker background job
 *   4. Start proxy server on :8080
 *   5. Start management API on :9000
 */

import http from 'http'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

import { handleRequest } from './src/core/proxy.js'
import registry from './src/registry/tenantRegistry.js'
import { startHealthChecks } from './src/registry/healthChecker.js'
import registerRoutes from './src/api/register.js'
import { loadTenants } from './src/registry/persistence.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ── Step 1: Load config ───────────────────────────────────────────────────────
const configPath = path.join(__dirname, 'config', 'config.yaml')

if (!fs.existsSync(configPath)) {
  console.error(`[error] Config file not found at: ${configPath}`)
  process.exit(1)
}

const config = yaml.load(fs.readFileSync(configPath, 'utf8'))


console.log('Load Balancer Starting...   \n')


// ── Step 2: Load persisted tenants from data/tenants.json (Mode B) ────────────
const persistedTenants = loadTenants()

if (persistedTenants.length > 0) {
  console.log('[boot] Restoring dynamically registered tenants...')
  for (const tenant of persistedTenants) {
    registry.addTenant(tenant.domain, tenant.strategy)
    for (const server of tenant.servers ?? []) {
      registry.registerServer(tenant.domain, server.url)
    }
  }
}


// ── Step 3: Seed registry from config (Mode A) ───────────────────────────────
if (config.tenants && config.tenants.length > 0) {
  console.log('\n[boot] Loading static tenants from config.yaml...')
  for (const tenant of config.tenants) {
    registry.addTenant(tenant.domain, tenant.strategy)
    for (const server of tenant.servers) {
      registry.registerServer(tenant.domain, server.url)
    }
  }
  console.log(`[boot] Loaded ${config.tenants.length} tenant(s) from config`)
}

// ── Step 4: Start health checker ─────────────────────────────────────────────
startHealthChecks(config)

// ── Step 5: Start proxy server on :8080 ──────────────────────────────────────
const proxyServer = http.createServer(handleRequest)
const PROXY_PORT = config.proxy.port || 8080

proxyServer.listen(PROXY_PORT, () => {
  console.log(`\n[proxy] Traffic server listening on http://localhost:${PROXY_PORT}`)
  console.log(`        Send requests here with the correct Host header`)
})

// ── Step 6: Start management API on :9000 ────────────────────────────────────
const app = express()
app.use(express.json())

// Mount registration routes
app.use('/', registerRoutes)

// Health check for the LB itself
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }))

const API_PORT = config.api.port || 9000

app.listen(API_PORT, () => {
  console.log(`[api]   Management API listening on http://localhost:${API_PORT}`)
  console.log(`        POST /register    — register a server`)
  console.log(`        DELETE /register — deregister a server`)
  console.log(`        GET  /servers    — list all tenants & servers`)
  console.log('\n[boot] Load balancer ready!\n')
})

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('\n[shutdown] SIGTERM received, shutting down gracefully...')
  proxyServer.close(() => {
    console.log('[shutdown] Proxy server closed')
    process.exit(0)
  })
})
