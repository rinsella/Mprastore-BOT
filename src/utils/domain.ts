import { z } from 'zod';

/**
 * Regex sederhana untuk memvalidasi format domain (LDH: letters, digits, hyphen).
 * Mengizinkan label multi-level seperti sub.example.co.id.
 */
const DOMAIN_REGEX =
  /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export const domainSchema = z
  .string()
  .min(3)
  .max(253)
  .regex(DOMAIN_REGEX, 'Format domain tidak valid');

/**
 * Normalisasi input domain dari pengguna:
 * - lowercase
 * - hapus skema http:// dan https://
 * - hapus prefix www.
 * - hapus path setelah '/'
 * - hapus spasi
 */
export function normalizeDomain(input: string): string {
  let domain = (input || '').trim().toLowerCase();

  // Hapus skema
  domain = domain.replace(/^https?:\/\//, '');

  // Hapus prefix www.
  domain = domain.replace(/^www\./, '');

  // Hapus path / query / fragment
  domain = domain.split('/')[0];
  domain = domain.split('?')[0];
  domain = domain.split('#')[0];

  // Hapus port jika ada
  domain = domain.split(':')[0];

  // Hapus trailing dot
  domain = domain.replace(/\.$/, '');

  return domain.trim();
}

export interface DomainValidationResult {
  ok: boolean;
  domain?: string;
  error?: string;
}

/**
 * Normalisasi + validasi domain.
 */
export function validateDomain(input: string): DomainValidationResult {
  const normalized = normalizeDomain(input);
  const result = domainSchema.safeParse(normalized);
  if (!result.success) {
    return { ok: false, error: 'Domain tidak valid' };
  }
  return { ok: true, domain: normalized };
}

/**
 * Ambil TLD (label terakhir) dari domain.
 * Contoh: example.co.id -> "id".
 */
export function getTld(domain: string): string {
  const parts = domain.split('.');
  return parts[parts.length - 1];
}
