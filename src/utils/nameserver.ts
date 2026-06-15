/**
 * Regex hostname (FQDN) untuk nameserver.
 */
const HOSTNAME_REGEX =
  /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/**
 * Normalisasi satu hostname nameserver:
 * - lowercase
 * - hapus trailing dot
 * - hapus spasi
 */
export function normalizeNameserver(ns: string): string {
  return (ns || '').trim().toLowerCase().replace(/\.$/, '');
}

/**
 * Validasi format hostname nameserver.
 */
export function isValidNameserver(ns: string): boolean {
  return HOSTNAME_REGEX.test(ns);
}

export interface NameserverParseResult {
  ok: boolean;
  nameservers?: string[];
  error?: string;
}

/**
 * Parse input teks dari pengguna menjadi daftar nameserver yang valid.
 * Mendukung pemisah baris baru, koma, atau spasi.
 * - normalisasi lowercase
 * - hapus trailing dot
 * - hapus duplikat (order-preserving)
 * - minimal 2 nameserver
 * - validasi format hostname
 */
export function parseNameservers(input: string): NameserverParseResult {
  const raw = (input || '')
    .split(/[\s,]+/)
    .map((s) => normalizeNameserver(s))
    .filter((s) => s.length > 0);

  if (raw.length === 0) {
    return { ok: false, error: 'Tidak ada nameserver yang terdeteksi.' };
  }

  // Hapus duplikat dengan mempertahankan urutan
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const ns of raw) {
    if (!seen.has(ns)) {
      seen.add(ns);
      unique.push(ns);
    }
  }

  // Validasi format
  const invalid = unique.filter((ns) => !isValidNameserver(ns));
  if (invalid.length > 0) {
    return {
      ok: false,
      error: `Nameserver tidak valid: ${invalid.join(', ')}`,
    };
  }

  if (unique.length < 2) {
    return {
      ok: false,
      error: 'Minimal 2 nameserver diperlukan.',
    };
  }

  return { ok: true, nameservers: unique };
}

/**
 * Normalisasi array nameserver (lowercase, hapus trailing dot, hapus duplikat).
 */
export function normalizeNameserverList(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const ns = normalizeNameserver(item);
    if (ns && !seen.has(ns)) {
      seen.add(ns);
      out.push(ns);
    }
  }
  return out;
}

/**
 * Bandingkan dua daftar nameserver secara:
 * - order-insensitive
 * - duplicate-insensitive
 * - case-insensitive (sudah dinormalisasi)
 *
 * Match jika setiap nameserver yang diharapkan ada di daftar saat ini.
 */
export function nameserversMatch(expected: string[], current: string[]): boolean {
  const exp = new Set(normalizeNameserverList(expected));
  const cur = new Set(normalizeNameserverList(current));

  if (exp.size === 0 || cur.size === 0) return false;
  if (exp.size !== cur.size) return false;

  for (const ns of exp) {
    if (!cur.has(ns)) return false;
  }
  return true;
}
