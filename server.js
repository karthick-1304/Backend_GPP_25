// server.js
import dotenv from 'dotenv';
dotenv.config({ path: './config.env' });

import app from './src/app.js';
import {pool} from './src/config/db.js';

const PORT = process.env.PORT || 5000;

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    pool.end();
    console.log('MySQL pool closed. Server shut down.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down...');
  server.close(() => {
    pool.end();
    console.log('Server stopped. Goodbye.');
    process.exit(0);
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║     GATE PORTAL — THE FUTURE OF INDIAN EDUCATION         ║
║                                                           ║
║     Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}        ║
║     MySQL Connected Successfully                         ║
║                                                           ║
║     THE EMPIRE IS LIVE.                                   ║
║     THE KING HAS DEPLOYED.                                ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.log('UNHANDLED REJECTION! Shutting down...');
  console.log(err.name, err.message);
  server.close(() => {
    process.exit(1);
  });
});

export default server;