const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

console.log('Starting simple test server...');
console.log('PORT:', PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);

app.get('/', (req, res) => {
  console.log('GET / request received');
  res.json({
    status: 'working!',
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

app.get('*', (req, res) => {
  console.log('Request to:', req.path);
  res.json({ path: req.path, message: 'any route works' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅✅✅ SIMPLE TEST SERVER RUNNING ON PORT ${PORT} ✅✅✅`);
  console.log(`Listening on 0.0.0.0:${PORT}`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
});

server.on('listening', () => {
  console.log('Server is definitely listening!');
});