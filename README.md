# Captain Coffee POS — Arsitektur 2 Versi Terpisah (`v2-split`)

Folder ini berisi versi pemisahan **Kasir Ultra-Lite** dan **Owner Dashboard** yang dibuat **100% terpisah** dari file lama (`dashboard_operasional_kds_captain_coffee_v3.html`, `captain-pos-tablet/`, `Backend_Captain_Coffee_v2.gs`). Tidak ada file produksi yang diubah.

---

## 1. Struktur Folder

```text
captain-pos-v2-split/
├── kasir/                                  # Aplikasi khusus Tablet Android Kasir & KDS Barista
│   ├── index.html                          # 29.1 KB — Semantik HTML + 10 modal operasional
│   ├── styles.css                          # 16.9 KB — Pure CSS statis (0 Tailwind CDN, 0 backdrop-blur)
│   ├── app.js                              # 113.4 KB — POS, Split Bill, Radar 2D, KDS, Kasbon, Pengeluaran, Settlement, BT Printer
│   ├── sw.js                               # 1.5 KB — Service Worker PWA (Network-First + Offline fallback)
│   ├── manifest.json                       # 0.6 KB — Manifest PWA ("Captain POS Lite")
│   ├── icon-192.png                        # Ikon aplikasi
│   └── icon-512.png                        # Ikon splash screen
│
├── owner/                                  # Aplikasi khusus Laptop / HP Owner & Supervisor
│   ├── index.html                          # 11.2 KB — Ringkasan 30h, Penjualan, Pengeluaran, Kasbon, Settlement, Audit Log
│   ├── styles.css                          # 5.0 KB — Pure CSS statis
│   ├── app.js                              # 37.7 KB — Grafik SVG 30h, Top/Slow Menu, Ekspor CSV, Audit PIN Supervisor
│   ├── sw.js                               # 1.1 KB — Service Worker PWA ("Captain Owner")
│   ├── manifest.json                       # 0.6 KB — Manifest PWA
│   ├── icon-192.png
│   └── icon-512.png
│
└── backend/
    └── Backend_Captain_Coffee_v2_6_Fast.gs # Salinan upgrade v2.6 (tambah fast-poll sinceVer nol-baca Sheets)
```

---

## 2. Perbandingan Beban Perangkat (Terukur)

| Metrik | Versi Lama (Monolitik) | `kasir/` (Ultra-Lite) | `owner/` (Dashboard) |
| :--- | :--- | :--- | :--- |
| **Ukuran Kode Utama** | **795.7 KB** (1 file HTML) | **161.5 KB** (-79.7%) | **55.6 KB** (-93.0%) |
| **Tailwind Play CDN (JIT Compiler)** | ~350 KB + `MutationObserver` | **0 KB (Dihapus total)** | **0 KB (Dihapus total)** |
| **Google Fonts Eksternal** | Ya (blokir render saat sinyal lambat) | **Tidak (Font sistem Android)** | **Tidak** |
| **Efek GPU Berat (`backdrop-blur`)** | 29 elemen | **0** | **0** |
| **Animasi CSS Terus-menerus (`pulse/ping/radar`)** | 33 elemen | **0** | **0** |
| **Loop Timer Latar Belakang** | 6 `setInterval` (termasuk 1 dtk AI & 5 dtk rebuild Kanban) | **Hanya 30 dtk update teks angka menit** | **15 dtk fast-poll ringan** |
| **Render View** | Banyak bagian di-render sekaligus | **Hanya view aktif** (Kasir / Radar / KDS) | **Hanya tab aktif** |

---

## 3. Kompatibilitas & Cara Uji Coba

### A. Uji Coba Frontend Dulu (Langsung Jalan dengan Backend v2.5 Sekarang!)
Baik `kasir/` maupun `owner/` **sudah langsung kompatibel** dengan URL Google Apps Script v2.5 yang sedang aktif sekarang (`DEFAULT_SCRIPT_URL` sudah terisi otomatis).

1. **GitHub Pages (Disarankan untuk Tablet Android & HP Owner)**:
   - Buat repositori baru (misal `captain-pos-lite`), lalu upload isi folder `captain-pos-v2-split/` (folder `kasir/` dan `owner/`).
   - Aktifkan **GitHub Pages** pada branch `main` / root.
   - Alamat aplikasi:
     - **Tablet Kasir**: `https://<username>.github.io/captain-pos-lite/kasir/`
     - **Layar KDS Barista** (opsional): `https://<username>.github.io/captain-pos-lite/kasir/?mode=kds`
     - **HP / Laptop Owner**: `https://<username>.github.io/captain-pos-lite/owner/`
   - Di Chrome Tablet Android, buka link `/kasir/` lalu pilih **Tambahkan ke Layar Utama (Add to Home Screen)** agar terpasang sebagai PWA mandiri dengan ikon sendiri (tidak menimpa aplikasi lama selama masa uji coba).

### B. Upgrade Backend ke `v2.6` (Opsional — Direkomendasikan untuk Hemat CPU/Jaringan)
File `backend/Backend_Captain_Coffee_v2_6_Fast.gs` menambahkan mekanisme **`sinceVer` / `dataVersion`**:
- Saat kasir atau owner melakukan polling dan **tidak ada transaksi/perubahan baru** di server, Google Apps Script langsung membalas JSON `<100 byte` (`{"status":"success","unchanged":true,"dataVersion":...}`) **tanpa membuka Spreadsheet sama sekali**.
- Tetap **100% backward-compatible** dengan aplikasi lama (`dashboard_operasional_kds_captain_coffee_v3.html`) dan menu pelanggan (`pesan digital_v2.html`).
- **Langkah pasang di Google Apps Script**:
  1. Buka proyek Apps Script Spreadsheet Captain Coffee.
  2. Ganti kode `Code.gs` dengan isi `backend/Backend_Captain_Coffee_v2_6_Fast.gs`.
  3. Klik **Deploy → Manage Deployments → Edit (ikon pensil) → New Version → Deploy** (agar URL `/exec` lama tidak berubah).
  4. Jalankan fungsi `setupBackend()` sekali dari editor (opsional, untuk memastikan seluruh trigger aktif).
