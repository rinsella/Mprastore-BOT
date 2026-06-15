# Mprastore Bot — Bot Order Nameserver Domain (Telegram)

Bot Telegram untuk memproses order **perubahan nameserver domain** secara otomatis. Bot memandu customer langkah demi langkah, mengumpulkan domain & nameserver tujuan, memberi tahu admin, lalu **memverifikasi nameserver secara otomatis menggunakan RDAP/ICANN** (bukan scraping HTML).

Dibangun dengan **Node.js 20+, TypeScript, Telegraf.js, PostgreSQL, Prisma, Axios, Zod, Docker**.

---

## ✨ Fitur

- Alur order interaktif (inline button) dalam Bahasa Indonesia.
- Validasi & normalisasi domain otomatis (hapus `https://`, `http://`, `www.`, path, dll).
- Validasi nameserver (minimal 2, lowercase, hapus trailing dot, hapus duplikat).
- Tipe nameserver: **Cloudflare** atau **Custom / Non-Cloudflare**.
- Notifikasi admin dengan tombol aksi: Cek Nameserver, Tandai Sudah Diubah, Tolak, Hubungi Customer.
- **RDAP lookup** memakai IANA bootstrap (`https://data.iana.org/rdap/dns.json`).
- Perbandingan nameserver *order-insensitive* & *duplicate-insensitive*.
- **Auto recheck** berkala untuk order `ADMIN_CHANGED` & `WAITING_PROPAGATION`.
- Multi-admin via `ADMIN_IDS` (dipisah koma).
- Health check endpoint `/health` (Express).
- Rate limit sederhana anti-spam.
- Order code format `ORD-2026-000001`.
- Command admin manual `/lookup <domain>`.

---

## 🧱 Struktur Proyek

```
prisma/
  schema.prisma
src/
  index.ts                 # Entry point: DB, Express /health, bot, auto-recheck
  bot.ts                   # Konfigurasi Telegraf, session, routing
  config.ts                # Validasi env (Zod), daftar admin
  db.ts                    # Prisma client
  types.ts                 # Tipe context & session
  services/
    rdap.ts                # RDAP/IANA bootstrap lookup
    orderService.ts        # CRUD order, audit log, order code
    checkerService.ts      # Verifikasi NS, notifikasi, auto-recheck
  utils/
    domain.ts              # Normalisasi & validasi domain
    nameserver.ts          # Parse, normalisasi, perbandingan NS
  middlewares/
    adminOnly.ts           # Guard admin
    rateLimit.ts           # Anti-spam
  commands/
    start.ts               # /start /help
    order.ts               # /order /cancel + alur interaktif
    status.ts              # /status
    admin.ts               # /admin /orders /pending /connected /detail /lookup + aksi
```

---

## 🔧 Environment Variables

Salin `.env.example` menjadi `.env` lalu isi:

```env
BOT_TOKEN=your_telegram_bot_token
ADMIN_IDS=123456789
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/domainbot
CHECK_INTERVAL_MINUTES=10
NODE_ENV=production
PORT=3000

# Web Admin Panel
WEB_PUBLIC_URL=https://your-domain.com
ADMIN_WEB_ENABLED=true
ADMIN_WEB_PATH=/admin
ADMIN_WEB_USERNAME=admin
ADMIN_WEB_PASSWORD_HASH=
ADMIN_WEB_PASSWORD=change_me
SESSION_SECRET=change_this_to_random_secret
SESSION_MAX_AGE_HOURS=8
```

| Variabel | Wajib | Keterangan |
|---|---|---|
| `BOT_TOKEN` | ✅ | Token dari @BotFather. **Jangan** di-commit. |
| `ADMIN_IDS` | ✅ | ID Telegram admin. Multi-admin pisahkan koma: `123,456`. |
| `DATABASE_URL` | ✅ | Connection string PostgreSQL. |
| `CHECK_INTERVAL_MINUTES` | ➖ | Interval auto-recheck (default `10`). |
| `NODE_ENV` | ➖ | `production` / `development`. |
| `PORT` | ➖ | Port web server (default `3000`). |
| `WEB_PUBLIC_URL` | ➖ | URL publik (untuk link `/webadmin` di bot). Tanpa trailing slash. |
| `ADMIN_WEB_ENABLED` | ➖ | `true` untuk mengaktifkan panel web. Jika `false`, hanya `/health` publik. |
| `ADMIN_WEB_PATH` | ➖ | Path dasar panel (default `/admin`, bisa `/panel-mprastore`). |
| `ADMIN_WEB_USERNAME` | ➖ | Username login web (default `admin`). |
| `ADMIN_WEB_PASSWORD_HASH` | ➖ | **Disarankan.** Hash bcrypt password. |
| `ADMIN_WEB_PASSWORD` | ➖ | Alternatif teks biasa. Hanya dipakai jika HASH kosong (ada peringatan di log). |
| `SESSION_SECRET` | ➖ | Secret penandatangan cookie sesi. **Wajib di produksi.** |
| `SESSION_MAX_AGE_HOURS` | ➖ | Masa berlaku sesi login (default `8` jam). |

> **Keamanan:** `BOT_TOKEN`, `ADMIN_IDS`, kredensial database, dan password admin tidak pernah di-hardcode dan tidak pernah di-log.

---

## 🖥️ Web Admin Panel

Selain panel berbasis Telegram, tersedia **dashboard web admin** yang berjalan pada Express yang sama.

### Mengaktifkan

1. Set `ADMIN_WEB_ENABLED=true`.
2. Set `ADMIN_WEB_USERNAME` dan **salah satu** dari:
   - `ADMIN_WEB_PASSWORD_HASH` (disarankan), buat dengan:
     ```bash
     node -e "console.log(require('bcryptjs').hashSync('passwordku',10))"
     ```
   - `ADMIN_WEB_PASSWORD` (teks biasa, kurang aman).
3. Set `SESSION_SECRET` ke string acak yang panjang.
4. (Opsional) ubah `ADMIN_WEB_PATH`, mis. `/panel-mprastore`.

### Halaman & Route

Semua route berada di bawah `ADMIN_WEB_PATH` (default `/admin`):

| Route | Fungsi |
|---|---|
| `GET /admin/login` · `POST /admin/login` | Halaman & proses login. |
| `POST /admin/logout` | Logout. |
| `GET /admin` | Dashboard (kartu statistik + order terbaru). |
| `GET /admin/orders` | Daftar order (cari domain/username, filter status & tipe NS, pagination). |
| `GET /admin/orders/:id` | Detail order, timeline, audit log, catatan internal. |
| `POST /admin/orders/:id/check` | Jalankan cek RDAP nameserver. |
| `POST /admin/orders/:id/mark-changed` | Tandai `ADMIN_CHANGED` + notifikasi customer. |
| `POST /admin/orders/:id/reject` | Tolak order (alasan opsional) + notifikasi customer. |
| `POST /admin/orders/:id/reopen` | Buka kembali order gagal/ditolak ke `WAITING_ADMIN`. |
| `POST /admin/orders/:id/note` | Tambah catatan internal (tidak terlihat customer). |
| `POST /admin/orders/:id/notify` | Kirim update status ke customer via Telegram. |
| `GET /admin/lookup` · `POST /admin/lookup` | Lookup RDAP manual. |

Jika `ADMIN_WEB_ENABLED=false`, semua route di atas dinonaktifkan dan hanya `/health` yang publik.

### 🔒 Keamanan Web Admin

- Semua route admin (selain login) dilindungi sesi login.
- Cookie sesi **HTTP-only**, `secure` otomatis aktif di `NODE_ENV=production`.
- Proteksi **CSRF** untuk semua aksi POST.
- **Rate limit** percobaan login (anti brute-force).
- Header keamanan via **helmet** (termasuk CSP).
- Login web admin & admin Telegram adalah dua proteksi terpisah.
- **WAJIB gunakan HTTPS di produksi** (mis. lewat reverse proxy / Railway). Tanpa HTTPS, cookie & password rentan disadap.

---


## 🤖 Cara Mendapatkan Bot Token & Admin ID

1. Buka [@BotFather](https://t.me/BotFather) → `/newbot` → ikuti instruksi → salin **token**.
2. Buka [@userinfobot](https://t.me/userinfobot) untuk mendapatkan **Telegram ID** kamu → pakai sebagai `ADMIN_IDS`.

---

## 🚀 Menjalankan Lokal (Dev)

```bash
# 1. Install dependency
npm install

# 2. Siapkan .env
cp .env.example .env
# isi BOT_TOKEN, ADMIN_IDS, DATABASE_URL

# 3. Generate Prisma client & migrasi
npm run prisma:generate
npm run prisma:migrate

# 4. Jalankan mode dev
npm run dev
```

Health check: `http://localhost:3000/health`

---

## 📜 Scripts

| Script | Fungsi |
|---|---|
| `npm run dev` | Jalankan dengan hot-reload (ts-node-dev). |
| `npm run build` | Compile TypeScript ke `dist/`. |
| `npm run start` | Jalankan hasil build (`dist/index.js`). |
| `npm run prisma:generate` | Generate Prisma client. |
| `npm run prisma:migrate` | Migrasi dev (membuat migration). |
| `npm run prisma:deploy` | Migrasi production (`migrate deploy`). |
| `npm run lint` | ESLint. |

---

## 🐳 Deployment Docker / VPS

### Prasyarat: Install Docker

```bash
curl -fsSL https://get.docker.com | sh
```

### Langkah

```bash
# 1. Clone repo
git clone https://github.com/rinsella/Mprastore-BOT.git
cd Mprastore-BOT

# 2. Salin & isi env
cp .env.example .env
# isi BOT_TOKEN dan ADMIN_IDS
# untuk web admin: ADMIN_WEB_ENABLED, ADMIN_WEB_USERNAME, ADMIN_WEB_PASSWORD(_HASH), SESSION_SECRET
# (DATABASE_URL di-handle otomatis oleh docker-compose untuk service db)

# 3. Build & jalankan
docker compose up -d --build

# 4. Cek log
docker compose logs -f bot
```

Migrasi database dijalankan otomatis (`prisma migrate deploy`) saat container `bot` start.

Setelah berjalan, buka panel web admin di `http://server-ip:3000/admin` lalu login.

> ⚠️ **Produksi:** taruh di belakang reverse proxy ber-HTTPS (Nginx/Caddy/Easypanel) sebelum diekspos ke internet.

---

## 🚆 Deployment Railway

1. Buat bot Telegram via **@BotFather**, salin **bot token**.
2. Buat **project baru** di Railway.
3. Tambahkan service **PostgreSQL** (Railway menyediakan `DATABASE_URL`).
4. Tambahkan **environment variables** di service bot:
   - `BOT_TOKEN`
   - `ADMIN_IDS`
   - `DATABASE_URL` (referensikan dari service Postgres, mis. `${{Postgres.DATABASE_URL}}`)
   - `CHECK_INTERVAL_MINUTES` (opsional)
   - `WEB_PUBLIC_URL` (URL publik Railway, mis. `https://namamu.up.railway.app`)
   - `ADMIN_WEB_ENABLED=true`
   - `ADMIN_WEB_USERNAME`
   - `ADMIN_WEB_PASSWORD` atau `ADMIN_WEB_PASSWORD_HASH`
   - `SESSION_SECRET` (string acak)
5. **Deploy dari GitHub** (hubungkan repo ini).
6. Jalankan migrasi:
   ```bash
   npx prisma migrate deploy
   ```
   (Sudah otomatis dijalankan oleh `startCommand` di `railway.json`.)
7. Start command:
   ```bash
   npm run start
   ```

> File `railway.json` sudah disertakan dengan `startCommand` yang menjalankan migrasi + start.

Deployment juga kompatibel dengan **Easypanel** dan **VPS** mana pun yang mendukung Docker.

---

## 💬 Perintah Bot

### Customer
| Command | Fungsi |
|---|---|
| `/start` | Pesan sambutan. |
| `/order` | Mulai order ubah nameserver. |
| `/status` | 5 pesanan terakhir kamu. |
| `/cancel` | Batalkan proses order berjalan. |
| `/help` | Bantuan. |

### Admin
| Command | Fungsi |
|---|---|
| `/admin` | Panel admin. |
| `/orders` | 10 order terbaru. |
| `/pending` | Order `WAITING_ADMIN`, `ADMIN_CHANGED`, `WAITING_PROPAGATION`. |
| `/connected` | Order yang sudah connect. |
| `/detail <id>` atau `/order_<id>` | Detail order + tombol aksi. |
| `/lookup <domain>` | Cek RDAP manual. |
| `/reject <id> <alasan>` | Tolak order dengan alasan. |
| `/webadmin` | Tampilkan link panel web admin. |

---

## 🔁 Alur Status Order

```
NEW → WAITING_ADMIN → ADMIN_CHANGED → WAITING_PROPAGATION → CONNECTED
                                   ↘ REJECTED
                                   ↘ FAILED_LOOKUP (gagal RDAP)
```

- **🔍 Cek Nameserver:** RDAP lookup → cocok = `CONNECTED`, tidak = `WAITING_PROPAGATION`.
- **✅ Tandai Sudah Diubah:** status `ADMIN_CHANGED`, customer diberi tahu, auto-recheck mulai memantau.
- **❌ Tolak Order:** status `REJECTED`, customer diberi tahu (alasan opsional via `/reject`).
- **💬 Hubungi Customer:** tampilkan link/username customer.

---

## 🖼 Contoh Pesan (Teks)

**Pesan sambutan `/start`:**
```
Halo 👋
Saya bot order nameserver domain.

Kamu bisa membuat pesanan ubah nameserver dengan perintah:
/order

Cek status pesanan:
/status
```

**Notifikasi admin (order baru):**
```
🆕 Order Baru

Order ID: #123 (ORD-2026-000123)
Customer Telegram ID: 987654321
Username: @customer
Domain: example.com
Tipe Nameserver: Cloudflare

Nameserver tujuan:
- adam.ns.cloudflare.com
- vera.ns.cloudflare.com

Status: Menunggu Admin
[🔍 Cek Nameserver] [✅ Tandai Sudah Diubah]
[❌ Tolak Order]    [💬 Hubungi Customer]
```

**Domain sudah connect:**
```
✅ Domain kamu sudah connect.

Order ID: #123
Domain: example.com

Nameserver aktif:
- adam.ns.cloudflare.com
- vera.ns.cloudflare.com

Status RDAP:
- active
- client transfer prohibited

ICANN Lookup:
https://lookup.icann.org/en/lookup?name=example.com
```

**Nameserver belum match:**
```
⏳ Nameserver belum match.

Order ID: #123
Domain: example.com

Nameserver tujuan:
- adam.ns.cloudflare.com
- vera.ns.cloudflare.com

Nameserver saat ini:
- ns1.oldserver.com
- ns2.oldserver.com

Kemungkinan masih propagasi atau nameserver belum diubah di registrar.
```

---

## 🗄 Skema Database (Prisma)

- **User** — data pengguna Telegram.
- **Order** — order nameserver (domain, tipe NS, NS tujuan/saat ini, status, RDAP raw, timestamp).
- **AuditLog** — jejak aksi (order dibuat, status berubah, aksi admin).

Enum:
- `OrderStatus`: `NEW`, `WAITING_ADMIN`, `ADMIN_CHANGED`, `WAITING_PROPAGATION`, `CONNECTED`, `REJECTED`, `FAILED_LOOKUP`.
- `NsType`: `CLOUDFLARE`, `CUSTOM`.

---

## 🔐 Keamanan

- `BOT_TOKEN` tidak pernah di-log.
- Hanya `ADMIN_IDS` yang bisa menjalankan aksi admin (command & tombol).
- Semua callback order ID divalidasi.
- Non-admin tidak bisa menekan tombol admin.
- Pesan error aman (tidak membocorkan detail internal).
- Data RDAP mentah dipangkas sebelum disimpan.

---

## 🧪 Catatan RDAP

RDAP tidak tersedia untuk semua TLD. Bila TLD tidak ada di bootstrap IANA, bot mengembalikan pesan ramah dan status `FAILED_LOOKUP`. Selalu sertakan tautan ICANN Lookup sebagai cadangan manual:
`https://lookup.icann.org/en/lookup?name=<domain>`

---

## 📄 Lisensi

MIT