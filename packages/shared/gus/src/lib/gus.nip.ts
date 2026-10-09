import { NipService } from '@smartsoft001/utils';

/**
 * A Polish tax number (NIP) as ten digits, or null when it is not one: accepts spaces, dashes and the `PL` prefix and
 * checks the control digit with {@link NipService}.
 */
export function normalizeNip(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 32) return null;
  const digits = value.replace(/^\s*PL/i, '').replace(/[\s-]/g, '');
  return /^\d{10}$/.test(digits) && NipService.isValid(digits) ? digits : null;
}
