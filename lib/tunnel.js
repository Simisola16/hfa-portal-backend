import { Client } from 'ssh2';
import net from 'net';

const SERVER = {
  host: '155.117.43.205',
  port: 22,
  username: 'administrator',
  password: 'halalfa@123',
  readyTimeout: 30000,
  keepaliveInterval: 10000
};

const LOCAL_PORT = 27018;
const REMOTE_HOST = '127.0.0.1';
const REMOTE_PORT = 27017;

let tunnelPromise = null;
let activeServer = null;
let activeSshClient = null;
let isSshConnected = false;

const cleanupTunnel = () => {
  isSshConnected = false;
  tunnelPromise = null;
  if (activeServer) {
    try { activeServer.close(); } catch (_) {}
    activeServer = null;
  }
  if (activeSshClient) {
    try { activeSshClient.end(); } catch (_) {}
    activeSshClient = null;
  }
};

export const ensureMongoTunnel = () => {
  if (isSshConnected && activeServer && activeServer.listening && tunnelPromise) {
    return tunnelPromise;
  }

  // If there's an in-flight connection promise, return it
  if (tunnelPromise) {
    return tunnelPromise;
  }

  cleanupTunnel();

  tunnelPromise = new Promise((resolve, reject) => {
    // First check if an external tunnel is already listening on 27018
    const testSocket = net.connect({ port: LOCAL_PORT, host: '127.0.0.1' }, () => {
      testSocket.destroy();
      console.log(`🔌 MongoDB port ${LOCAL_PORT} already active`);
      return resolve();
    });

    testSocket.on('error', () => {
      // Port is not in use, start SSH tunnel
      console.log('🔒 Initializing SSH tunnel to Ubuntu MongoDB Server...');
      const sshClient = new Client();
      activeSshClient = sshClient;

      let hasResolved = false;

      sshClient.on('ready', () => {
        isSshConnected = true;
        console.log('✅ SSH Connection established to Ubuntu Server');

        if (activeServer) {
          try { activeServer.close(); } catch (_) {}
        }

        activeServer = net.createServer((sock) => {
          sock.on('error', () => {}); // Ignore client disconnect errors

          try {
            if (!isSshConnected) {
              try { sock.destroy(); } catch (_) {}
              return;
            }

            sshClient.forwardOut(
              '127.0.0.1',
              sock.remotePort || 0,
              REMOTE_HOST,
              REMOTE_PORT,
              (err, stream) => {
                if (err) {
                  try { sock.destroy(); } catch (_) {}
                  return;
                }
                stream.on('error', () => { try { sock.destroy(); } catch (_) {} });
                sock.on('error', () => { try { stream.destroy(); } catch (_) {} });
                sock.pipe(stream);
                stream.pipe(sock);
              }
            );
          } catch (forwardErr) {
            console.warn('⚠️ SSH forwardOut caught error:', forwardErr.message);
            try { sock.destroy(); } catch (_) {}
          }
        });

        activeServer.listen(LOCAL_PORT, '127.0.0.1', () => {
          console.log(`🚀 MongoDB Tunnel active: 127.0.0.1:${LOCAL_PORT} -> ${SERVER.host}:${REMOTE_PORT}`);
          hasResolved = true;
          resolve();
        });

        activeServer.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            hasResolved = true;
            resolve();
          } else {
            console.error('Tunnel server error:', err.message);
          }
        });
      });

      sshClient.on('error', (err) => {
        console.error('❌ SSH Tunnel error:', err.message);
        cleanupTunnel();
        if (!hasResolved) {
          hasResolved = true;
          reject(err);
        }
      });

      sshClient.on('close', () => {
        console.log('⚠️ SSH Connection closed, resetting tunnel.');
        cleanupTunnel();
      });

      sshClient.on('end', () => {
        cleanupTunnel();
      });

      try {
        sshClient.connect(SERVER);
      } catch (err) {
        cleanupTunnel();
        if (!hasResolved) {
          hasResolved = true;
          reject(err);
        }
      }
    });
  });

  return tunnelPromise;
};
