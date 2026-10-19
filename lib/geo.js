/**
 * Geo-location & IP helper for HFA Live User Monitor
 * Accurately determines the location where users actually logged in.
 */

// Memory cache for IP lookups to avoid redundant external network requests
const ipGeoCache = new Map();
let cachedHostPublicIp = null;

// Map of common country names to flag emojis
export const COUNTRY_FLAGS = {
  'nigeria': '🇳🇬',
  'united kingdom': '🇬🇧',
  'uk': '🇬🇧',
  'great britain': '🇬🇧',
  'england': '🇬🇧',
  'scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  'wales': '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  'poland': '🇵🇱',
  'thailand': '🇹🇭',
  'united states': '🇺🇸',
  'usa': '🇺🇸',
  'germany': '🇩🇪',
  'france': '🇫🇷',
  'united arab emirates': '🇦🇪',
  'uae': '🇦🇪',
  'saudi arabia': '🇸🇦',
  'ireland': '🇮🇪',
  'netherlands': '🇳🇱',
  'belgium': '🇧🇪',
  'turkey': '🇹🇷',
  'pakistan': '🇵🇰',
  'india': '🇮🇳',
  'malaysia': '🇲🇾',
  'indonesia': '🇮🇩',
  'singapore': '🇸🇬',
  'canada': '🇨🇦',
  'australia': '🇦🇺',
  'spain': '🇪🇸',
  'italy': '🇮🇹',
  'brazil': '🇧🇷',
  'egypt': '🇪🇬',
  'south africa': '🇿🇦',
  'ghana': '🇬🇭',
  'kenya': '🇰🇪',
  'morocco': '🇲🇦',
  'china': '🇨🇳',
  'japan': '🇯🇵',
  'south korea': '🇰🇷',
  'qatar': '🇶🇦',
  'oman': '🇴🇲',
  'kuwait': '🇰🇼',
  'bahrain': '🇧🇭',
  'jordan': '🇯🇴',
};

export const TIMEZONE_LOCATIONS = {
  'africa/lagos': { city: 'Lagos', country: 'Nigeria', countryCode: 'NG' },
  'africa/cairo': { city: 'Cairo', country: 'Egypt', countryCode: 'EG' },
  'africa/johannesburg': { city: 'Johannesburg', country: 'South Africa', countryCode: 'ZA' },
  'africa/nairobi': { city: 'Nairobi', country: 'Kenya', countryCode: 'KE' },
  'africa/casablanca': { city: 'Casablanca', country: 'Morocco', countryCode: 'MA' },
  'africa/accra': { city: 'Accra', country: 'Ghana', countryCode: 'GH' },
  'europe/london': { city: 'London', country: 'United Kingdom', countryCode: 'GB' },
  'europe/belfast': { city: 'Belfast', country: 'United Kingdom', countryCode: 'GB' },
  'europe/dublin': { city: 'Dublin', country: 'Ireland', countryCode: 'IE' },
  'europe/warsaw': { city: 'Warsaw', country: 'Poland', countryCode: 'PL' },
  'europe/paris': { city: 'Paris', country: 'France', countryCode: 'FR' },
  'europe/berlin': { city: 'Berlin', country: 'Germany', countryCode: 'DE' },
  'europe/amsterdam': { city: 'Amsterdam', country: 'Netherlands', countryCode: 'NL' },
  'europe/brussels': { city: 'Brussels', country: 'Belgium', countryCode: 'BE' },
  'europe/madrid': { city: 'Madrid', country: 'Spain', countryCode: 'ES' },
  'europe/rome': { city: 'Rome', country: 'Italy', countryCode: 'IT' },
  'europe/istanbul': { city: 'Istanbul', country: 'Turkey', countryCode: 'TR' },
  'asia/dubai': { city: 'Dubai', country: 'United Arab Emirates', countryCode: 'AE' },
  'asia/riyadh': { city: 'Riyadh', country: 'Saudi Arabia', countryCode: 'SA' },
  'asia/qatar': { city: 'Doha', country: 'Qatar', countryCode: 'QA' },
  'asia/kuwait': { city: 'Kuwait City', country: 'Kuwait', countryCode: 'KW' },
  'asia/muscat': { city: 'Muscat', country: 'Oman', countryCode: 'OM' },
  'asia/bahrain': { city: 'Manama', country: 'Bahrain', countryCode: 'BH' },
  'asia/amman': { city: 'Amman', country: 'Jordan', countryCode: 'JO' },
  'asia/bangkok': { city: 'Bangkok', country: 'Thailand', countryCode: 'TH' },
  'asia/singapore': { city: 'Singapore', country: 'Singapore', countryCode: 'SG' },
  'asia/kuala_lumpur': { city: 'Kuala Lumpur', country: 'Malaysia', countryCode: 'MY' },
  'asia/jakarta': { city: 'Jakarta', country: 'Indonesia', countryCode: 'ID' },
  'asia/karachi': { city: 'Karachi', country: 'Pakistan', countryCode: 'PK' },
  'asia/kolkata': { city: 'Kolkata', country: 'India', countryCode: 'IN' },
  'asia/calcutta': { city: 'Kolkata', country: 'India', countryCode: 'IN' },
  'asia/tokyo': { city: 'Tokyo', country: 'Japan', countryCode: 'JP' },
  'asia/seoul': { city: 'Seoul', country: 'South Korea', countryCode: 'KR' },
  'asia/shanghai': { city: 'Shanghai', country: 'China', countryCode: 'CN' },
  'asia/hong_kong': { city: 'Hong Kong', country: 'Hong Kong', countryCode: 'HK' },
  'america/new_york': { city: 'New York', country: 'United States', countryCode: 'US' },
  'america/chicago': { city: 'Chicago', country: 'United States', countryCode: 'US' },
  'america/los_angeles': { city: 'Los Angeles', country: 'United States', countryCode: 'US' },
  'america/toronto': { city: 'Toronto', country: 'Canada', countryCode: 'CA' },
  'australia/sydney': { city: 'Sydney', country: 'Australia', countryCode: 'AU' },
};

/**
 * Convert 2-letter ISO country code (e.g., "NG", "GB") to flag emoji
 */
export function getFlagFromCountryCode(code) {
  if (!code || typeof code !== 'string' || code.length !== 2) return '';
  const upper = code.toUpperCase();
  return String.fromCodePoint(...[...upper].map(c => 127397 + c.charCodeAt(0)));
}

/**
 * Return flag emoji for country name or code
 */
export function getCountryFlag(countryOrCode) {
  if (!countryOrCode) return '🌍';
  const clean = String(countryOrCode).trim().toLowerCase();
  if (COUNTRY_FLAGS[clean]) return COUNTRY_FLAGS[clean];
  if (clean.length === 2) {
    const flag = getFlagFromCountryCode(clean);
    if (flag) return flag;
  }
  // Partial check
  for (const [key, flag] of Object.entries(COUNTRY_FLAGS)) {
    if (clean.includes(key)) return flag;
  }
  return '🌍';
}

/**
 * Clean raw IP string from headers or sockets
 */
export function cleanIpAddress(rawIp) {
  if (!rawIp) return '';
  let ip = String(rawIp).split(',')[0].trim();
  if (ip.startsWith('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }
  return ip;
}

/**
 * Check if IP is private or local
 */
export function isPrivateIp(ip) {
  if (!ip) return true;
  const clean = cleanIpAddress(ip);
  if (clean === '::1' || clean === '127.0.0.1' || clean === 'localhost') return true;
  if (
    clean.startsWith('10.') ||
    clean.startsWith('192.168.') ||
    clean.startsWith('172.16.') ||
    clean.startsWith('172.17.') ||
    clean.startsWith('172.18.') ||
    clean.startsWith('172.19.') ||
    clean.startsWith('172.20.') ||
    clean.startsWith('172.21.') ||
    clean.startsWith('172.22.') ||
    clean.startsWith('172.23.') ||
    clean.startsWith('172.24.') ||
    clean.startsWith('172.25.') ||
    clean.startsWith('172.26.') ||
    clean.startsWith('172.27.') ||
    clean.startsWith('172.28.') ||
    clean.startsWith('172.29.') ||
    clean.startsWith('172.30.') ||
    clean.startsWith('172.31.') ||
    clean.startsWith('fc00:') ||
    clean.startsWith('fe80:')
  ) {
    return true;
  }
  return false;
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * Standardize 2-letter ISO country code into full English country name
 */
export function getCountryNameFromCode(code) {
  if (!code || typeof code !== 'string') return '';
  const clean = code.trim().toUpperCase();
  if (clean.length === 2) {
    try {
      return regionNames.of(clean) || clean;
    } catch {
      return clean;
    }
  }
  return code;
}

/**
 * Fetch public IP for localhost environments using ipinfo.io or ipify
 */
async function getHostPublicIp() {
  if (cachedHostPublicIp) return cachedHostPublicIp;

  // 1. Try ipinfo.io
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('https://ipinfo.io/json', { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (data?.ip && !isPrivateIp(data.ip)) {
        cachedHostPublicIp = data.ip;
        return data.ip;
      }
    }
  } catch {}

  // 2. Fallback to api.ipify.org
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (data?.ip && !isPrivateIp(data.ip)) {
        cachedHostPublicIp = data.ip;
        return data.ip;
      }
    }
  } catch {}

  return null;
}

/**
 * Primary IP lookup using ip-api.com (returns city, region, country, countryCode)
 */
async function fetchFromIpApi(ip) {
  if (!ip || isPrivateIp(ip)) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,regionName,city,zip,query`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (data && data.status === 'success') {
        const country = data.country || getCountryNameFromCode(data.countryCode);
        const city = data.city || data.regionName || '';
        const parts = [city, country].filter(Boolean);
        const locationStr = parts.join(', ') || country;
        return {
          ip,
          country: country || '',
          city: city || '',
          countryCode: data.countryCode || '',
          location: locationStr,
          isLocal: false,
          source: 'ip-api.com',
        };
      }
    }
  } catch {}
  return null;
}

/**
 * Secondary / Fallback IP lookup using ipinfo.io (returns city, region, country, loc)
 */
async function fetchFromIpInfo(ip) {
  if (!ip || isPrivateIp(ip)) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const url = ip ? `https://ipinfo.io/${ip}/json` : 'https://ipinfo.io/json';
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (data && (data.country || data.city)) {
        const countryCode = data.country || '';
        const country = getCountryNameFromCode(countryCode) || countryCode;
        const city = data.city || data.region || '';
        const parts = [city, country].filter(Boolean);
        const locationStr = parts.join(', ') || country;
        return {
          ip: data.ip || ip,
          country,
          city,
          countryCode,
          location: locationStr,
          isLocal: false,
          source: 'ipinfo.io',
        };
      }
    }
  } catch {}
  return null;
}

/**
 * High-accuracy IP Geolocation lookup
 * Tries ip-api.com first; if unreachable or rate-limited, immediately falls back to ipinfo.io
 */
export async function fetchIpGeo(ip) {
  if (!ip || isPrivateIp(ip)) return null;
  if (ipGeoCache.has(ip)) return ipGeoCache.get(ip);

  // 1. Try ip-api.com
  let result = await fetchFromIpApi(ip);

  // 2. Fallback to ipinfo.io
  if (!result || !result.country) {
    result = await fetchFromIpInfo(ip);
  }

  if (result && result.country) {
    ipGeoCache.set(ip, result);
    return result;
  }

  return null;
}

/**
 * Resolve the actual location where the user logged in.
 * Prioritizes:
 * 1. Direct client-side detected location/IP if passed in login payload (from ipinfo.io or browser)
 * 2. Public IP resolution via ip-api.com & ipinfo.io
 * 3. Machine host public IP lookup for localhost/dev environments
 * 4. Client timezone mapping fallback (e.g., Africa/Lagos -> Lagos, Nigeria)
 */
export async function resolveGeoLocation(rawIp, options = {}) {
  const {
    client_location = '',
    client_country = '',
    client_city = '',
    client_ip = '',
    timezone = '',
  } = (typeof options === 'object' && options !== null) ? options : {};

  // 1. If client provided explicit verified location on login
  if (client_location && client_country) {
    const country = client_country.length === 2 ? getCountryNameFromCode(client_country) : client_country;
    const countryCode = client_country.length === 2 ? client_country.toUpperCase() : (client_country.toLowerCase() === 'nigeria' ? 'NG' : '');
    const city = client_city || client_location.split(',')[0]?.trim() || '';
    const location = [city, country].filter(Boolean).join(', ') || client_location;
    return {
      ip: cleanIpAddress(client_ip || rawIp),
      country,
      city,
      countryCode,
      location,
      isLocal: false,
      source: 'client_detection',
    };
  }

  let ip = cleanIpAddress(rawIp);

  // 2. If incoming connection IP is a public IP, resolve via ip-api.com / ipinfo.io
  if (ip && !isPrivateIp(ip)) {
    const geo = await fetchIpGeo(ip);
    if (geo) return geo;
  }

  // 3. If client provided a public IP from browser
  if (client_ip && !isPrivateIp(client_ip)) {
    const geo = await fetchIpGeo(cleanIpAddress(client_ip));
    if (geo) return geo;
  }

  // 4. If request is from localhost / private network (development testing)
  // Look up machine's actual public IP via ipinfo.io / ipify
  const hostPublicIp = await getHostPublicIp();
  if (hostPublicIp) {
    const geo = await fetchIpGeo(hostPublicIp);
    if (geo) {
      return {
        ...geo,
        ip: hostPublicIp,
      };
    }
  }

  // 5. Fallback to Client Timezone if available
  const tzClean = String(timezone || '').trim().toLowerCase();
  if (tzClean && TIMEZONE_LOCATIONS[tzClean]) {
    const tzData = TIMEZONE_LOCATIONS[tzClean];
    const loc = `${tzData.city}, ${tzData.country}`;
    return {
      ip: ip || 'Localhost',
      country: tzData.country,
      city: tzData.city,
      countryCode: tzData.countryCode,
      location: loc,
      isLocal: isPrivateIp(ip),
      source: 'timezone_fallback',
    };
  }

  // 6. Generic timezone parser e.g. "Africa/Lagos" -> City: Lagos
  if (tzClean && tzClean.includes('/')) {
    const parts = tzClean.split('/');
    const city = (parts[1] || '').replace(/_/g, ' ');
    const region = parts[0];
    const formattedCity = city.charAt(0).toUpperCase() + city.slice(1);
    const loc = formattedCity || region;
    return {
      ip: ip || 'Localhost',
      country: '',
      city: formattedCity,
      countryCode: '',
      location: loc,
      isLocal: isPrivateIp(ip),
      source: 'timezone_parser',
    };
  }

  return {
    ip: ip || 'Localhost',
    country: '',
    city: '',
    countryCode: '',
    location: null,
    isLocal: isPrivateIp(ip),
  };
}
