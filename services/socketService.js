const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');

let io = null;

function initSocketIO(server) {
  io = socketIO(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST'],
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
      socket.employeeId = decoded.id;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] Employee connected: ${socket.employeeId}`);
    socket.join(`employee:${socket.employeeId}`);

    socket.on('disconnect', () => {
      console.log(`[Socket] Employee disconnected: ${socket.employeeId}`);
    });
  });

  console.log('[Socket] Initialized');
  return io;
}

function getIO() { return io; }

function emitToUser(employeeId, event, data) {
  if (!io) return;
  io.to(`employee:${employeeId}`).emit(event, { ...data, _socket: true, _timestamp: new Date().toISOString() });
}

function emitToAll(event, data) {
  if (!io) return;
  io.emit(event, { ...data, _socket: true, _timestamp: new Date().toISOString() });
}

module.exports = { initSocketIO, getIO, emitToUser, emitToAll };
