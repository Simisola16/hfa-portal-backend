import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import connectDB from './lib/db.js';

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
import inspectorRoutes from './routes/inspectors.js';
import invoiceRoutes from './routes/invoices.js';
import notificationRoutes from './routes/notifications.js';
import reportRoutes from './routes/reports.js';
import ticketRoutes from './routes/tickets.js';
import logsheetRoutes from './routes/logsheets.js';
import uploadRoutes from './routes/upload.js';
import filesRoutes from './routes/files.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Make sure the DB is connected before handling any requests
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error('Database connection failed:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
});
// CORS configuration
const allowedOrigins = [
  'https://hfa-admin-portal.vercel.app',
  'https://hfa-portal.vercel.app',
  'http://localhost:5174',
  'http://localhost:5173',
];

const corsOptions = {
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    
    // Normalize origin: remove trailing slash if present
    const normalizedOrigin = origin.replace(/\/$/, '');
    
    if (allowedOrigins.indexOf(normalizedOrigin) !== -1 || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      console.warn(`CORS blocked for origin: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['X-CSRF-Token', 'X-Requested-With', 'Accept', 'Accept-Version', 'Content-Length', 'Content-MD5', 'Content-Type', 'Date', 'X-Api-Version', 'Authorization']
};

app.use(cors(corsOptions));
app.options(/(.*)/, cors(corsOptions));

app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'HFA Portal Backend is running', timestamp: new Date().toISOString() });
});

// Use Routes
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'HFA Portal Backend is running', timestamp: new Date().toISOString() });
});

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
app.use('/api/inspectors', inspectorRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/logsheets', logsheetRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/files', filesRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`🕌 HFA Portal Backend running on port ${port}`);
  });
}

// No setInterval needed for Vercel

export default app;

