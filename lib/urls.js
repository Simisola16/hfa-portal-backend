/**
 * URL Resolvers for Client and Admin portals.
 * Ensures that any stale Vercel URLs or missing environment variables
 * always resolve safely to official production domains.
 */

export function getClientUrl() {
  const envUrl = process.env.FRONTEND_CLIENT_URL || process.env.CLIENT_URL;

  // If set to an old vercel.app link or missing in production, use official production client domain
  if (!envUrl || envUrl.includes('vercel.app')) {
    if (process.env.NODE_ENV === 'development' && !envUrl?.includes('vercel.app')) {
      return 'http://localhost:5173';
    }
    return 'https://hfaportal.company';
  }

  return envUrl.replace(/\/+$/, '');
}

export function getAdminUrl() {
  const envUrl = process.env.ADMIN_URL || process.env.FRONTEND_ADMIN_URL;

  // If set to an old vercel.app link or missing in production, use official production admin domain
  if (!envUrl || envUrl.includes('vercel.app')) {
    if (process.env.NODE_ENV === 'development' && !envUrl?.includes('vercel.app')) {
      return 'http://localhost:5175';
    }
    return 'https://admin.hfaportal.company';
  }

  return envUrl.replace(/\/+$/, '');
}
