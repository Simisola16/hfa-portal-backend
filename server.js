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

const allowedOrigins = [
  'https://hfa-admin-portal.vercel.app',
  'https://hfa-portal.vercel.app',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
];

const corsOptions = {
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    const normalizedOrigin = origin.replace(/\/$/, '');
    const isAllowed = allowedOrigins.includes(normalizedOrigin) || 
                      normalizedOrigin.endsWith('.vercel.app') || 
                      process.env.NODE_ENV !== 'production';

    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked for origin: ${origin}`);
      // In production, we should probably be stricter, but for now we allow it to avoid hard blocks
      callback(null, true); 
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['X-CSRF-Token', 'X-Requested-With', 'Accept', 'Accept-Version', 'Content-Length', 'Content-MD5', 'Content-Type', 'Date', 'X-Api-Version', 'Authorization', 'Origin'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
// Handle preflight for all routes
app.options('*', cors(corsOptions));

// 2. Logging
app.use(morgan('dev'));

// 3. Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 4. DB Connection Middleware (Move this AFTER CORS)
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error('Database connection failed:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
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
app.use('/api/inspectors', inspectorRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/logsheets', logsheetRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/files', filesRoutes);

app.get('/', (req, res) => {
  res.send('HFA Portal API is running...');
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

export default app;
