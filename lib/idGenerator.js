/**
 * Generates an ID in the format: HFA-{first 2 letters of company name}-{random number}
 * Example: company "Al-Barakah Foods" -> "HFA-AL-58291"
 * @param {string} companyName - The company name or establishment name
 * @param {number} digits - Number of random digits (default 5)
 * @returns {string} Formatted ID
 */
export function generateHfaId(companyName, digits = 5) {
  let prefix = 'UK';
  if (companyName && typeof companyName === 'string') {
    const clean = companyName.replace(/[^a-zA-Z]/g, '').toUpperCase();
    if (clean.length >= 2) {
      prefix = clean.slice(0, 2);
    } else if (clean.length === 1) {
      prefix = clean + 'X';
    }
  }
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits) - 1;
  const randomNum = Math.floor(min + Math.random() * (max - min + 1));
  return `HFA-${prefix}-${randomNum}`;
}

export default generateHfaId;
