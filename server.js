import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import connectDB from './lib/db.js';
import http from 'http';
import { initSocket } from './lib/socket.js';

// Routes
import authRoutes from './routes/auth.js';
import applicationRoutes from './routes/applications.js';
import certificateRoutes from './routes/certificates.js';
import productRoutes from './routes/products.js';
import exportRoutes from './routes/exports.js';
import messageRoutes from './routes/messages.js';
import userRoutes from './routes/users.js';
import siteRoutes from './routes/sites.js';
import proposalRoutes from './routes/proposals.js';
import auditRoutes from './routes/audits.js';
import agreementRoutes from './routes/agreements.js';
import inspectorRoutes from './routes/inspectors.js';
import invoiceRoutes from './routes/invoices.js';
import notificationRoutes from './routes/notifications.js';
import reportRoutes from './routes/reports.js';
import ticketRoutes from './routes/tickets.js';
import logsheetRoutes from './routes/logsheets.js';
import applicationLogsheetRoutes from './routes/applicationLogsheets.js';
import uploadRoutes from './routes/upload.js';
import filesRoutes from './routes/files.js';
import signatureRoutes from './routes/signatures.js';
import addOnApplicationRoutes from './routes/addOnApplications.js';
import surveillanceRoutes from './routes/surveillance.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
initSocket(server);
const port = process.env.PORT || 5000;

const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-Api-Version', 'X-CSRF-Token'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

// 2. Logging
app.use(morgan('dev'));

// 3. Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 4. DB Connection Middleware with Timeout
app.use(async (req, res, next) => {
  // Skip DB connection for preflight OPTIONS, health check or simple root route
  if (req.method === 'OPTIONS' || req.path === '/api/health') return next();

  try {
    // Set a timeout for the DB connection
    const dbPromise = connectDB();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Database connection timeout')), 8000)
    );

    await Promise.race([dbPromise, timeoutPromise]);
    next();
  } catch (error) {
    console.error('❌ Middleware DB Error:', error.message);
    res.status(503).json({ 
      error: 'Service temporarily unavailable', 
      details: 'Database connection failed. Please ensure MongoDB Atlas IPs are whitelisted.',
      message: error.message 
    });
  }
});

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 5. Routes
app.use('/api/auth', authRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/products', productRoutes);
app.use('/api/exports', exportRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sites', siteRoutes);
app.use('/api/proposals', proposalRoutes);
app.use('/api/audits', auditRoutes);
app.use('/api/agreements', agreementRoutes);
app.use('/api/inspectors', inspectorRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/logsheets', logsheetRoutes);
app.use('/api/application-logsheets', applicationLogsheetRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/signatures', signatureRoutes);
app.use('/api/add-on-applications', addOnApplicationRoutes);
app.use('/api/surveillance', surveillanceRoutes);

app.get('/', (req, res) => {
  res.send('HFA Portal API is running...');
});

// Error handling
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.stack || err);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong!' });
});

// Start server for local and persistent hosting (like Render.com)
// Vercel handles the export, but Render needs the listen call
const isVercel = process.env.VERCEL === '1';
if (!isVercel || process.env.NODE_ENV !== 'production') {
  server.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
  });
}

export default app;

