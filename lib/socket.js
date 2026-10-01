import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Admin from '../models/Admin.js';

let io = null;

// In-memory mapping of active sockets: userId -> Set<socketId>
const activeSocketsByUser = new Map();
// Cache user metadata for fast socket notifications
const userMetaCache = new Map();

export function isUserOnline(userId) {
  if (!userId) return false;
  const sockets = activeSocketsByUser.get(userId.toString());
  return Boolean(sockets && sockets.size > 0);
}

export function getOnlineUserIds() {
  const onlineIds = [];
  for (const [userId, sockets] of activeSocketsByUser.entries()) {
    if (sockets && sockets.size > 0) {
      onlineIds.push(userId);
    }
  }
  return onlineIds;
}

export function emitToSuperadmins(event, data) {
  if (io) {
    io.to('superadmins').emit(event, data);
  }
}

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
      socket.user = decoded; // { id, role, modelType }
      next();
    } catch (err) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.user?.id ? socket.user.id.toString() : null;
    const role = socket.user?.role;
    const modelType = socket.user?.modelType || (role === 'client' ? 'User' : 'Admin');

    if (!userId) return;

    // Join user-specific room
    socket.join(userId);

    let userMeta = userMetaCache.get(userId);
    let isSuperAdmin = false;

    try {
      if (!userMeta) {
        if (modelType === 'Admin' || role !== 'client') {
          const adminDoc = await Admin.findById(userId).select('full_name username email role roles').lean();
          if (adminDoc) {
            isSuperAdmin = adminDoc.role === 'superadmin' || (Array.isArray(adminDoc.roles) && adminDoc.roles.includes('superadmin'));
            userMeta = {
              id: userId,
              name: adminDoc.full_name || adminDoc.username || 'Staff Member',
              username: adminDoc.username,
              email: adminDoc.email,
              role: adminDoc.role,
              roles: adminDoc.roles,
              user_type: 'admin',
              isSuperAdmin,
            };
            userMetaCache.set(userId, userMeta);
          }
        } else {
          const userDoc = await User.findById(userId).select('full_name company_name email role').lean();
          if (userDoc) {
            userMeta = {
              id: userId,
              name: userDoc.company_name || userDoc.full_name || 'Client',
              company_name: userDoc.company_name,
              email: userDoc.email,
              role: 'client',
              user_type: 'client',
              isSuperAdmin: false,
            };
            userMetaCache.set(userId, userMeta);
          }
        }
      } else {
        isSuperAdmin = userMeta.isSuperAdmin;
      }
    } catch (e) {
      console.warn('[Socket] User metadata fetch warning:', e.message);
    }

    // If superadmin, join dedicated room
    if (isSuperAdmin || role === 'superadmin') {
      socket.join('superadmins');
    }

    // Role-specific rooms
    if (userMeta?.user_type === 'admin' || (role && role !== 'client')) {
      socket.join('admins');
    } else {
      socket.join('clients');
    }

    // Track active connection
    const currentSockets = activeSocketsByUser.get(userId) || new Set();
    const wasOnline = currentSockets.size > 0;
    currentSockets.add(socket.id);
    activeSocketsByUser.set(userId, currentSockets);

    console.log(`🔌 Socket connected: User ${userMeta?.name || userId} (${userMeta?.role || role}), Socket ID: ${socket.id}, Active Tabs: ${currentSockets.size}`);

    // If newly online (first tab)
    if (!wasOnline) {
      const now = new Date();
      if (userMeta?.user_type === 'admin') {
        Admin.findByIdAndUpdate(userId, { is_online: true, last_active_at: now }).catch(() => {});
      } else {
        User.findByIdAndUpdate(userId, { is_online: true, last_active_at: now }).catch(() => {});
      }

      emitToSuperadmins('superadmin_presence_update', {
        userId,
        is_online: true,
        last_active_at: now,
        name: userMeta?.name || 'User',
        email: userMeta?.email,
        role: userMeta?.role,
        roles: userMeta?.roles,
        user_type: userMeta?.user_type || 'client',
        event: 'connect',
      });
    }

    socket.on('join_application', (appId) => {
      if (appId) {
        socket.join(`app_${appId}`);
      }
    });

    socket.on('leave_application', (appId) => {
      if (appId) {
        socket.leave(`app_${appId}`);
      }
    });

    socket.on('disconnect', () => {
      const sockets = activeSocketsByUser.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          activeSocketsByUser.delete(userId);
          const now = new Date();
          if (userMeta?.user_type === 'admin') {
            Admin.findByIdAndUpdate(userId, { is_online: false, last_active_at: now }).catch(() => {});
          } else {
            User.findByIdAndUpdate(userId, { is_online: false, last_active_at: now }).catch(() => {});
          }

          emitToSuperadmins('superadmin_presence_update', {
            userId,
            is_online: false,
            last_active_at: now,
            name: userMeta?.name || 'User',
            email: userMeta?.email,
            role: userMeta?.role,
            roles: userMeta?.roles,
            user_type: userMeta?.user_type || 'client',
            event: 'disconnect',
          });
        }
      }
      console.log(`🔌 Socket disconnected: User ${userMeta?.name || userId}, Socket ID: ${socket.id}`);
    });
  });

  return io;
}

export function getIO() {
  return io;
}

export function emitToUser(userId, event, data) {
  if (io && userId) {
    io.to(userId.toString()).emit(event, data);
  }
}

export function emitToAdmins(event, data) {
  if (io) {
    io.to('admins').emit(event, data);
  }
}

export function emitToClients(event, data) {
  if (io) {
    io.to('clients').emit(event, data);
    // Also broadcast to any connected client socket directly
    io.emit(event, data);
  }
}

export function emitToAll(event, data) {
  if (io) {
    io.emit(event, data);
  }
}

export function emitApplicationUpdate(app, eventType) {
  if (!io || !app) return;
  const appId = (app._id || app.id)?.toString();
  const clientId = (app.client_id?._id || app.client_id || '')?.toString();
  const status = app.status;
  const statusHistory = app.statusHistory || [];

  const payload = {
    appId,
    id: appId,
    status,
    statusHistory,
    eventType: eventType || status,
    updated_at: app.updated_at || new Date(),
    timestamp: Date.now()
  };

  if (appId) {
    io.to(`app_${appId}`).emit('application_updated', payload);
  }

  // Always emit to admins
  io.to('admins').emit('application_updated', payload);

  // Client-invisibility rule: do not emit logsheet-related events to the client room
  const isLogsheetEvent = status === 'logsheet_created' || status === 'logsheet_signed';
  if (clientId && !isLogsheetEvent) {
    io.to(clientId).emit('application_updated', payload);
  }

  // Broadcast to all connected listeners for instant sync across tabs
  io.emit('application_updated', payload);
}

export function emitAddOnUpdate(app, eventType) {
  if (!io || !app) return;
  const addOnId = (app._id || app.id)?.toString();
  const clientId = (app.client_id?._id || app.client_id || '')?.toString();
  const status = app.status;

  const payload = { addOnId, id: addOnId, status, eventType, timestamp: Date.now() };

  if (addOnId) {
    io.to(`app_${addOnId}`).emit('addon_updated', payload);
  }
  io.to('admins').emit('addon_updated', payload);
  if (clientId) {
    io.to(clientId).emit('addon_updated', payload);
  }
  io.emit('addon_updated', payload);
}
