import React, { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { getStationTariff } from "./tariffs.js";

const ID_MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

export function downloadExcelWorkbook(filename, sheets = []) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ sheetName, rows, colWidths }) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (colWidths && Array.isArray(colWidths)) {
      ws["!cols"] = colWidths;
    }
    const cleanName = (sheetName || "Sheet")
      .replace(/[\\/?*\[\]:]/g, "")
      .trim()
      .slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, cleanName);
  });
  const safeFilename = filename.endsWith(".xlsx") ? filename : `${filename.replace(/\.csv$/i, "")}.xlsx`;
  XLSX.writeFile(wb, safeFilename);
}

export function downloadExcel(filename, rows, sheetName = "Data PLTS", colWidths = null) {
  downloadExcelWorkbook(filename, [{ sheetName, rows, colWidths }]);
}

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

function buildMetricSheetRows(metricType, targetList, yr, monthIndices, getStationMonthlyValuesFn, getStationRegionFn) {
  const monthHeaders = monthIndices.map((mIdx) => ID_MONTH_NAMES[mIdx]);
  const headers = ["No", "Nama PLTS", ...monthHeaders, "Total"];

  const rows = [headers];
  const colTotals = Array(monthIndices.length).fill(0);
  let grandTotal = 0;

  targetList.forEach((st, idx) => {
    const name = st.custom_name || st.name || st.raw_name || `PLTS ${idx + 1}`;
    const tariff = getStationTariff(st, null, (s) => (getStationRegionFn ? getStationRegionFn(s) : "all"));

    let monthlyVals = Array(12).fill(0);
    if (getStationMonthlyValuesFn) {
      monthlyVals = getStationMonthlyValuesFn(st, yr, metricType, tariff) || Array(12).fill(0);
    } else {
      const baseMonthly = Number(st.monthly_energy_kwh || st.month_energy_kwh || 0);
      if (metricType === "revenue") {
        monthlyVals = Array(12).fill(Math.round(baseMonthly * tariff));
      } else if (metricType === "emission") {
        monthlyVals = Array(12).fill(Math.round(baseMonthly * 0.85 * 10) / 10);
      } else {
        monthlyVals = Array(12).fill(baseMonthly);
      }
    }

    let rowTotal = 0;
    const rowVals = monthIndices.map((mIdx, cIdx) => {
      let val = Number(monthlyVals[mIdx]) || 0;
      if (metricType === "revenue") {
        val = Math.round(val);
      } else {
        val = Math.round(val * 10) / 10;
      }
      rowTotal += val;
      colTotals[cIdx] += val;
      return val;
    });

    if (metricType === "revenue") {
      rowTotal = Math.round(rowTotal);
    } else {
      rowTotal = Math.round(rowTotal * 10) / 10;
    }
    grandTotal += rowTotal;

    rows.push([
      idx + 1,
      name,
      ...rowVals,
      rowTotal,
    ]);
  });

  const formattedColTotals = colTotals.map((tot) => {
    return metricType === "revenue" ? Math.round(tot) : Math.round(tot * 10) / 10;
  });
  const formattedGrandTotal = metricType === "revenue" ? Math.round(grandTotal) : Math.round(grandTotal * 10) / 10;

  rows.push([
    "",
    "TOTAL",
    ...formattedColTotals,
    formattedGrandTotal,
  ]);

  const colWidths = [
    { wch: 6 },
    { wch: 38 },
    ...monthIndices.map(() => ({ wch: 16 })),
    { wch: 18 },
  ];

  return { rows, colWidths };
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

      if (!includeEnergy && !includeRevenue && !includeEmission) {
        alert("Pilih setidaknya satu parameter metrik (Energi, Penghematan, atau Emisi).");
        setIsExporting(false);
        return;
      }

      const sheets = [];
      if (includeEnergy) {
        const energyData = buildMetricSheetRows("energy", targetList, yr, monthIndices, getStationMonthlyValuesFn, getStationRegionFn);
        sheets.push({ sheetName: "Produksi Energi (kWh)", ...energyData });
      }
      if (includeRevenue) {
        const revData = buildMetricSheetRows("revenue", targetList, yr, monthIndices, getStationMonthlyValuesFn, getStationRegionFn);
        sheets.push({ sheetName: "Penghematan Biaya (Rp)", ...revData });
      }
      if (includeEmission) {
        const emData = buildMetricSheetRows("emission", targetList, yr, monthIndices, getStationMonthlyValuesFn, getStationRegionFn);
        sheets.push({ sheetName: "Reduksi Emisi (kg CO2)", ...emData });
      }

      // Filename construction
      const safeScope = targetScope === "single"
        ? (targetList[0]?.name || "Gedung").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30)
        : currentRegionName.replace(/\s+/g, "_");
      const safePeriod = selectedPeriod.replace("_", "-");
      const filename = `Kinerja_PLTS_${safeScope}_${yr}_${safePeriod}.xlsx`;

      downloadExcelWorkbook(filename, sheets);
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
              Format file adalah <strong>Excel (.xlsx)</strong> siap pakai dan terformat rapi untuk Microsoft Excel, Google Sheets, dan aplikasi spreadsheet pemerintah.
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
            {isExporting ? "Menyiapkan File..." : "📥 Download File Excel (.xlsx)"}
          </button>
        </div>
      </div>
    </div>
  );
}
