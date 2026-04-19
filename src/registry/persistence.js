import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

const DATA_DIR  = path.join(__dirname, '..', '..', 'data')
const DATA_FILE = path.join(DATA_DIR, 'tenants.json')


export function saveTenants(allTenants) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }

    const toSave = allTenants.map(tenant => ({
      domain:   tenant.domain,
      strategy: tenant.strategy,
      servers:  tenant.servers.map(s => ({ url: s.url }))
    }))

    fs.writeFileSync(DATA_FILE, JSON.stringify({ tenants: toSave }, null, 2), 'utf8')
    console.log(`[persist] Saved ${toSave.length} tenant(s) to data/tenants.json`)
  } catch (err) {
    console.error(`[persist] Failed to save: ${err.message}`)
  }
}


export function loadTenants() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      console.log('[persist] No tenants.json found — fresh start')
      return []
    }

    const raw    = fs.readFileSync(DATA_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    const tenants = parsed.tenants ?? []

    console.log(`[persist] Loaded ${tenants.length} tenant(s) from data/tenants.json`)
    return tenants
  } catch (err) {
    console.error(`[persist] Failed to load tenants.json: ${err.message}`)
    return []
  }
}