import express from 'express';
import Application from '../models/Application.js';
import Certificate from '../models/Certificate.js';
import User from '../models/User.js';
import Audit from '../models/Audit.js';
import Invoice from '../models/Invoice.js';
import Ticket from '../models/Ticket.js';
import Product from '../models/Product.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Helper: Calculate date range based on timeframe
const getDateFilter = (timeframe, startDate, endDate) => {
  const now = new Date();
  let start;

  if (startDate && endDate) {
    return {
      $gte: new Date(startDate),
      $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
    };
  }

  switch (timeframe) {
    case 'week':
      start = new Date();
      start.setDate(now.getDate() - 7);
      break;
    case 'month':
      start = new Date();
      start.setDate(now.getDate() - 30);
      break;
    case 'quarter':
      start = new Date();
      start.setMonth(now.getMonth() - 3);
      break;
    case 'year':
      start = new Date();
      start.setFullYear(now.getFullYear() - 1);
      break;
    case 'all':
    default:
      return null;
  }

  return { $gte: start, $lte: now };
};

// GET /api/reports/stats and /api/reports/dashboard - Comprehensive system metrics
const getReportStats = async (req, res) => {
  try {
    const { timeframe = 'all', startDate, endDate } = req.query;
    const dateFilter = getDateFilter(timeframe, startDate, endDate);

    // 1. Applications Statistics
    const totalApps = await Application.countDocuments();
    
    const appsByStatus = await Application.aggregate([
      {
        $addFields: {
          effectiveDate: { $ifNull: ["$createdAt", "$created_at"] }
        }
      },
      ...(dateFilter ? [{ $match: { effectiveDate: dateFilter } }] : []),
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);

    const appsByScheme = await Application.aggregate([
      {
        $addFields: {
          effectiveDate: { $ifNull: ["$createdAt", "$created_at"] }
        }
      },
      ...(dateFilter ? [{ $match: { effectiveDate: dateFilter } }] : []),
      { $group: { _id: { $ifNull: ["$scheme", { $ifNull: ["$application_scheme", "Standard HFA"] }] }, count: { $sum: 1 } } }
    ]);

    // Monthly Application Trend for the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const monthlyApps = await Application.aggregate([
      {
        $addFields: {
          effectiveDate: { $ifNull: ["$createdAt", "$created_at"] }
        }
      },
      { $match: { effectiveDate: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: {
            year: { $year: "$effectiveDate" },
            month: { $month: "$effectiveDate" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const applicationTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const found = monthlyApps.find(a => a._id.year === y && a._id.month === m);
      applicationTrend.push({
        name: monthNames[m - 1],
        year: y,
        count: found ? found.count : 0
      });
    }

    // 2. Certificates Statistics
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const totalCerts = await Certificate.countDocuments();
    const activeCerts = await Certificate.countDocuments({ status: 'active' });
    const expiredCerts = await Certificate.countDocuments({ status: 'expired' });
    const underReviewCerts = await Certificate.countDocuments({ status: 'under_review' });
    
    const expiringSoon30 = await Certificate.countDocuments({
      status: 'active',
      expiry_date: { $gte: now, $lte: in30Days }
    });

    const expiringSoon60 = await Certificate.countDocuments({
      status: 'active',
      expiry_date: { $gte: now, $lte: in60Days }
    });

    // Top 10 Expiring Certificates Watchlist
    const expiringWatchlist = await Certificate.find({
      status: 'active',
      expiry_date: { $gte: now }
    })
    .sort({ expiry_date: 1 })
    .limit(10)
    .select('certificate_number company_name expiry_date certificate_type status');

    // 3. Financial & Invoices Statistics (Supporting both createdAt and created_at)
    const totalInvoices = await Invoice.countDocuments();
    
    const invoiceTotals = await Invoice.aggregate([
      {
        $addFields: {
          effectiveDate: { $ifNull: ["$createdAt", "$created_at"] },
          numAmount: { $toDouble: { $ifNull: ["$amount", 0] } }
        }
      },
      ...(dateFilter ? [{ $match: { effectiveDate: dateFilter } }] : []),
      {
        $group: {
          _id: null,
          totalInvoiced: { $sum: "$numAmount" },
          paidAmount: {
            $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$numAmount", 0] }
          },
          unpaidAmount: {
            $sum: { $cond: [{ $in: ["$status", ["unpaid", "overdue", "client_paid"]] }, "$numAmount", 0] }
          }
        }
      }
    ]);

    const financialStats = invoiceTotals[0] || { totalInvoiced: 0, paidAmount: 0, unpaidAmount: 0 };

    // Monthly Revenue Trend
    const monthlyRevenueRaw = await Invoice.aggregate([
      {
        $addFields: {
          effectiveDate: { $ifNull: ["$createdAt", "$created_at"] },
          numAmount: { $toDouble: { $ifNull: ["$amount", 0] } }
        }
      },
      { $match: { effectiveDate: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: {
            year: { $year: "$effectiveDate" },
            month: { $month: "$effectiveDate" }
          },
          invoiced: { $sum: "$numAmount" },
          paid: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$numAmount", 0] } }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    const revenueTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const found = monthlyRevenueRaw.find(r => r._id.year === y && r._id.month === m);
      revenueTrend.push({
        name: monthNames[m - 1],
        invoiced: found ? Math.round(found.invoiced) : 0,
        paid: found ? Math.round(found.paid) : 0
      });
    }

    // 4. Audits & Non-Conformances (NCs) Statistics
    const totalAudits = await Audit.countDocuments();
    const completedAudits = await Audit.countDocuments({ status: { $in: ['completed', 'audit_completed'] } });
    const scheduledAudits = await Audit.countDocuments({ status: { $in: ['scheduled', 'date_finalized', 'auditors_assigned'] } });
    const pendingAudits = await Audit.countDocuments({ status: { $in: ['pending', 'dates_proposed', 'dates_rejected'] } });

    // Aggregate NCs from audits
    const auditsWithNCs = await Audit.find({ "nc_reports.0": { $exists: true } }).select('nc_reports');
    let totalNCs = 0;
    let resolvedNCs = 0;
    let activeNCs = 0;

    auditsWithNCs.forEach(audit => {
      if (Array.isArray(audit.nc_reports)) {
        audit.nc_reports.forEach(nc => {
          totalNCs++;
          if (nc.status === 'closed' || nc.status === 'corrected') {
            resolvedNCs++;
          } else {
            activeNCs++;
          }
        });
      }
    });

    // 5. Support Tickets Statistics
    const totalTickets = await Ticket.countDocuments();
    const openTickets = await Ticket.countDocuments({ status: 'open' });
    const inProgressTickets = await Ticket.countDocuments({ status: 'in_progress' });
    const resolvedTickets = await Ticket.countDocuments({ status: { $in: ['resolved', 'closed'] } });
    
    const ticketsByDept = await Ticket.aggregate([
      { $group: { _id: "$department", count: { $sum: 1 } } }
    ]);

    const ticketsByPriority = await Ticket.aggregate([
      { $group: { _id: "$priority", count: { $sum: 1 } } }
    ]);

    // 6. Clients & Users Statistics
    const totalClients = await User.countDocuments({ role: 'client' });
    const activeClients = await User.countDocuments({ role: 'client', is_active: true });
    
    // Clients registered in current month
    const startOfCurrentMonth = new Date();
    startOfCurrentMonth.setDate(1);
    startOfCurrentMonth.setHours(0, 0, 0, 0);
    const newClientsThisMonth = await User.countDocuments({
      role: 'client',
      $or: [
        { created_at: { $gte: startOfCurrentMonth } },
        { createdAt: { $gte: startOfCurrentMonth } }
      ]
    });

    // Clients registered in previous month
    const startOfPrevMonth = new Date(startOfCurrentMonth);
    startOfPrevMonth.setMonth(startOfPrevMonth.getMonth() - 1);
    const newClientsPrevMonth = await User.countDocuments({
      role: 'client',
      $or: [
        { created_at: { $gte: startOfPrevMonth, $lt: startOfCurrentMonth } },
        { createdAt: { $gte: startOfPrevMonth, $lt: startOfCurrentMonth } }
      ]
    });

    const clientGrowth = newClientsPrevMonth > 0 
      ? Math.round(((newClientsThisMonth - newClientsPrevMonth) / newClientsPrevMonth) * 100) 
      : (newClientsThisMonth > 0 ? 100 : 0);

    // 7. Products Statistics
    const totalProducts = await Product.countDocuments();

    // Rates
    const acceptedApps = appsByStatus
      .filter(s => ['certificate_issued', 'application_successful', 'ready_for_certificate', 'approved', 'accepted', 'certified'].includes(s._id))
      .reduce((sum, s) => sum + s.count, 0);
    const approvalRate = totalApps > 0 ? Math.round((acceptedApps / totalApps) * 100) : 0;
    const ticketResolutionRate = totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 100;
    const auditComplianceRate = totalNCs > 0 ? Math.round((resolvedNCs / totalNCs) * 100) : 100;
    const collectionRate = financialStats.totalInvoiced > 0 
      ? Math.round((financialStats.paidAmount / financialStats.totalInvoiced) * 100) 
      : (financialStats.paidAmount > 0 ? 100 : 0);

    // Return complete structured payload
    res.json({
      timeframe,
      applications: {
        total: totalApps,
        approvalRate,
        acceptedCount: acceptedApps,
        trend: applicationTrend,
        statusDistribution: appsByStatus.map(s => ({ name: s._id || 'other', value: s.count })),
        schemeDistribution: appsByScheme.map(s => ({ name: s._id || 'Standard HFA', value: s.count }))
      },
      products: {
        total: totalProducts
      },
      certificates: {
        total: totalCerts,
        active: activeCerts,
        expired: expiredCerts,
        underReview: underReviewCerts,
        expiringSoon30,
        expiringSoon60,
        expiringWatchlist
      },
      financials: {
        totalInvoiced: Math.round(financialStats.totalInvoiced || 0),
        paidAmount: Math.round(financialStats.paidAmount || 0),
        unpaidAmount: Math.round(financialStats.unpaidAmount || 0),
        collectionRate,
        trend: revenueTrend
      },
      audits: {
        total: totalAudits,
        completed: completedAudits,
        scheduled: scheduledAudits,
        pending: pendingAudits,
        activeNCs,
        resolvedNCs,
        complianceRate: auditComplianceRate
      },
      tickets: {
        total: totalTickets,
        open: openTickets,
        inProgress: inProgressTickets,
        resolved: resolvedTickets,
        resolutionRate: ticketResolutionRate,
        byDepartment: ticketsByDept.map(d => ({ name: d._id || 'General', count: d.count })),
        byPriority: ticketsByPriority.map(p => ({ name: p._id || 'Medium', count: p.count }))
      },
      clients: {
        total: totalClients,
        active: activeClients,
        newThisMonth: newClientsThisMonth,
        growthRate: clientGrowth
      }
    });

  } catch (err) {
    console.error('Error computing report stats:', err);
    res.status(500).json({ error: err.message });
  }
};

router.get('/stats', authenticateToken, requireAdmin, getReportStats);
router.get('/dashboard', authenticateToken, requireAdmin, getReportStats);

// GET /api/reports/export - Generates CSV reports
router.get('/export', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { type = 'applications' } = req.query;

    if (type === 'applications') {
      const apps = await Application.find()
        .populate('client_id', 'company_name full_name email phone')
        .sort({ createdAt: -1 })
        .lean();

      let csv = 'Application Number,Company Name,Contact Name,Email,Scheme,Status,Created Date\n';
      apps.forEach(a => {
        const client = a.client_id || {};
        const date = a.createdAt || a.created_at ? new Date(a.createdAt || a.created_at).toISOString().split('T')[0] : '';
        csv += `"${a.application_number || ''}","${client.company_name || a.establishment_name || ''}","${client.full_name || ''}","${client.email || ''}","${a.scheme || 'Standard'}","${a.status || ''}","${date}"\n`;
      });

      res.header('Content-Type', 'text/csv');
      res.attachment(`hfa_applications_${new Date().toISOString().split('T')[0]}.csv`);
      return res.send(csv);
    }

    if (type === 'certificates') {
      const certs = await Certificate.find()
        .populate('client_id', 'company_name email')
        .sort({ expiry_date: 1 })
        .lean();

      let csv = 'Certificate Number,Company Name,Type,Status,Issue Date,Expiry Date\n';
      certs.forEach(c => {
        const client = c.client_id || {};
        const issue = c.issue_date ? new Date(c.issue_date).toISOString().split('T')[0] : '';
        const expiry = c.expiry_date ? new Date(c.expiry_date).toISOString().split('T')[0] : '';
        csv += `"${c.certificate_number || ''}","${client.company_name || c.company_name || ''}","${c.certificate_type || ''}","${c.status || ''}","${issue}","${expiry}"\n`;
      });

      res.header('Content-Type', 'text/csv');
      res.attachment(`hfa_certificates_${new Date().toISOString().split('T')[0]}.csv`);
      return res.send(csv);
    }

    if (type === 'invoices') {
      const invoices = await Invoice.find()
        .populate('client_id', 'company_name full_name email')
        .sort({ createdAt: -1 })
        .lean();

      let csv = 'Invoice Number,Company,Amount,Currency,Status,Due Date,Paid Date\n';
      invoices.forEach(i => {
        const client = i.client_id || {};
        const dueDate = i.due_date ? new Date(i.due_date).toISOString().split('T')[0] : '';
        const paidDate = i.paid_at ? new Date(i.paid_at).toISOString().split('T')[0] : '';
        csv += `"${i.invoice_number || ''}","${client.company_name || ''}",${i.amount || 0},"${i.currency || 'GBP'}","${i.status || ''}","${dueDate}","${paidDate}"\n`;
      });

      res.header('Content-Type', 'text/csv');
      res.attachment(`hfa_invoices_${new Date().toISOString().split('T')[0]}.csv`);
      return res.send(csv);
    }

    res.status(400).json({ error: 'Invalid export type requested' });
  } catch (err) {
    console.error('Error generating report export:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
