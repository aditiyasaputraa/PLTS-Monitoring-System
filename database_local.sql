-- ===================================================
-- Skema Database MySQL Lokal untuk Monitoring PLTS
-- Dibuat untuk Laragon (MySQL / phpMyAdmin)
-- Database Name: db_monitoring_plts
-- ===================================================

CREATE DATABASE IF NOT EXISTS db_monitoring_plts 
CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE db_monitoring_plts;

-- 1. Tabel Daftar Lokasi / Stasiun PLTS (Mendukung Multi-Lokasi)
CREATE TABLE IF NOT EXISTS plts_locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    uid VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    platform VARCHAR(50) NOT NULL DEFAULT 'huawei', -- 'huawei', 'kehua', etc.
    station_id VARCHAR(64) NOT NULL,
    capacity_kwp DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    current_power_kw DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(20) NOT NULL DEFAULT 'normal', -- 'normal', 'offline', 'alarm'
    daily_energy_kwh DECIMAL(12, 2) DEFAULT 0.00,
    monthly_energy_kwh DECIMAL(12, 2) DEFAULT 0.00,
    yearly_energy_kwh DECIMAL(12, 2) DEFAULT 0.00,
    cumulative_energy_kwh DECIMAL(12, 2) DEFAULT 0.00,
    daily_income DECIMAL(15, 2) DEFAULT 0.00,
    monthly_income DECIMAL(15, 2) DEFAULT 0.00,
    yearly_income DECIMAL(15, 2) DEFAULT 0.00,
    cumulative_income DECIMAL(15, 2) DEFAULT 0.00,
    address TEXT NULL,
    latitude DECIMAL(10, 6) NULL,
    longitude DECIMAL(10, 6) NULL,
    is_custom TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_station_id (station_id),
    INDEX idx_platform (platform)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Tabel Snapshot / Histori Produksi Daya Realtime (Per 5 / 15 Menit)
CREATE TABLE IF NOT EXISTS monitoring_snapshots (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    location_uid VARCHAR(64) NOT NULL,
    power_kw DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    daily_energy_kwh DECIMAL(12, 2) DEFAULT 0.00,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_location_recorded (location_uid, recorded_at),
    CONSTRAINT fk_snapshot_location FOREIGN KEY (location_uid) 
        REFERENCES plts_locations(uid) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Tabel Rekapitulasi Harian (Daily Energy & Revenue)
CREATE TABLE IF NOT EXISTS monitoring_daily_records (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    location_uid VARCHAR(64) NOT NULL,
    record_date DATE NOT NULL,
    energy_kwh DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    income_amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(10) DEFAULT 'IDR',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_loc_date (location_uid, record_date),
    CONSTRAINT fk_daily_location FOREIGN KEY (location_uid) 
        REFERENCES plts_locations(uid) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Tabel Pengguna / Operator Dashboard
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NULL,
    role VARCHAR(20) DEFAULT 'operator', -- 'admin', 'operator'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Akun Default Operator
INSERT INTO users (username, password_hash, full_name, email, role)
VALUES ('admin', 'admin123', 'Administrator PLTS', 'admin@plts.pnj.ac.id', 'admin')
ON DUPLICATE KEY UPDATE username = VALUES(username);
