/**
 * Type codes mapping for HFA applications and certificates
 * NE = New
 * RE = Renewal
 * EX = Extension
 * SU = Surveillance
 * AD = Add-on
 */
export const HFA_TYPE_CODES = {
  new: 'NE',
  initial: 'NE',
  standard: 'NE',
  renewal: 'RE',
  renew: 'RE',
  extension: 'EX',
  extend: 'EX',
  surveillance: 'SU',
  surv: 'SU',
  addon: 'AD',
  'add-on': 'AD',
  add_on: 'AD',
  NE: 'NE',
  RE: 'RE',
  EX: 'EX',
  SU: 'SU',
  AD: 'AD'
};

/**
 * Normalizes an application/certificate type into a standard 2-letter classification code.
 * @param {string} type - 'new', 'renewal', 'extension', 'surveillance', 'addon', etc.
 * @returns {string} 2-letter code ('NE', 'RE', 'EX', 'SU', 'AD')
 */
export function normalizeHfaTypeCode(type) {
  if (!type || typeof type !== 'string') return 'NE';
  const clean = type.toLowerCase().trim();
  if (HFA_TYPE_CODES[clean]) return HFA_TYPE_CODES[clean];
  if (HFA_TYPE_CODES[type.toUpperCase().trim()]) return HFA_TYPE_CODES[type.toUpperCase().trim()];
  if (clean.includes('surv')) return 'SU';
  if (clean.includes('renew')) return 'RE';
  if (clean.includes('ext')) return 'EX';
  if (clean.includes('add')) return 'AD';
  if (clean.includes('new') || clean.includes('init')) return 'NE';
  return 'NE';
}

/**
 * Generates an ID in the format: HFA-{first 2 letters of company name}-{type code}-{random number}
 * Examples:
 * - New: "HFA-AL-NE-83014"
 * - Renewal: "HFA-AL-RE-83014"
 * - Extension: "HFA-AL-EX-83014"
 * - Surveillance: "HFA-AL-SU-83014"
 * - Add-on: "HFA-AL-AD-83014"
 * 
 * @param {string} companyName - The company name or establishment name
 * @param {string|number} typeOrDigits - Type code ('NE', 'RE', 'EX', 'SU', 'AD') or number of digits if legacy
 * @param {number} digits - Number of random digits (default 5)
 * @returns {string} Formatted ID
 */
export function generateHfaId(companyName, typeOrDigits = 'NE', digits = 5) {
  let prefix = 'UK';
  if (companyName && typeof companyName === 'string') {
    const clean = companyName.replace(/[^a-zA-Z]/g, '').toUpperCase();
    if (clean.length >= 2) {
      prefix = clean.slice(0, 2);
    } else if (clean.length === 1) {
      prefix = clean + 'X';
    }
  }

  let typeCode = 'NE';
  let numDigits = 5;

  if (typeof typeOrDigits === 'number') {
    numDigits = typeOrDigits;
  } else if (typeof typeOrDigits === 'string') {
    typeCode = normalizeHfaTypeCode(typeOrDigits);
    if (typeof digits === 'number') {
      numDigits = digits;
    }
  }

  const min = Math.pow(10, numDigits - 1);
  const max = Math.pow(10, numDigits) - 1;
  const randomNum = Math.floor(min + Math.random() * (max - min + 1));
  return `HFA-${prefix}-${typeCode}-${randomNum}`;
}

export default generateHfaId;
