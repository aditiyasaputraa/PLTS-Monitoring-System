-- ==============================================================================
-- QUERY SQL BERGUNA UNTUK SUPABASE
-- Bisa dijalankan kapan saja di Supabase Dashboard -> SQL Editor
-- ==============================================================================

-- 1. Melihat Data Snapshot Realtime Terbaru (Seluruh 6 Stasiun)
SELECT 
    run_id,
    scraped_at,
    updated_at,
    summary->'total_stations' as total_stations,
    summary->'total_capacity_kwp' as capacity_kwp,
    summary->'total_current_power_kw' as power_now_kw
FROM public.monitoring_current;

-- 2. Melihat Daftar Semua Riwayat Snapshot Terakhir (10 Terakhir)
SELECT 
    id,
    run_id,
    scraped_at,
    summary->'total_current_power_kw' as power_kw
FROM public.monitoring_snapshots
ORDER BY scraped_at DESC
LIMIT 10;

-- 3. Melihat Ringkasan Produksi Harian per Stasiun (7 Hari Terakhir)
SELECT 
    bucket_date,
    platform,
    station_name,
    energy_kwh,
    revenue_amount,
    currency
FROM public.monitoring_site_daily
ORDER BY bucket_date DESC, station_name ASC
LIMIT 30;

-- 4. Melihat Data Produksi per Jam Stasiun Tertentu (Contoh: SDN 09 JAKUT hari ini)
SELECT 
    bucket_hour,
    station_name,
    current_power_kw,
    daily_energy_kwh
FROM public.monitoring_site_hourly
WHERE station_name ILIKE '%SDN 09%'
ORDER BY bucket_hour DESC
LIMIT 24;

-- 5. Melihat Daftar User/Operator yang Terdaftar di Supabase Auth
SELECT 
    id,
    email,
    created_at,
    last_sign_in_at,
    confirmed_at
FROM auth.users
ORDER BY created_at DESC;