import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

let io = null;

export function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    }
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
    if (!token) {
      return next(new Error('Authentication error: Token missing'));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'hfa_portal_secret_key_2024_@!');
      socket.user = decoded; // { id, role }
      next();
    } catch (err) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    const role = socket.user.role;

    // Join user-specific room
    socket.join(userId);

    // If admin/staff role, join admins room
    if (['superadmin', 'admin', 'staff', 'food_tech_manager', 'food_tech'].includes(role)) {
      socket.join('admins');
    }

    console.log(`🔌 Socket connected: User ${userId} (${role}), Socket ID: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: Socket ID: ${socket.id}`);
    });
  });

  return io;
}

export function getIO() {
  return io;
}

export function emitToUser(userId, event, data) {
  if (io) {
    io.to(userId.toString()).emit(event, data);
  }
}

export function emitToAdmins(event, data) {
  if (io) {
    io.to('admins').emit(event, data);
  }
}

export function emitApplicationUpdate(app, eventType) {
  if (!io || !app) return;
  const appId = app._id || app.id;
  const clientId = app.client_id;
  const status = app.status;

  const payload = { appId, status, eventType };

  // Always emit to admins
  io.to('admins').emit('application_updated', payload);

  // Client-invisibility rule: do not emit logsheet-related events to the client room
  const isLogsheetEvent = status === 'logsheet_created' || status === 'logsheet_signed';
  if (clientId && !isLogsheetEvent) {
    io.to(clientId.toString()).emit('application_updated', payload);
  }
}

export function emitAddOnUpdate(app, eventType) {
  if (!io || !app) return;
  const addOnId = app._id || app.id;
  const clientId = app.client_id;
  const status = app.status;

  const payload = { addOnId, status, eventType };

  io.to('admins').emit('addon_updated', payload);
  if (clientId) {
    io.to(clientId.toString()).emit('addon_updated', payload);
  }
}
