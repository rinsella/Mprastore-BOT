import axios, { AxiosError } from 'axios';
import { getTld, normalizeDomain } from '../utils/domain';
import { normalizeNameserverList } from '../utils/nameserver';

const IANA_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
const RDAP_TIMEOUT_MS = 12000;
const BOOTSTRAP_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 jam

/**
 * Jenis error yang bisa terjadi pada lookup RDAP.
 */
export type RdapErrorKind =
  | 'SERVER_NOT_FOUND'
  | 'TIMEOUT'
  | 'NOT_FOUND'
  | 'NETWORK'
  | 'PARSE'
  | 'BOOTSTRAP';

export class RdapError extends Error {
  kind: RdapErrorKind;
  constructor(kind: RdapErrorKind, message: string) {
    super(message);
    this.name = 'RdapError';
    this.kind = kind;
  }
}

export interface RdapLookupResult {
  domain: string;
  ldhName?: string;
  status: string[];
  nameservers: string[];
  events: { eventAction: string; eventDate: string }[];
  rdapServer: string;
}

interface BootstrapService {
  tlds: string[];
  urls: string[];
}

interface BootstrapData {
  services: [string[], string[]][];
}

let bootstrapCache: { services: BootstrapService[]; fetchedAt: number } | null = null;

/**
 * Ambil dan cache data bootstrap RDAP dari IANA.
 */
async function getBootstrap(): Promise<BootstrapService[]> {
  const now = Date.now();
  if (bootstrapCache && now - bootstrapCache.fetchedAt < BOOTSTRAP_CACHE_TTL_MS) {
    return bootstrapCache.services;
  }

  try {
    const { data } = await axios.get<BootstrapData>(IANA_BOOTSTRAP_URL, {
      timeout: RDAP_TIMEOUT_MS,
      headers: { Accept: 'application/json' },
    });

    const services: BootstrapService[] = (data.services || []).map(([tlds, urls]) => ({
      tlds: tlds.map((t) => t.toLowerCase()),
      urls,
    }));

    bootstrapCache = { services, fetchedAt: now };
    return services;
  } catch (err) {
    if (bootstrapCache) {
      // Gunakan cache lama jika ada walau kedaluwarsa.
      return bootstrapCache.services;
    }
    throw new RdapError('BOOTSTRAP', 'Gagal mengambil data bootstrap RDAP dari IANA');
  }
}

/**
 * Cari base URL RDAP untuk TLD tertentu.
 */
async function findRdapBaseUrl(tld: string): Promise<string> {
  const services = await getBootstrap();
  const lowerTld = tld.toLowerCase();

  for (const service of services) {
    if (service.tlds.includes(lowerTld)) {
      // Prioritaskan URL https
      const httpsUrl = service.urls.find((u) => u.startsWith('https://'));
      const url = httpsUrl || service.urls[0];
      if (url) {
        return url.replace(/\/$/, '');
      }
    }
  }

  throw new RdapError('SERVER_NOT_FOUND', `RDAP server tidak ditemukan untuk TLD .${tld}`);
}

/**
 * Lakukan lookup RDAP untuk sebuah domain.
 * Mengembalikan nameserver aktif, status, dan events.
 */
export async function rdapLookup(rawDomain: string): Promise<RdapLookupResult> {
  const domain = normalizeDomain(rawDomain);
  const tld = getTld(domain);

  const baseUrl = await findRdapBaseUrl(tld);
  const url = `${baseUrl}/domain/${encodeURIComponent(domain)}`;

  try {
    const { data } = await axios.get<any>(url, {
      timeout: RDAP_TIMEOUT_MS,
      headers: { Accept: 'application/rdap+json, application/json' },
      validateStatus: (s) => s === 200,
    });

    const nameservers: string[] = Array.isArray(data?.nameservers)
      ? data.nameservers
          .map((ns: any) => (typeof ns?.ldhName === 'string' ? ns.ldhName : ''))
          .filter((s: string) => s.length > 0)
      : [];

    const status: string[] = Array.isArray(data?.status) ? data.status : [];

    const events = Array.isArray(data?.events)
      ? data.events.map((e: any) => ({
          eventAction: String(e?.eventAction ?? ''),
          eventDate: String(e?.eventDate ?? ''),
        }))
      : [];

    return {
      domain,
      ldhName: typeof data?.ldhName === 'string' ? data.ldhName.toLowerCase() : undefined,
      status,
      nameservers: normalizeNameserverList(nameservers),
      events,
      rdapServer: baseUrl,
    };
  } catch (err) {
    const axiosErr = err as AxiosError;
    if (axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ETIMEDOUT') {
      throw new RdapError('TIMEOUT', 'Permintaan RDAP timeout');
    }
    if (axiosErr.response?.status === 404) {
      throw new RdapError('NOT_FOUND', 'Domain tidak ditemukan di RDAP (404)');
    }
    if (axiosErr.response) {
      throw new RdapError(
        'NETWORK',
        `RDAP server merespons dengan status ${axiosErr.response.status}`,
      );
    }
    if (err instanceof RdapError) throw err;
    throw new RdapError('NETWORK', 'Gagal menghubungi RDAP server');
  }
}

/**
 * Batasi ukuran data RDAP mentah agar tidak terlalu besar saat disimpan.
 */
export function trimRdapRaw(result: RdapLookupResult): Record<string, unknown> {
  return {
    ldhName: result.ldhName,
    status: result.status.slice(0, 20),
    nameservers: result.nameservers.slice(0, 20),
    events: result.events.slice(0, 20),
    rdapServer: result.rdapServer,
  };
}

/**
 * URL ICANN Lookup untuk sebuah domain.
 */
export function icannLookupUrl(domain: string): string {
  return `https://lookup.icann.org/en/lookup?name=${encodeURIComponent(domain)}`;
}
