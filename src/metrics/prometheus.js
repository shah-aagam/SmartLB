import client from 'prom-client'

const register = new client.Registry()

client.collectDefaultMetrics({
  register
})

const totalRequests = new client.Counter({
  name: 'smartlb_requests_total',
  help: 'Total requests received'
})

const successRequests = new client.Counter({
  name: 'smartlb_success_total',
  help: 'Total successful requests'
})

const failedRequests = new client.Counter({
  name: 'smartlb_failure_total',
  help: 'Total failed requests'
})

const backendRequests = new client.Counter({
  name: 'smartlb_backend_requests_total',
  help: 'Requests routed to backend servers',
  labelNames: ['backend']
})

const backendErrors = new client.Counter({
  name: 'smartlb_backend_errors_total',
  help: 'Backend requests resulting in an error',
  labelNames: ['backend']
})

const requestDuration = new client.Histogram({
  name: 'smartlb_request_duration_seconds',
  help: 'Request latency in seconds',
  labelNames: ['backend'],
  buckets: [
    0.05,
    0.1,
    0.2,
    0.5,
    1,
    2,
    5,
    10
  ]
})

const backendConnections = new client.Gauge({
  name: 'smartlb_backend_connections',
  help: 'Current active connections to backend servers',
  labelNames: ['backend']
})

const backendHealth = new client.Gauge({
  name: 'smartlb_backend_health',
  help: 'Backend health status: 1 healthy, 0 unhealthy',
  labelNames: ['backend']
})

const circuitState = new client.Gauge({
  name: 'smartlb_circuit_state',
  help: 'Circuit state: 0 CLOSED, 1 OPEN, 2 HALF_OPEN',
  labelNames: ['backend']
})

register.registerMetric(totalRequests)
register.registerMetric(successRequests)
register.registerMetric(failedRequests)
register.registerMetric(backendRequests)
register.registerMetric(backendErrors)
register.registerMetric(requestDuration)
register.registerMetric(backendConnections)
register.registerMetric(backendHealth)
register.registerMetric(circuitState)

export {
  register,
  totalRequests,
  successRequests,
  failedRequests,
  backendRequests,
  backendErrors,
  requestDuration,
  backendConnections,
  backendHealth,
  circuitState
}