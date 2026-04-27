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

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// CORS configuration
const allowedOrigins = [
  process.env.FRONTEND_ADMIN_URL || 'http://localhost:5174',
  process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173',
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all for dev
    }
  },
  credentials: true,
}));

app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'HFA Portal Backend is running', timestamp: new Date().toISOString() });
});

// Use Routes
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

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(port, () => {
  console.log(`🕌 HFA Portal Backend running on port ${port}`);
});

// Keep process alive
setInterval(() => {}, 1000 * 60 * 60);
