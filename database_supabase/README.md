# Dokumentasi Database Supabase Cloud (PLTS Monitoring)

Folder ini berisi skema resmi dan panduan query untuk **Database Cloud Supabase (PostgreSQL)** yang digunakan oleh:
1. **Backend Scraper** (FastAPI / Python)
2. **Dashboard Web** (React / Vite)
3. **Aplikasi Mobile** (Flutter Android)

---

## 📌 Informasi Project Supabase

* **Project URL**: `https://hurtfiwuefjxfosvwbsj.supabase.co`
* **Region**: Singapore (`ap-southeast-1`)
* **Database Engine**: PostgreSQL 15+ (Hosted on Supabase)
* **Dashboard Akses**: [https://supabase.com/dashboard/project/hurtfiwuefjxfosvwbsj](https://supabase.com/dashboard/project/hurtfiwuefjxfosvwbsj)

---

## 📁 Struktur File dalam Folder Ini

1. **`schema.sql`**  
   Skrip lengkap pembuatan tabel, indeks, dan kebijakan keamanan (*Row Level Security*). File ini dieksekusi di menu **SQL Editor** Supabase.

2. **`useful_queries.sql`**  
   Kumpulan query SQL siap pakai untuk memeriksa snapshot realtime, riwayat historis per stasiun, dan daftar user yang terdaftar.

---

## 🗄️ Daftar Tabel Utama

| Nama Tabel | Deskripsi |
| :--- | :--- |
| **`monitoring_current`** | Menyimpan snapshot realtime paling akhir (1 baris data teranyar). Digunakan langsung oleh Web & Mobile untuk menampilkan angka watt, kWh, dan status stasiun saat ini. |
| **`monitoring_snapshots`** | Menyimpan arsip historis setiap kali scraper berjalan, lengkap dengan timestamp `scraped_at`. |
| **`monitoring_site_daily`** | Menyimpan rekapitulasi energi harian (`energy_kwh`) dan pendapatan (`revenue_amount`) per stasiun. |
| **`monitoring_site_hourly`** | Menyimpan data log per jam dari inverter (daya kW, energi kumulatif, tegangan, dll.). |
| **`auth.users`** | Tabel bawaan Supabase untuk menyimpan akun login staf/operator instansi secara terenkripsi. |

---

## 🔐 Keamanan & Akses

* **Backend FastAPI**: Menggunakan `SUPABASE_SECRET_KEY` (*service_role key*) yang tersimpan di `backend/.env` untuk menulis dan membaca snapshot.
* **Web & Mobile (Frontend)**: Menggunakan `SUPABASE_ANON_KEY` (kunci publik) untuk memverifikasi login user via Supabase Auth tanpa membuka celah ke database langsung.