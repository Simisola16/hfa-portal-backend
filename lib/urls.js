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

/**
 * Returns the official Backend API URL.
 */
export function getBackendUrl() {
  const envUrl = process.env.API_URL || process.env.BACKEND_URL;

  if (envUrl && !envUrl.includes('vercel.app')) {
    return envUrl.replace(/\/+$/, '');
  }

  return 'https://backend.hfaportal.company';
}

/**
 * Resolves a full public certificate URL given a relative or absolute certificate path or cert number.
 * 
 * @param {string} [certificateUrl] - Stored certificate_url (e.g. /api/files/s3/certificates/...)
 * @param {string} [certNumber] - Official certificate number (e.g. HFA-GSO-2026-001)
 * @param {string} [fallbackUrl] - Optional fallback URL
 * @returns {string} The full absolute URL
 */
export function resolveCertificateUrl(certificateUrl, certNumber, fallbackUrl) {
  if (certificateUrl && typeof certificateUrl === 'string' && certificateUrl.trim() !== '') {
    const trimmed = certificateUrl.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return `${getBackendUrl()}${cleanPath}`;
  }

  if (fallbackUrl && typeof fallbackUrl === 'string' && fallbackUrl.trim() !== '') {
    const trimmed = fallbackUrl.trim();
    // Ignore legacy broken verify routes that point to the client portal
    if (!trimmed.includes('hfaportal.company/verify') && !trimmed.includes('localhost:5173/verify')) {
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed;
      }
      const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
      return `${getBackendUrl()}${cleanPath}`;
    }
  }

  const safeCertNo = encodeURIComponent(String(certNumber || '').trim());
  if (safeCertNo) {
    return `${getBackendUrl()}/api/certificates/public/${safeCertNo}`;
  }

  return '';
}

