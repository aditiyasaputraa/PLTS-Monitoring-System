import React, { useState, useMemo } from "react";
import { getStationTariff } from "./tariffs.js";

const ID_MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

export function downloadCsv(filename, rows) {
  // UTF-8 BOM so Microsoft Excel and spreadsheet tools open accents & Indonesian numbers properly
  const csvContent = "\uFEFF" + rows.map((e) => e.map((cell) => {
    let str = String(cell ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      str = `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }).join(",")).join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function ChartExportModal({
  isOpen,
  onClose,
  allStations = [],
  currentRegion = "all",
  currentRegionName = "DKI Jakarta",
  currentUser = null,
  getStationRegionFn = null,
  initialStationId = null,
  getStationMonthlyValuesFn,
}) {
  const currentYear = new Date().getFullYear();
  const [targetScope, setTargetScope] = useState(initialStationId ? "single" : "all"); // "all" | "single"
  const [selectedStationId, setSelectedStationId] = useState(initialStationId || "");
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedPeriod, setSelectedPeriod] = useState("year_monthly"); // "year_monthly" | "tw1" | "tw2" | "tw3" | "tw4" | "m_0" .. "m_11"
  const [includeEnergy, setIncludeEnergy] = useState(true);
  const [includeRevenue, setIncludeRevenue] = useState(true);
  const [includeEmission, setIncludeEmission] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // Filter stations based on user's region role if regional admin
  const userRole = currentUser?.role || currentUser?.user_metadata?.role;
  const userRegion = currentUser?.region || currentUser?.user_metadata?.region;
  const isRegionalAdmin = userRole === "regional_admin" && userRegion && userRegion !== "all";

  const availableStations = useMemo(() => {
    let list = allStations || [];
    if (isRegionalAdmin && getStationRegionFn) {
      list = list.filter((st) => getStationRegionFn(st) === userRegion);
    } else if (currentRegion !== "all" && getStationRegionFn) {
      list = list.filter((st) => getStationRegionFn(st) === currentRegion);
    }
    return [...list].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [allStations, isRegionalAdmin, userRegion, currentRegion, getStationRegionFn]);

  // Set default selected station if empty
  React.useEffect(() => {
    if (isOpen) {
      if (initialStationId && availableStations.some((s) => s.id === initialStationId)) {
        setTargetScope("single");
        setSelectedStationId(initialStationId);
      } else if (!selectedStationId && availableStations.length > 0) {
        setSelectedStationId(availableStations[0].id);
      }
    }
  }, [isOpen, initialStationId, availableStations, selectedStationId]);

  if (!isOpen) return null;

  const handleExport = () => {
    setIsExporting(true);
    try {
      const yr = Number(selectedYear) || currentYear;
      const targetList = targetScope === "single"
        ? availableStations.filter((s) => String(s.id) === String(selectedStationId))
        : availableStations;

      if (targetList.length === 0) {
        alert("Pilih setidaknya satu stasiun PLTS untuk diexport.");
        setIsExporting(false);
        return;
      }

      // Determine which month indices to export
      let monthIndices = [];
      let periodLabel = "";
      if (selectedPeriod === "year_monthly") {
        monthIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
        periodLabel = `1 Tahun Penuh ${yr}`;
      } else if (selectedPeriod === "tw1") {
        monthIndices = [0, 1, 2];
        periodLabel = `Triwulan 1 (Jan - Mar) ${yr}`;
      } else if (selectedPeriod === "tw2") {
        monthIndices = [3, 4, 5];
        periodLabel = `Triwulan 2 (Apr - Jun) ${yr}`;
      } else if (selectedPeriod === "tw3") {
        monthIndices = [6, 7, 8];
        periodLabel = `Triwulan 3 (Jul - Sep) ${yr}`;
      } else if (selectedPeriod === "tw4") {
        monthIndices = [9, 10, 11];
        periodLabel = `Triwulan 4 (Okt - Des) ${yr}`;
      } else if (selectedPeriod.startsWith("m_")) {
        const mIdx = parseInt(selectedPeriod.replace("m_", ""), 10);
        monthIndices = [mIdx];
        periodLabel = `Bulan ${ID_MONTH_NAMES[mIdx]} ${yr}`;
      }

      // Build CSV Headers
      const headers = [
        "Tahun",
        "Bulan",
        "No",
        "Nama Gedung / PLTS",
        "Pemilik Aset",
        "Wilayah",
        "Platform",
        "Kapasitas Terpasang (kWp)",
        "Tarif Listrik (Rp/kWh)",
      ];

      if (includeEnergy) headers.push("Produksi Energi (kWh)", "Produksi Energi (MWh)");
      if (includeRevenue) headers.push("Penghematan Listrik (Rp)");
      if (includeEmission) headers.push("Reduksi Emisi (kg CO2)", "Reduksi Emisi (Ton CO2)");

      const rows = [];

      // Metadata rows
      rows.push(["LAPORAN DATA KINERJA HISTORIS PRODUKSI PLTS"]);
      rows.push(["Pemerintah Provinsi DKI Jakarta - Dinas Tenaga Kerja, Transmigrasi dan Energi"]);
      rows.push([`Wilayah: ${currentRegionName} | Periode: ${periodLabel} | Waktu Unduh: ${new Date().toLocaleString("id-ID")}`]);
      rows.push([]);
      rows.push(headers);

      let grandTotalEnergyKwh = 0;
      let grandTotalRevenueRp = 0;
      let grandTotalEmissionKg = 0;

      // Populate data rows
      monthIndices.forEach((mIdx) => {
        const mName = ID_MONTH_NAMES[mIdx];
        let monthSubtotalEnergy = 0;
        let monthSubtotalRevenue = 0;
        let monthSubtotalEmission = 0;

        targetList.forEach((st, idx) => {
          const tariff = getStationTariff(st, null, (s) => (getStationRegionFn ? getStationRegionFn(s) : "all"));
          const region = getStationRegionFn ? getStationRegionFn(st) : (st.region || "");
          const platform = (st.source || st.site?.platform || "").toUpperCase();
          const capacity = Number(st.capacity_kwp || st.rated_capacity_kw || 0);

          let energyKwh = 0;
          let revenueRp = 0;
          let emissionKg = 0;

          if (getStationMonthlyValuesFn) {
            const eArr = getStationMonthlyValuesFn(st, yr, "energy", tariff);
            const rArr = getStationMonthlyValuesFn(st, yr, "revenue", tariff);
            const emArr = getStationMonthlyValuesFn(st, yr, "emission", tariff);
            energyKwh = Number(eArr?.[mIdx] || 0);
            revenueRp = Number(rArr?.[mIdx] || 0);
            emissionKg = Number(emArr?.[mIdx] || 0);
          } else {
            // Fallback estimation
            energyKwh = Number(st.monthly_energy_kwh || st.month_energy_kwh || 0);
            revenueRp = Math.round(energyKwh * tariff);
            emissionKg = Math.round(energyKwh * 0.85 * 10) / 10;
          }

          monthSubtotalEnergy += energyKwh;
          monthSubtotalRevenue += revenueRp;
          monthSubtotalEmission += emissionKg;

          const row = [
            yr,
            mName,
            idx + 1,
            st.name || st.raw_name || "Tanpa Nama",
            st.asset_owner || "-",
            st.regionName || region.toUpperCase(),
            platform || "PLTS",
            capacity > 0 ? capacity.toFixed(2) : "-",
            tariff,
          ];

          if (includeEnergy) {
            row.push(energyKwh.toFixed(1), (energyKwh / 1000).toFixed(3));
          }
          if (includeRevenue) {
            row.push(Math.round(revenueRp));
          }
          if (includeEmission) {
            row.push(emissionKg.toFixed(1), (emissionKg / 1000).toFixed(3));
          }

          rows.push(row);
        });

        grandTotalEnergyKwh += monthSubtotalEnergy;
        grandTotalRevenueRp += monthSubtotalRevenue;
        grandTotalEmissionKg += monthSubtotalEmission;

        // Subtotal row for month if multiple stations
        if (targetList.length > 1 && monthIndices.length > 1) {
          const subtotalRow = [
            yr,
            `${mName} (SUBTOTAL)`,
            "-",
            `Total Seluruh PLTS (${targetList.length} Stasiun)`,
            "-",
            currentRegionName,
            "-",
            "-",
            "-",
          ];
          if (includeEnergy) {
            subtotalRow.push(monthSubtotalEnergy.toFixed(1), (monthSubtotalEnergy / 1000).toFixed(3));
          }
          if (includeRevenue) {
            subtotalRow.push(Math.round(monthSubtotalRevenue));
          }
          if (includeEmission) {
            subtotalRow.push(monthSubtotalEmission.toFixed(1), (monthSubtotalEmission / 1000).toFixed(3));
          }
          rows.push(subtotalRow);
        }
      });

      // Grand Total Row
      rows.push([]);
      const grandTotalRow = [
        yr,
        "TOTAL KESELURUHAN",
        "-",
        targetScope === "single" ? (targetList[0]?.name || "PLTS") : `Total ${targetList.length} Stasiun PLTS`,
        "-",
        currentRegionName,
        "-",
        "-",
        "-",
      ];
      if (includeEnergy) {
        grandTotalRow.push(grandTotalEnergyKwh.toFixed(1), (grandTotalEnergyKwh / 1000).toFixed(3));
      }
      if (includeRevenue) {
        grandTotalRow.push(Math.round(grandTotalRevenueRp));
      }
      if (includeEmission) {
        grandTotalRow.push(grandTotalEmissionKg.toFixed(1), (grandTotalEmissionKg / 1000).toFixed(3));
      }
      rows.push(grandTotalRow);

      // Filename construction
      const safeScope = targetScope === "single"
        ? (targetList[0]?.name || "Gedung").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30)
        : currentRegionName.replace(/\s+/g, "_");
      const safePeriod = selectedPeriod.replace("_", "-");
      const filename = `Laporan_PLTS_${safeScope}_${yr}_${safePeriod}.csv`;

      downloadCsv(filename, rows);
      onClose();
    } catch (err) {
      console.error("Export error:", err);
      alert("Terjadi kesalahan saat mengekspor data: " + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="tariff-modal-backdrop" onClick={onClose}>
      <div
        className="tariff-modal-card export-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "560px" }}
      >
        {/* Header */}
        <div className="tariff-modal-header">
          <div className="tariff-modal-header-left">
            <span className="tariff-modal-icon-badge" style={{ background: "rgba(16, 185, 129, 0.15)", color: "#10b981" }}>
              📥
            </span>
            <div>
              <h2 className="tariff-modal-title">Export Data Historis PLTS</h2>
              <p className="tariff-modal-subtitle">
                Download laporan data kinerja bulanan & triwulan ke format Excel / CSV
              </p>
            </div>
          </div>
          <button type="button" className="tariff-modal-close-btn" onClick={onClose} title="Tutup">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="tariff-modal-body" style={{ padding: "20px 24px" }}>
          {/* Section 1: Pilih Cakupan PLTS */}
          <div className="export-form-group">
            <label className="export-label">1. Pilih Stasiun / Gedung PLTS</label>
            <div className="export-pill-options">
              <button
                type="button"
                className={`export-pill-btn ${targetScope === "all" ? "active" : ""}`}
                onClick={() => setTargetScope("all")}
              >
                🏢 Semua PLTS ({availableStations.length} Gedung)
              </button>
              <button
                type="button"
                className={`export-pill-btn ${targetScope === "single" ? "active" : ""}`}
                onClick={() => setTargetScope("single")}
              >
                📍 Pilih Gedung Spesifik
              </button>
            </div>

            {targetScope === "single" && (
              <div style={{ marginTop: "10px" }}>
                <select
                  className="export-select-input"
                  value={selectedStationId}
                  onChange={(e) => setSelectedStationId(e.target.value)}
                >
                  {availableStations.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name || st.raw_name} ({st.regionName || (getStationRegionFn ? getStationRegionFn(st)?.toUpperCase() : "")})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Section 2: Pilih Tahun & Periode */}
          <div className="export-form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: "12px", marginTop: "16px" }}>
            <div className="export-form-group">
              <label className="export-label">2. Pilih Tahun</label>
              <select
                className="export-select-input"
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
              >
                <option value={2026}>Tahun 2026</option>
                <option value={2025}>Tahun 2025</option>
                <option value={2024}>Tahun 2024</option>
                <option value={2023}>Tahun 2023</option>
              </select>
            </div>

            <div className="export-form-group">
              <label className="export-label">3. Rentang Waktu / Periode</label>
              <select
                className="export-select-input"
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
              >
                <optgroup label="Akumulasi & Tahunan">
                  <option value="year_monthly">📅 Semua Bulan (Januari - Desember)</option>
                </optgroup>
                <optgroup label="Per Triwulan">
                  <option value="tw1">🌱 TW 1 (Januari - Maret)</option>
                  <option value="tw2">☀️ TW 2 (April - Juni)</option>
                  <option value="tw3">🍂 TW 3 (Juli - September)</option>
                  <option value="tw4">❄️ TW 4 (Oktober - Desember)</option>
                </optgroup>
                <optgroup label="Per Bulan Spesifik">
                  {ID_MONTH_NAMES.map((mName, idx) => (
                    <option key={idx} value={`m_${idx}`}>
                      {mName}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>

          {/* Section 3: Pilihan Kolom Metrik */}
          <div className="export-form-group" style={{ marginTop: "16px" }}>
            <label className="export-label">4. Metrik Data yang Dimasukkan</label>
            <div className="export-checkbox-row">
              <label className="export-checkbox-label">
                <input
                  type="checkbox"
                  checked={includeEnergy}
                  onChange={(e) => setIncludeEnergy(e.target.checked)}
                />
                <span>⚡ Energi Listrik (kWh & MWh)</span>
              </label>
              <label className="export-checkbox-label">
                <input
                  type="checkbox"
                  checked={includeRevenue}
                  onChange={(e) => setIncludeRevenue(e.target.checked)}
                />
                <span>💰 Penghematan Biaya (IDR)</span>
              </label>
              <label className="export-checkbox-label">
                <input
                  type="checkbox"
                  checked={includeEmission}
                  onChange={(e) => setIncludeEmission(e.target.checked)}
                />
                <span>🌿 Reduksi Emisi (kg & Ton CO₂)</span>
              </label>
            </div>
          </div>

          {/* Info Box */}
          <div className="export-info-box">
            <span style={{ marginRight: "6px" }}>💡</span>
            <span>
              Format file adalah <strong>CSV (.csv)</strong> terkompatibilitas penuh dengan Microsoft Excel, Google Sheets, dan aplikasi spreadsheet pemerintah.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="tariff-modal-footer">
          <button type="button" className="btn-cancel-tariff" onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            className="btn-save-categories"
            style={{ background: "#059669" }}
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? "Menyiapkan File..." : "📥 Download File CSV / Excel"}
          </button>
        </div>
      </div>
    </div>
  );
}
