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

export const ensureMongoTunnel = () => {
  if (tunnelPromise) return tunnelPromise;

  tunnelPromise = new Promise((resolve, reject) => {
    // Check if port 27018 is already accepting connections
    const testSocket = net.connect({ port: LOCAL_PORT, host: '127.0.0.1' }, () => {
      testSocket.destroy();
      console.log(`🔌 MongoDB SSH tunnel already active on port ${LOCAL_PORT}`);
      return resolve();
    });

    testSocket.on('error', () => {
      // Port is not in use, start SSH tunnel
      console.log('🔒 Initializing SSH tunnel to Ubuntu MongoDB Server...');
      const sshClient = new Client();

      sshClient.on('ready', () => {
        console.log('✅ SSH Connection established to Ubuntu Server');

        if (activeServer) {
          try { activeServer.close(); } catch (_) {}
        }

        activeServer = net.createServer((sock) => {
          sock.on('error', () => {}); // Ignore client disconnect errors

          sshClient.forwardOut(
            '127.0.0.1',
            sock.remotePort,
            REMOTE_HOST,
            REMOTE_PORT,
            (err, stream) => {
              if (err) {
                sock.end();
                return;
              }
              stream.on('error', () => { sock.destroy(); });
              sock.pipe(stream);
              stream.pipe(sock);
            }
          );
        });

        activeServer.listen(LOCAL_PORT, '127.0.0.1', () => {
          console.log(`🚀 MongoDB Tunnel active: 127.0.0.1:${LOCAL_PORT} -> ${SERVER.host}:${REMOTE_PORT}`);
          resolve();
        });

        activeServer.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            resolve();
          } else {
            console.error('Tunnel server error:', err.message);
          }
        });
      });

      sshClient.on('error', (err) => {
        console.error('❌ SSH Tunnel error:', err.message);
        tunnelPromise = null;
        reject(err);
      });

      sshClient.connect(SERVER);
    });
  });

  return tunnelPromise;
};
