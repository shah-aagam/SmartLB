import http from 'http';

const PORT = 3001;
const SERVER_ID = 'backend-1';

const LATENCIES = {
  '/health': 5,
  '/api/auth': 30,      
  '/api/products': 100  
};

const server = http.createServer((req, res) => {

  if (req.url === '/api/timeout') {
  console.log(`[${SERVER_ID}] /api/timeout received — intentionally waiting 30s`);

  setTimeout(() => {
    console.log(`[${SERVER_ID}] /api/timeout sending response`);

    res.writeHead(200, {
      'Content-Type': 'text/plain'
    });

    res.end('Backend eventually responded');
  }, 30000);

  return;
}

    // Streaming test endpoint
  if (req.url === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'X-Served-By': SERVER_ID
    });

    res.write('chunk 1\n');

    setTimeout(() => {
      res.write('chunk 2\n');
    }, 2000);

    setTimeout(() => {
      res.write('chunk 3\n');
    }, 4000);

    setTimeout(() => {
      res.write('chunk 4\n');
      res.end();
    }, 6000);

    return;
  }

  const delay = LATENCIES[req.url] || 10;

  setTimeout(() => {
    if (req.url === '/health' || req.url === '/api/auth' || req.url === '/api/products') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Served-By': SERVER_ID
      });
      res.end(JSON.stringify({
          server: SERVER_ID,
          headers: req.headers
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    }
  }, delay);
});

server.listen(PORT, () => {
  console.log(`[${SERVER_ID}] Listening on http://localhost:${PORT}`);
});




// TO TEST FAILING (circuit breakers closed - open - half open - closed ) use below code :
// import http from 'http';

// const PORT = 3001;
// const SERVER_ID = 'backend-1';

// const LATENCIES = {
//   '/health': 5,
//   '/api/auth': 30,       // Fastest for /api/auth
//   '/api/products': 10000, // Slowest for /api/products
//   '/api/fail': 10         // Delay for /api/fail endpoint
// };

// const server = http.createServer((req, res) => {
//   const delay = LATENCIES[req.url] || 10;

//   setTimeout(() => {
//     if (req.url === '/api/fail') {
//       res.writeHead(500, {
//         'Content-Type': 'application/json',
//         'X-Served-By': SERVER_ID
//       });
//       res.end(JSON.stringify({ error: 'Internal Server Error', server: SERVER_ID }));
//     } else if (req.url === '/health' || req.url === '/api/auth' || req.url === '/api/products') {
//       res.writeHead(200, {
//         'Content-Type': 'application/json',
//         'X-Served-By': SERVER_ID
//       });
//       res.end(JSON.stringify({ server: SERVER_ID }));
//     } else {
//       res.writeHead(404, { 'Content-Type': 'application/json' });
//       res.end(JSON.stringify({ error: 'Not Found' }));
//     }
//   }, delay);
// });

// server.listen(PORT, () => {
//   console.log(`[${SERVER_ID}] Listening on http://localhost:${PORT}`);
// });