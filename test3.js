import http from 'http';

const PORT = 3003;
const SERVER_ID = 'backend-3';

const LATENCIES = {
  '/health': 5,
  '/api/auth': 250,      
  '/api/products': 120  
};

const server = http.createServer((req, res) => {
  const delay = LATENCIES[req.url] || 10;

  setTimeout(() => {
    if (req.url === '/health' || req.url === '/api/auth' || req.url === '/api/products') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Served-By': SERVER_ID
      });
      res.end(JSON.stringify({ server: SERVER_ID }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    }
  }, delay);
});

server.listen(PORT, () => {
  console.log(`[${SERVER_ID}] Listening on http://localhost:${PORT}`);
});