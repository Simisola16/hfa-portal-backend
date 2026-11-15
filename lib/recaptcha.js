const GOOGLE_DEV_TEST_SECRET = '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe';
const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

let warnedMissingSecret = false;

/**
 * Verifies a Google reCAPTCHA v2 response token against Google's siteverify API.
 * In non-production environments, falls back to Google's official test secret key
 * when RECAPTCHA_SECRET_KEY is not configured.
 */
export async function verifyRecaptchaToken(token, remoteIp) {
  const secret =
    process.env.RECAPTCHA_SECRET_KEY ||
    (process.env.NODE_ENV !== 'production' ? GOOGLE_DEV_TEST_SECRET : '');

  if (!secret) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.warn('[reCAPTCHA] RECAPTCHA_SECRET_KEY is not set; skipping server-side verification.');
    }
    return { ok: true, skipped: true };
  }

  if (!token || typeof token !== 'string' || !token.trim()) {
    return {
      ok: false,
      status: 400,
      error: 'Please complete the "I\'m not a robot" verification.',
    };
  }

  try {
    const params = new URLSearchParams({
      secret,
      response: token.trim(),
    });
    if (remoteIp) {
      params.append('remoteip', remoteIp);
    }

    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      console.error('[reCAPTCHA] Google siteverify HTTP error:', res.status);
      return {
        ok: false,
        status: 502,
        error: 'Unable to verify human check right now. Please try again.',
      };
    }

    const data = await res.json();
    if (!data.success) {
      console.warn('[reCAPTCHA] Verification rejected:', data['error-codes'] || []);
      return {
        ok: false,
        status: 400,
        error: 'Human verification failed or expired. Please try again.',
      };
    }

    return { ok: true };
  } catch (err) {
    console.error('[reCAPTCHA] Verification error:', err.message);
    return {
      ok: false,
      status: 502,
      error: 'Unable to verify human check right now. Please try again.',
    };
  }
}

