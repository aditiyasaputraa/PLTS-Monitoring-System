import React, { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { getStationTariff } from "./tariffs.js";

const ID_MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

const ASSET_OWNER_PRESETS = [
  "Sudin Nakertransgi Jakarta Utara",
  "Sudin Nakertransgi Jakarta Barat",
  "Sudin Nakertransgi Jakarta Pusat",
  "Sudin Nakertransgi Jakarta Timur",
  "Sudin Nakertransgi Jakarta Selatan",
  "Dinas Tenaga Kerja, Transmigrasi dan Energi DKI Jakarta",
  "Dinas Pendidikan DKI Jakarta",
  "Biro Umum & ASD Setda DKI Jakarta",
  "Dinas Kesehatan DKI Jakarta",
  "Dinas Lingkungan Hidup DKI Jakarta",
];

function getStationOnlineStatus(st) {
  const powerVal = Number(st?.current_power_kw ?? st?.output_power_kw ?? st?.pv_power_kw ?? st?.power_kw ?? 0);
  const dailyVal = Number(st?.daily_energy_kwh ?? st?.today_energy_kwh ?? st?.today_kwh ?? 0);
  const isOffline = st?.status === "offline" || st?.status === "disconnected" || (powerVal === 0 && dailyVal === 0);
  return isOffline ? "Offline" : "Online";
}

export function downloadExcelWorkbook(filename, sheets = []) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ sheetName, rows, colWidths, merges }) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (colWidths && Array.isArray(colWidths)) {
      ws["!cols"] = colWidths;
    }
    if (merges && Array.isArray(merges) && merges.length > 0) {
      ws["!merges"] = merges;
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

export function downloadExcel(filename, rows, sheetName = "Data PLTS", colWidths = null, merges = null) {
  downloadExcelWorkbook(filename, [{ sheetName, rows, colWidths, merges }]);
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

function buildMetricSheetRows(
  metricType,
  targetList,
  yr,
  monthIndices,
  getStationMonthlyValuesFn,
  getStationRegionFn,
  headerConfig = {}
) {
  const monthHeaders = monthIndices.map((mIdx) => ID_MONTH_NAMES[mIdx]);
  const headers = ["No", "Nama PLTS", ...monthHeaders, "Total"];
  const lastColIdx = headers.length - 1;

  const rows = [];
  const merges = [];
  const titleText = String(headerConfig?.customTitle || "").trim();
  const notesText = String(headerConfig?.customNotes || "").trim();

  if (titleText) {
    merges.push({ s: { r: rows.length, c: 0 }, e: { r: rows.length, c: lastColIdx } });
    rows.push([titleText]);
  }

  if (notesText) {
    const noteLines = notesText.split(/\r?\n/);
    noteLines.forEach((line) => {
      merges.push({ s: { r: rows.length, c: 0 }, e: { r: rows.length, c: lastColIdx } });
      rows.push([line]);
    });
  }

  if (titleText || notesText) {
    rows.push([]); // Baris kosong pemisah sebelum tabel
  }

  rows.push(headers);
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
      } else if (metricType === "energy") {
        val = Number(val.toFixed(3));
      } else {
        val = Math.round(val * 10) / 10;
      }
      rowTotal += val;
      colTotals[cIdx] += val;
      return val;
    });

    if (metricType === "revenue") {
      rowTotal = Math.round(rowTotal);
    } else if (metricType === "energy") {
      rowTotal = Number(rowTotal.toFixed(3));
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
    if (metricType === "revenue") return Math.round(tot);
    if (metricType === "energy") return Number(tot.toFixed(3));
    return Math.round(tot * 10) / 10;
  });
  const formattedGrandTotal =
    metricType === "revenue"
      ? Math.round(grandTotal)
      : metricType === "energy"
      ? Number(grandTotal.toFixed(3))
      : Math.round(grandTotal * 10) / 10;

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

  return { rows, colWidths, merges };
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
  const [selectedMonths, setSelectedMonths] = useState([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(1);

  const toggleMonth = (mIdx) => {
    setSelectedMonths((prev) => {
      if (prev.includes(mIdx)) {
        if (prev.length === 1) return prev;
        return prev.filter((m) => m !== mIdx);
      } else {
        return [...prev, mIdx].sort((a, b) => a - b);
      }
    });
  };

  const handleSelectAll = () => setSelectedMonths([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const handleSelectTw = (twNum) => {
    if (twNum === 1) setSelectedMonths([0, 1, 2]);
    else if (twNum === 2) setSelectedMonths([3, 4, 5]);
    else if (twNum === 3) setSelectedMonths([6, 7, 8]);
    else if (twNum === 4) setSelectedMonths([9, 10, 11]);
  };
  const handleSelectSemester = (semNum) => {
    if (semNum === 1) setSelectedMonths([0, 1, 2, 3, 4, 5]);
    else if (semNum === 2) setSelectedMonths([6, 7, 8, 9, 10, 11]);
  };
  const handleApplyRange = () => {
    const s = Math.min(Number(rangeStart), Number(rangeEnd));
    const e = Math.max(Number(rangeStart), Number(rangeEnd));
    const arr = [];
    for (let i = s; i <= e; i++) arr.push(i);
    setSelectedMonths(arr);
  };
  const [includeEnergy, setIncludeEnergy] = useState(true);
  const [includeRevenue, setIncludeRevenue] = useState(true);
  const [includeEmission, setIncludeEmission] = useState(true);
  const [selectedAsset, setSelectedAsset] = useState("all");
  const [selectedVendor, setSelectedVendor] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [customTitle, setCustomTitle] = useState("");
  const [customNotes, setCustomNotes] = useState("");
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

  const assetOptions = useMemo(() => {
    const counts = {};
    let unassignedCount = 0;
    availableStations.forEach((st) => {
      const owner = (st.asset_owner || "").trim();
      if (owner) {
        counts[owner] = (counts[owner] || 0) + 1;
      } else {
        unassignedCount += 1;
      }
    });
    ASSET_OWNER_PRESETS.forEach((p) => {
      if (!(p in counts)) counts[p] = 0;
    });
    return {
      entries: Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
      unassignedCount,
    };
  }, [availableStations]);

  const filteredAllStations = useMemo(() => {
    return availableStations.filter((st) => {
      if (selectedAsset !== "all") {
        const owner = (st.asset_owner || "").trim();
        if (selectedAsset === "__unassigned__") {
          if (owner !== "") return false;
        } else if (owner !== selectedAsset) {
          return false;
        }
      }
      if (selectedVendor !== "all") {
        const v = String(st.source || st.site?.platform || "SMA").toUpperCase();
        if (v !== selectedVendor) return false;
      }
      if (selectedStatus !== "all") {
        const stStatus = getStationOnlineStatus(st).toLowerCase();
        if (stStatus !== selectedStatus.toLowerCase()) return false;
      }
      return true;
    });
  }, [availableStations, selectedAsset, selectedVendor, selectedStatus]);

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
        : filteredAllStations;

      if (targetList.length === 0) {
        alert("Tidak ada stasiun PLTS yang sesuai dengan filter untuk diexport.");
        setIsExporting(false);
        return;
      }

      // Determine which month indices to export
      const monthIndices = [...selectedMonths].sort((a, b) => a - b);
      if (monthIndices.length === 0) {
        alert("Pilih setidaknya satu bulan untuk diekspor.");
        setIsExporting(false);
        return;
      }

      if (!includeEnergy && !includeRevenue && !includeEmission) {
        alert("Pilih setidaknya satu parameter metrik (Energi, Penghematan, atau Emisi).");
        setIsExporting(false);
        return;
      }

      const headerConfig = { customTitle, customNotes };
      const sheets = [];
      if (includeEnergy) {
        const energyData = buildMetricSheetRows("energy", targetList, yr, monthIndices, getStationMonthlyValuesFn, getStationRegionFn, headerConfig);
        sheets.push({ sheetName: "Produksi Energi (kWh)", ...energyData });
      }
      if (includeRevenue) {
        const revData = buildMetricSheetRows("revenue", targetList, yr, monthIndices, getStationMonthlyValuesFn, getStationRegionFn, headerConfig);
        sheets.push({ sheetName: "Penghematan Biaya (Rp)", ...revData });
      }
      if (includeEmission) {
        const emData = buildMetricSheetRows("emission", targetList, yr, monthIndices, getStationMonthlyValuesFn, getStationRegionFn, headerConfig);
        sheets.push({ sheetName: "Reduksi Emisi (kg CO2)", ...emData });
      }

      // Filename construction
      const safeScope = targetScope === "single"
        ? (targetList[0]?.name || "Gedung").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30)
        : currentRegionName.replace(/\s+/g, "_");

      let periodLabel = "";
      if (monthIndices.length === 12) {
        periodLabel = "1-Tahun-Penuh";
      } else if (monthIndices.length === 3 && [0, 1, 2].every((m) => monthIndices.includes(m))) {
        periodLabel = "TW1";
      } else if (monthIndices.length === 3 && [3, 4, 5].every((m) => monthIndices.includes(m))) {
        periodLabel = "TW2";
      } else if (monthIndices.length === 3 && [6, 7, 8].every((m) => monthIndices.includes(m))) {
        periodLabel = "TW3";
      } else if (monthIndices.length === 3 && [9, 10, 11].every((m) => monthIndices.includes(m))) {
        periodLabel = "TW4";
      } else if (monthIndices.length === 1) {
        periodLabel = `Bulan_${ID_MONTH_NAMES[monthIndices[0]]}`;
      } else {
        const firstMonth = ID_MONTH_NAMES[monthIndices[0]];
        const lastMonth = ID_MONTH_NAMES[monthIndices[monthIndices.length - 1]];
        if (monthIndices.length === (monthIndices[monthIndices.length - 1] - monthIndices[0] + 1)) {
          periodLabel = `${firstMonth}-${lastMonth}`;
        } else {
          periodLabel = `${monthIndices.length}_Bulan_Pilihan`;
        }
      }
      const filename = `Kinerja_PLTS_${safeScope}_${yr}_${periodLabel}.xlsx`;

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
                🏢 Semua PLTS ({filteredAllStations.length} Gedung)
              </button>
              <button
                type="button"
                className={`export-pill-btn ${targetScope === "single" ? "active" : ""}`}
                onClick={() => setTargetScope("single")}
              >
                📍 Pilih Gedung Spesifik
              </button>
            </div>

            {targetScope === "all" && (
              <div
                style={{
                  marginTop: "10px",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: "8px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                      Filter Pemilik Aset
                    </label>
                    <select
                      className="export-select-input"
                      value={selectedAsset}
                      onChange={(e) => setSelectedAsset(e.target.value)}
                      style={{ fontSize: "12px", padding: "6px 8px" }}
                    >
                      <option value="all">Semua Aset ({availableStations.length})</option>
                      {assetOptions.entries.map(([ownerName, count]) => (
                        <option key={ownerName} value={ownerName}>
                          {ownerName} ({count})
                        </option>
                      ))}
                      {assetOptions.unassignedCount > 0 && (
                        <option value="__unassigned__">
                          Belum Diatur ({assetOptions.unassignedCount})
                        </option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                      Filter Vendor
                    </label>
                    <select
                      className="export-select-input"
                      value={selectedVendor}
                      onChange={(e) => setSelectedVendor(e.target.value)}
                      style={{ fontSize: "12px", padding: "6px 8px" }}
                    >
                      <option value="all">Semua Vendor</option>
                      <option value="HUAWEI">Huawei</option>
                      <option value="KEHUA">Kehua</option>
                      <option value="SMA">SMA</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                      Filter Status
                    </label>
                    <select
                      className="export-select-input"
                      value={selectedStatus}
                      onChange={(e) => setSelectedStatus(e.target.value)}
                      style={{ fontSize: "12px", padding: "6px 8px" }}
                    >
                      <option value="all">Semua Status</option>
                      <option value="online">🟢 Online</option>
                      <option value="offline">🔴 Offline</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

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

          {/* Section 2: Tahun & Pilihan Rentang Cepat */}
          <div style={{ display: "flex", gap: "12px", marginTop: "14px" }}>
            <div className="export-form-group" style={{ flex: "0 0 130px" }}>
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

            {/* Quick Range Helper */}
            <div className="export-form-group" style={{ flex: 1 }}>
              <label className="export-label">Rentang Cepat (Bulan s/d Bulan)</label>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <select
                  className="export-select-input"
                  style={{ flex: 1 }}
                  value={rangeStart}
                  onChange={(e) => setRangeStart(Number(e.target.value))}
                >
                  {ID_MONTH_NAMES.map((name, idx) => (
                    <option key={idx} value={idx}>
                      {name}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>s/d</span>
                <select
                  className="export-select-input"
                  style={{ flex: 1 }}
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(Number(e.target.value))}
                >
                  {ID_MONTH_NAMES.map((name, idx) => (
                    <option key={idx} value={idx}>
                      {name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="export-pill-btn"
                  style={{ flex: "0 0 auto", padding: "7px 12px", background: "#f0fdf4", borderColor: "#86efac", color: "#166534" }}
                  onClick={handleApplyRange}
                  title="Terapkan rentang bulan ini ke pilihan di bawah"
                >
                  Terapkan
                </button>
              </div>
            </div>
          </div>

          {/* Section 3: Pilihan Bulan Interaktif (Bebas pilih 2 bulan, 4 bulan, dsb) */}
          <div className="export-form-group" style={{ marginTop: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <label className="export-label">3. Pilih Bulan yang Ingin Diambil</label>
              <span className="export-selected-summary">
                ✓ {selectedMonths.length} bulan terpilih
              </span>
            </div>

            {/* Presets */}
            <div className="export-month-presets">
              <button
                type="button"
                className={`export-preset-pill ${selectedMonths.length === 12 ? "active" : ""}`}
                onClick={handleSelectAll}
              >
                Semua (12 Bulan)
              </button>
              <button
                type="button"
                className={`export-preset-pill ${selectedMonths.length === 3 && [0, 1, 2].every((m) => selectedMonths.includes(m)) ? "active" : ""}`}
                onClick={() => handleSelectTw(1)}
              >
                TW 1 (Jan-Mar)
              </button>
              <button
                type="button"
                className={`export-preset-pill ${selectedMonths.length === 3 && [3, 4, 5].every((m) => selectedMonths.includes(m)) ? "active" : ""}`}
                onClick={() => handleSelectTw(2)}
              >
                TW 2 (Apr-Jun)
              </button>
              <button
                type="button"
                className={`export-preset-pill ${selectedMonths.length === 3 && [6, 7, 8].every((m) => selectedMonths.includes(m)) ? "active" : ""}`}
                onClick={() => handleSelectTw(3)}
              >
                TW 3 (Jul-Sep)
              </button>
              <button
                type="button"
                className={`export-preset-pill ${selectedMonths.length === 3 && [9, 10, 11].every((m) => selectedMonths.includes(m)) ? "active" : ""}`}
                onClick={() => handleSelectTw(4)}
              >
                TW 4 (Okt-Des)
              </button>
              <button
                type="button"
                className={`export-preset-pill ${selectedMonths.length === 6 && [0, 1, 2, 3, 4, 5].every((m) => selectedMonths.includes(m)) ? "active" : ""}`}
                onClick={() => handleSelectSemester(1)}
              >
                Semester 1
              </button>
              <button
                type="button"
                className={`export-preset-pill ${selectedMonths.length === 6 && [6, 7, 8, 9, 10, 11].every((m) => selectedMonths.includes(m)) ? "active" : ""}`}
                onClick={() => handleSelectSemester(2)}
              >
                Semester 2
              </button>
            </div>

            {/* 12-Month Toggle Grid */}
            <div className="export-month-grid">
              {ID_MONTH_NAMES.map((mName, idx) => {
                const isSelected = selectedMonths.includes(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    className={`export-month-pill ${isSelected ? "active" : ""}`}
                    onClick={() => toggleMonth(idx)}
                    title={`Klik untuk ${isSelected ? "membatalkan" : "memilih"} bulan ${mName}`}
                  >
                    <span style={{ fontSize: "11px" }}>{isSelected ? "✓" : "○"}</span>
                    <span>{mName}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: "6px", fontSize: "11px", color: "#64748b" }}>
              💡 <em>Tips: Klik tombol bulan di atas untuk memilih/menghapus bulan sesuka Anda (misal: hanya Januari & Februari, atau 4 bulan).</em>
            </div>
          </div>

          {/* Section 4: Pilihan Kolom Metrik */}
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

          {/* Section 5: Judul & Isi Keterangan Manual di Atas Tabel */}
          <div
            className="export-form-group"
            style={{
              marginTop: "16px",
              padding: "12px",
              borderRadius: "10px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div>
              <label className="export-label" style={{ marginBottom: "4px" }}>
                5. Judul di Atas Tabel (Opsional — Ketik Manual)
              </label>
              <input
                type="text"
                className="export-select-input"
                placeholder="Contoh: LAPORAN KINERJA PRODUKSI ENERGI PLTS DINAS PENDIDIKAN"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
              />
            </div>

            <div>
              <label className="export-label" style={{ marginBottom: "4px" }}>
                Isi / Keterangan Tambahan di Atas Tabel (Opsional — Bisa Beberapa Baris)
              </label>
              <textarea
                className="export-select-input"
                rows={2}
                placeholder="Contoh: Periode Laporan Tahun 2026 (tekan Enter untuk baris baru)"
                value={customNotes}
                onChange={(e) => setCustomNotes(e.target.value)}
                style={{ resize: "vertical", fontFamily: "inherit", lineHeight: 1.45 }}
              />
              <div style={{ marginTop: "4px", fontSize: "11px", color: "#64748b" }}>
                Teks yang diketik akan ditaruh pada baris paling atas sebelum tabel di setiap sheet Excel. Kosongkan jika ingin langsung tabel.
              </div>
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
