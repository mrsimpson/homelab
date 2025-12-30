const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Hello from Node.js Demo App!',
    version: process.env.APP_VERSION || 'dev',
    timestamp: new Date().toISOString(),
    hostname: require('os').hostname(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/ready', (req, res) => {
  res.json({
    status: 'ready',
    timestamp: new Date().toISOString()
  });
});

app.get('/info', (req, res) => {
  res.json({
    app: 'nodejs-demo',
    version: process.env.APP_VERSION || 'dev',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB',
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB'
    }
  });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`✨ Node.js Demo App listening on port ${port}`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🚀 Version: ${process.env.APP_VERSION || 'dev'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('⚠️  SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('⚠️  SIGINT received, shutting down gracefully');
  process.exit(0);
});
