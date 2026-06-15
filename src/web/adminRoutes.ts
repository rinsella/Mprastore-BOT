import { Router, Request, Response } from 'express';
import { Telegram } from 'telegraf';
import { NsType, OrderStatus } from '@prisma/client';
import { config } from '../config';
import {
  verifyAdminLogin,
  requireAuth,
  ensureCsrfToken,
  verifyCsrf,
  isLoginBlocked,
  registerFailedLogin,
  clearLoginAttempts,
} from './auth';
import {
  statusLabelId,
  statusBadgeClass,
  nsTypeLabelId,
  formatDate,
  bigIntToString,
  nsArray,
  auditActionLabel,
  telegramContactLink,
} from './helpers';
import {
  getDashboardStats,
  getOrdersWithFilters,
  getOrderDetail,
  getAuditLogsByOrder,
  getOrderNotesByOrder,
  addOrderNote,
  reopenOrder,
  markOrderChanged,
  rejectOrder,
  getRecentOrders,
  getOrderById,
  getExpectedNameservers,
} from '../services/orderService';
import { checkOrderNow, statusLabel } from '../services/checkerService';
import { rdapLookup, icannLookupUrl } from '../services/rdap';
import { rdapErrorMessage } from '../services/checkerService';
import { validateDomain } from '../utils/domain';

/** Set flash message di session lalu redirect. */
function flashRedirect(
  req: Request,
  res: Response,
  url: string,
  type: 'success' | 'error' | 'info',
  message: string,
): void {
  if (req.session) req.session.flash = { type, message };
  res.redirect(url);
}

/** Parse & validasi order id dari parameter route. */
function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Bangun router web admin. Semua route relatif terhadap basePath yang
 * di-mount di server (mis. '/admin' atau '/panel-mprastore').
 */
export function buildAdminRouter(telegram: Telegram, basePath: string): Router {
  const router = Router();

  // View locals umum untuk semua halaman.
  router.use((req, res, next) => {
    res.locals.base = basePath;
    res.locals.currentUser = req.session?.username ?? null;
    res.locals.webPublicUrl = config.webPublicUrl || '';
    res.locals.helpers = {
      statusLabelId,
      statusBadgeClass,
      nsTypeLabelId,
      formatDate,
      bigIntToString,
      nsArray,
      auditActionLabel,
      telegramContactLink,
      icannLookupUrl,
    };
    // Ambil flash (satu kali tampil).
    if (req.session?.flash) {
      res.locals.flash = req.session.flash;
      delete req.session.flash;
    } else {
      res.locals.flash = null;
    }
    next();
  });

  router.use(ensureCsrfToken);

  const auth = requireAuth(basePath);

  // ===================== LOGIN =====================
  router.get('/login', (req, res) => {
    if (req.session?.authenticated) {
      res.redirect(basePath);
      return;
    }
    res.render('login', { title: 'Login Admin' });
  });

  router.post('/login', verifyCsrf, async (req, res) => {
    if (isLoginBlocked(req)) {
      flashRedirect(
        req,
        res,
        `${basePath}/login`,
        'error',
        'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.',
      );
      return;
    }

    const username = String(req.body.username ?? '');
    const password = String(req.body.password ?? '');
    const ok = await verifyAdminLogin(username, password);

    if (!ok) {
      registerFailedLogin(req);
      // Jangan pernah log password.
      console.warn('[WebAdmin] Percobaan login gagal.');
      flashRedirect(req, res, `${basePath}/login`, 'error', 'Username atau password salah.');
      return;
    }

    clearLoginAttempts(req);
    req.session.regenerate((err) => {
      if (err) {
        flashRedirect(req, res, `${basePath}/login`, 'error', 'Gagal membuat sesi. Coba lagi.');
        return;
      }
      req.session.authenticated = true;
      req.session.username = username;
      res.redirect(basePath);
    });
  });

  router.post('/logout', auth, verifyCsrf, (req, res) => {
    req.session.destroy(() => {
      res.redirect(`${basePath}/login`);
    });
  });

  // ===================== DASHBOARD =====================
  router.get('/', auth, async (_req, res) => {
    const [stats, recent] = await Promise.all([getDashboardStats(), getRecentOrders(10)]);
    res.render('dashboard', {
      title: 'Dashboard',
      active: 'dashboard',
      stats,
      recent,
    });
  });

  // ===================== DAFTAR ORDER =====================
  router.get('/orders', auth, async (req, res) => {
    const domain = typeof req.query.domain === 'string' ? req.query.domain : '';
    const username = typeof req.query.username === 'string' ? req.query.username : '';
    const statusRaw = typeof req.query.status === 'string' ? req.query.status : '';
    const nsTypeRaw = typeof req.query.nsType === 'string' ? req.query.nsType : '';
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;

    const status = (Object.values(OrderStatus) as string[]).includes(statusRaw)
      ? (statusRaw as OrderStatus)
      : undefined;
    const nsType = (Object.values(NsType) as string[]).includes(nsTypeRaw)
      ? (nsTypeRaw as NsType)
      : undefined;

    const result = await getOrdersWithFilters({ domain, username, status, nsType, page });

    res.render('orders', {
      title: 'Daftar Order',
      active: 'orders',
      result,
      filters: { domain, username, status: statusRaw, nsType: nsTypeRaw },
      statuses: Object.values(OrderStatus),
      nsTypes: Object.values(NsType),
    });
  });

  // ===================== DETAIL ORDER =====================
  router.get('/orders/:id', auth, async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).send('Order ID tidak valid.');
      return;
    }
    const order = await getOrderDetail(id);
    if (!order) {
      res.status(404).render('not-found', { title: 'Order tidak ditemukan', active: 'orders' });
      return;
    }
    const [logs, notes] = await Promise.all([
      getAuditLogsByOrder(id),
      getOrderNotesByOrder(id),
    ]);
    res.render('order-detail', {
      title: `Order #${order.id}`,
      active: 'orders',
      order,
      logs,
      notes,
      expected: getExpectedNameservers(order),
      current: nsArray(order.currentNameservers),
      icannUrl: icannLookupUrl(order.domain),
    });
  });

  // ===================== AKSI ORDER =====================
  router.post('/orders/:id/check', auth, verifyCsrf, async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return void res.status(400).send('Order ID tidak valid.');
    const result = await checkOrderNow(telegram, id, 'web');
    if (!result) {
      return void flashRedirect(req, res, `${basePath}/orders`, 'error', 'Order tidak ditemukan.');
    }
    if (result.failed) {
      return void flashRedirect(
        req,
        res,
        `${basePath}/orders/${id}`,
        'error',
        'Cek nameserver gagal: ' + (result.errorMessage ?? 'RDAP error') + '. Order tetap bisa dikelola, klik "Cek Lagi" atau "Buka Kembali".',
      );
    }
    flashRedirect(
      req,
      res,
      `${basePath}/orders/${id}`,
      result.connected ? 'success' : 'info',
      result.connected
        ? 'Domain sudah terhubung (CONNECTED).'
        : 'Nameserver belum cocok. Status: Menunggu Propagasi.',
    );
  });

  router.post('/orders/:id/mark-changed', auth, verifyCsrf, async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return void res.status(400).send('Order ID tidak valid.');
    const order = await getOrderById(id);
    if (!order) return void flashRedirect(req, res, `${basePath}/orders`, 'error', 'Order tidak ditemukan.');

    await markOrderChanged(id);
    // Beri tahu customer (notifikasi diizinkan untuk aksi mark changed).
    try {
      await telegram.sendMessage(
        order.telegramUserId.toString(),
        'Admin sudah memproses perubahan nameserver. Bot akan mengecek status koneksi domain kamu.',
        { link_preview_options: { is_disabled: true } },
      );
    } catch {
      /* abaikan kegagalan kirim */
    }
    flashRedirect(req, res, `${basePath}/orders/${id}`, 'success', 'Order ditandai ADMIN_CHANGED. Customer diberi tahu.');
  });

  router.post('/orders/:id/reject', auth, verifyCsrf, async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return void res.status(400).send('Order ID tidak valid.');
    const order = await getOrderById(id);
    if (!order) return void flashRedirect(req, res, `${basePath}/orders`, 'error', 'Order tidak ditemukan.');

    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    await rejectOrder(id, reason || null);
    try {
      await telegram.sendMessage(
        order.telegramUserId.toString(),
        reason
          ? `❌ Order #${order.id} (${order.domain}) ditolak.\nAlasan: ${reason}`
          : `❌ Maaf, order #${order.id} (${order.domain}) ditolak oleh admin. Silakan hubungi admin untuk info lebih lanjut.`,
        { link_preview_options: { is_disabled: true } },
      );
    } catch {
      /* abaikan */
    }
    flashRedirect(req, res, `${basePath}/orders/${id}`, 'success', 'Order ditolak. Customer diberi tahu.');
  });

  router.post('/orders/:id/reopen', auth, verifyCsrf, async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return void res.status(400).send('Order ID tidak valid.');
    const order = await getOrderById(id);
    if (!order) return void flashRedirect(req, res, `${basePath}/orders`, 'error', 'Order tidak ditemukan.');

    await reopenOrder(id);
    flashRedirect(req, res, `${basePath}/orders/${id}`, 'success', 'Order dibuka kembali ke status Menunggu Admin.');
  });

  router.post('/orders/:id/note', auth, verifyCsrf, async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return void res.status(400).send('Order ID tidak valid.');
    const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
    if (!note) {
      return void flashRedirect(req, res, `${basePath}/orders/${id}`, 'error', 'Catatan tidak boleh kosong.');
    }
    const order = await getOrderById(id);
    if (!order) return void flashRedirect(req, res, `${basePath}/orders`, 'error', 'Order tidak ditemukan.');
    await addOrderNote(id, note);
    flashRedirect(req, res, `${basePath}/orders/${id}`, 'success', 'Catatan internal ditambahkan.');
  });

  // Kirim update status ke customer via Telegram.
  router.post('/orders/:id/notify', auth, verifyCsrf, async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return void res.status(400).send('Order ID tidak valid.');
    const order = await getOrderById(id);
    if (!order) return void flashRedirect(req, res, `${basePath}/orders`, 'error', 'Order tidak ditemukan.');

    const message = [
      `ℹ️ Update Order #${order.id}`,
      '',
      `Domain: ${order.domain}`,
      `Status: ${statusLabel(order.status)}`,
    ].join('\n');
    try {
      await telegram.sendMessage(order.telegramUserId.toString(), message, {
        link_preview_options: { is_disabled: true },
      });
      flashRedirect(req, res, `${basePath}/orders/${id}`, 'success', 'Update status terkirim ke customer.');
    } catch {
      flashRedirect(req, res, `${basePath}/orders/${id}`, 'error', 'Gagal mengirim pesan ke customer (mungkin bot diblokir).');
    }
  });

  // ===================== LOOKUP MANUAL =====================
  router.get('/lookup', auth, (req, res) => {
    res.render('lookup', {
      title: 'Lookup RDAP Manual',
      active: 'lookup',
      domain: typeof req.query.domain === 'string' ? req.query.domain : '',
      result: null,
      error: null,
    });
  });

  router.post('/lookup', auth, verifyCsrf, async (req, res) => {
    const input = typeof req.body.domain === 'string' ? req.body.domain : '';
    const validation = validateDomain(input);
    if (!validation.ok || !validation.domain) {
      return void res.render('lookup', {
        title: 'Lookup RDAP Manual',
        active: 'lookup',
        domain: input,
        result: null,
        error: 'Format domain tidak valid. Contoh: example.com',
      });
    }
    try {
      const result = await rdapLookup(validation.domain);
      res.render('lookup', {
        title: 'Lookup RDAP Manual',
        active: 'lookup',
        domain: validation.domain,
        result,
        error: null,
      });
    } catch (err) {
      res.render('lookup', {
        title: 'Lookup RDAP Manual',
        active: 'lookup',
        domain: validation.domain,
        result: null,
        error: rdapErrorMessage(err),
      });
    }
  });

  return router;
}
