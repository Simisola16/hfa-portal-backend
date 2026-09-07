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

// GET /api/reports/stats - Comprehensive system metrics
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { timeframe = 'month', startDate, endDate } = req.query;
    const dateFilter = getDateFilter(timeframe, startDate, endDate);
    const createdMatch = dateFilter ? { created_at: dateFilter } : {};

    // 1. Applications Statistics
    const totalApps = await Application.countDocuments();
    const filteredAppsCount = await Application.countDocuments(createdMatch);
    
    const appsByStatus = await Application.aggregate([
      ...(dateFilter ? [{ $match: { created_at: dateFilter } }] : []),
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);

    const appsByScheme = await Application.aggregate([
      ...(dateFilter ? [{ $match: { created_at: dateFilter } }] : []),
      { $group: { _id: { $ifNull: ["$scheme", { $ifNull: ["$application_scheme", "Standard HFA"] }] }, count: { $sum: 1 } } }
    ]);

    // Monthly Application Trend for the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const monthlyApps = await Application.aggregate([
      { $match: { created_at: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: {
            year: { $year: "$created_at" },
            month: { $month: "$created_at" }
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

    // 3. Financial & Invoices Statistics
    const totalInvoices = await Invoice.countDocuments();
    
    const invoiceTotals = await Invoice.aggregate([
      ...(dateFilter ? [{ $match: { created_at: dateFilter } }] : []),
      {
        $group: {
          _id: null,
          totalInvoiced: { $sum: "$amount" },
          paidAmount: {
            $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0] }
          },
          unpaidAmount: {
            $sum: { $cond: [{ $in: ["$status", ["unpaid", "overdue", "client_paid"]] }, "$amount", 0] }
          }
        }
      }
    ]);

    const financialStats = invoiceTotals[0] || { totalInvoiced: 0, paidAmount: 0, unpaidAmount: 0 };

    // Monthly Revenue Trend
    const monthlyRevenueRaw = await Invoice.aggregate([
      { $match: { created_at: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: {
            year: { $year: "$created_at" },
            month: { $month: "$created_at" }
          },
          invoiced: { $sum: "$amount" },
          paid: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0] } }
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
      created_at: { $gte: startOfCurrentMonth }
    });

    // Clients registered in previous month
    const startOfPrevMonth = new Date(startOfCurrentMonth);
    startOfPrevMonth.setMonth(startOfPrevMonth.getMonth() - 1);
    const newClientsPrevMonth = await User.countDocuments({
      role: 'client',
      created_at: { $gte: startOfPrevMonth, $lt: startOfCurrentMonth }
    });

    const clientGrowth = newClientsPrevMonth > 0 
      ? Math.round(((newClientsThisMonth - newClientsPrevMonth) / newClientsPrevMonth) * 100) 
      : (newClientsThisMonth > 0 ? 100 : 0);

    // Rates
    const certifiedApps = appsByStatus.find(s => s._id === 'certified')?.count || 0;
    const approvalRate = totalApps > 0 ? Math.round((certifiedApps / totalApps) * 100) : 0;
    const ticketResolutionRate = totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 100;
    const auditComplianceRate = totalNCs > 0 ? Math.round((resolvedNCs / totalNCs) * 100) : 100;

    // Return complete structured payload
    res.json({
      timeframe,
      applications: {
        total: totalApps,
        filteredCount: filteredAppsCount,
        statusDistribution: appsByStatus.map(s => ({
          name: (s._id || 'Pending').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          value: s.count,
          rawStatus: s._id
        })),
        schemeDistribution: appsByScheme.map(s => ({
          name: (s._id || 'HFA General').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          value: s.count
        })),
        trend: applicationTrend,
        approvalRate
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
        totalInvoices,
        totalInvoiced: financialStats.totalInvoiced,
        paidAmount: financialStats.paidAmount,
        unpaidAmount: financialStats.unpaidAmount,
        collectionRate: financialStats.totalInvoiced > 0 
          ? Math.round((financialStats.paidAmount / financialStats.totalInvoiced) * 100) 
          : 0,
        trend: revenueTrend
      },
      audits: {
        total: totalAudits,
        completed: completedAudits,
        scheduled: scheduledAudits,
        pending: pendingAudits,
        totalNCs,
        resolvedNCs,
        activeNCs,
        complianceRate: auditComplianceRate
      },
      tickets: {
        total: totalTickets,
        open: openTickets,
        inProgress: inProgressTickets,
        resolved: resolvedTickets,
        resolutionRate: ticketResolutionRate,
        byDepartment: ticketsByDept.map(d => ({ name: d._id || 'General', count: d.count })),
        byPriority: ticketsByPriority.map(p => ({ name: p._id || 'medium', count: p.count }))
      },
      clients: {
        total: totalClients,
        active: activeClients,
        newThisMonth: newClientsThisMonth,
        growthRate: clientGrowth
      }
    });

  } catch (err) {
    console.error('Error generating report stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/export - Export reports as CSV
router.get('/export', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { type = 'applications' } = req.query;
    let csv = '';
    let filename = `hfa_${type}_report_${Date.now()}.csv`;

    if (type === 'applications') {
      const apps = await Application.find()
        .populate('client_id', 'full_name company_name email phone')
        .sort({ created_at: -1 });

      csv = 'Application Number,Company Name,Scheme,Status,Contact Name,Email,Created Date,Updated Date\n';
      apps.forEach(app => {
        const company = (app.company_name || app.client_id?.company_name || 'N/A').replace(/"/g, '""');
        const scheme = (app.scheme || app.application_scheme || 'Standard HFA').replace(/"/g, '""');
        const contact = (app.client_id?.full_name || 'N/A').replace(/"/g, '""');
        const email = app.client_id?.email || 'N/A';
        const created = app.created_at ? new Date(app.created_at).toISOString().split('T')[0] : 'N/A';
        const updated = app.updated_at ? new Date(app.updated_at).toISOString().split('T')[0] : 'N/A';
        csv += `"${app.application_number || app._id}","${company}","${scheme}","${app.status || 'pending'}","${contact}","${email}","${created}","${updated}"\n`;
      });
    } else if (type === 'certificates') {
      const certs = await Certificate.find().sort({ expiry_date: 1 });

      csv = 'Certificate Number,Company Name,Type,Status,Issue Date,Expiry Date,Products Covered Count\n';
      certs.forEach(cert => {
        const company = (cert.company_name || 'N/A').replace(/"/g, '""');
        const certType = (cert.certificate_type || 'Halal Certificate').replace(/"/g, '""');
        const issue = cert.issue_date ? new Date(cert.issue_date).toISOString().split('T')[0] : 'N/A';
        const expiry = cert.expiry_date ? new Date(cert.expiry_date).toISOString().split('T')[0] : 'N/A';
        const prodCount = cert.products_covered?.length || cert.product_details?.length || 0;
        csv += `"${cert.certificate_number}","${company}","${certType}","${cert.status}","${issue}","${expiry}",${prodCount}\n`;
      });
    } else if (type === 'invoices') {
      const invoices = await Invoice.find()
        .populate('client_id', 'full_name company_name email')
        .sort({ created_at: -1 });

      csv = 'Invoice Number,Company Name,Title,Type,Amount (GBP),Status,Due Date,Paid Date,Created Date\n';
      invoices.forEach(inv => {
        const company = (inv.client_id?.company_name || 'N/A').replace(/"/g, '""');
        const title = (inv.title || 'Certification Invoice').replace(/"/g, '""');
        const due = inv.due_date ? new Date(inv.due_date).toISOString().split('T')[0] : 'N/A';
        const paid = inv.paid_at ? new Date(inv.paid_at).toISOString().split('T')[0] : 'N/A';
        const created = inv.created_at ? new Date(inv.created_at).toISOString().split('T')[0] : 'N/A';
        csv += `"${inv.invoice_number}","${company}","${title}","${inv.invoice_type || 'initial'}",${inv.amount || 0},"${inv.status}","${due}","${paid}","${created}"\n`;
      });
    } else if (type === 'tickets') {
      const tickets = await Ticket.find()
        .populate('user', 'full_name company_name email')
        .sort({ created_at: -1 });

      csv = 'Ticket Number,Company Name,User Name,Subject,Department,Priority,Status,Responses Count,Created Date\n';
      tickets.forEach(t => {
        const company = (t.user?.company_name || 'N/A').replace(/"/g, '""');
        const user = (t.user?.full_name || 'N/A').replace(/"/g, '""');
        const subject = (t.subject || 'No Subject').replace(/"/g, '""');
        const responsesCount = t.responses?.length || 0;
        const created = t.created_at ? new Date(t.created_at).toISOString().split('T')[0] : 'N/A';
        csv += `"${t.ticket_number}","${company}","${user}","${subject}","${t.department}","${t.priority}","${t.status}",${responsesCount},"${created}"\n`;
      });
    } else {
      // Executive Summary CSV
      const totalApps = await Application.countDocuments();
      const totalCerts = await Certificate.countDocuments({ status: 'active' });
      const totalClients = await User.countDocuments({ role: 'client' });
      const totalTickets = await Ticket.countDocuments();
      
      csv = 'Metric,Value\n';
      csv += `"Total Applications",${totalApps}\n`;
      csv += `"Active Certificates",${totalCerts}\n`;
      csv += `"Registered Clients",${totalClients}\n`;
      csv += `"Total Support Tickets",${totalTickets}\n`;
      csv += `"Report Generated At","${new Date().toISOString()}"\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);

  } catch (err) {
    console.error('Error exporting report:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/dashboard - Legacy support
router.get('/dashboard', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const applications = await Application.find().sort({ created_at: -1 }).limit(50);
    const certificates = await Certificate.find().sort({ created_at: -1 }).limit(50);
    const users = await User.find({ role: 'client' }).sort({ created_at: -1 }).limit(50);
    const audits = await Audit.find().sort({ created_at: -1 }).limit(50);

    res.json({ applications, certificates, users, audits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

