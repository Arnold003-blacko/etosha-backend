/**
 * Input sanitization utilities to prevent XSS attacks
 * These functions sanitize user input before storing or displaying
 */

/**
 * Sanitize a string by removing potentially dangerous HTML/script tags
 * For basic text sanitization (removes HTML tags)
 */
export function sanitizeString(input: string | null | undefined): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Remove HTML tags
  let sanitized = input.replace(/<[^>]*>/g, '');
  
  // Escape HTML entities
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');

  return sanitized.trim();
}

/**
 * Sanitize an object recursively (for nested objects)
 */
export function sanitizeObject<T extends Record<string, any>>(obj: T): T {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const sanitized = { ...obj };

  for (const key in sanitized) {
    if (typeof sanitized[key] === 'string') {
      sanitized[key] = sanitizeString(sanitized[key]) as any;
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeObject(sanitized[key]) as any;
    }
  }

  return sanitized;
}

/**
 * Sanitize email address (basic validation + sanitization)
 */
export function sanitizeEmail(email: string | null | undefined): string {
  if (!email || typeof email !== 'string') {
    return '';
  }

  // Remove any HTML tags and trim
  let sanitized = sanitizeString(email).toLowerCase().trim();
  
  // Basic email validation (simple check)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(sanitized)) {
    return '';
  }

  return sanitized;
}

/**
 * Sanitize phone number (remove non-numeric characters except +)
 */
export function sanitizePhone(phone: string | null | undefined): string {
  if (!phone || typeof phone !== 'string') {
    return '';
  }

  // Remove HTML tags first
  let sanitized = sanitizeString(phone);
  
  // Keep only digits, spaces, dashes, parentheses, and +
  sanitized = sanitized.replace(/[^\d\s\-()+]/g, '');
  
  return sanitized.trim();
}

/**
 * Sanitize URL (basic validation)
 */
export function sanitizeUrl(url: string | null | undefined): string {
  if (!url || typeof url !== 'string') {
    return '';
  }

  let sanitized = sanitizeString(url).trim();
  
  // Basic URL validation
  try {
    const urlObj = new URL(sanitized);
    // Only allow http and https protocols
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return '';
    }
    return sanitized;
  } catch {
    return '';
  }
}
