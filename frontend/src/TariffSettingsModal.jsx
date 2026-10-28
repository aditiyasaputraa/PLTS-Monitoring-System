import React, { useState, useMemo } from "react";
import {
  DEFAULT_TARIFF_CATEGORIES,
  detectStationCategory,
  getStationTariff,
} from "./tariffs.js";
import {
  canUserEditStation,
  canUserEditCategoryTariff,
} from "./auth_roles.js";

export default function TariffSettingsModal({
  isOpen,
  onClose,
  tariffConfig,
  onUpdateCategoryRate,
  onUpdateStationRate,
  onResetStationRate,
  onResetAllToDefaults,
  allStations = [],
  currentUser = null,
  getStationRegionFn = null,
}) {
  const isSuperAdmin = canUserEditCategoryTariff(currentUser);
  const userRegion = currentUser?.region || currentUser?.user_metadata?.region;
  const isRegionalAdmin = !isSuperAdmin && userRegion && userRegion !== "all";

  const [activeSubTab, setActiveSubTab] = useState(() => (isRegionalAdmin ? "station" : "category")); // "category" | "station"
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(() => (isRegionalAdmin ? "my_region" : "all"));
  const [toastMessage, setToastMessage] = useState(null);

  // Temporary local state for editing categories
  const [localCategories, setLocalCategories] = useState(() => ({
    school: tariffConfig?.categoryRates?.school ?? 900,
    government: tariffConfig?.categoryRates?.government ?? 1444.7,
    health: tariffConfig?.categoryRates?.health ?? 1114.74,
    public_facility: tariffConfig?.categoryRates?.public_facility ?? 1444.7,
    other: tariffConfig?.categoryRates?.other ?? 1444.7,
  }));

  // Keep localCategories in sync if tariffConfig changes
  React.useEffect(() => {
    if (tariffConfig?.categoryRates) {
      setLocalCategories({
        school: tariffConfig.categoryRates.school ?? 900,
        government: tariffConfig.categoryRates.government ?? 1444.7,
        health: tariffConfig.categoryRates.health ?? 1114.74,
        public_facility: tariffConfig.categoryRates.public_facility ?? 1444.7,
        other: tariffConfig.categoryRates.other ?? 1444.7,
      });
    }
  }, [tariffConfig]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleSaveCategories = () => {
    if (!isSuperAdmin) {
      alert("Akses Ditolak: Hanya Administrator Provinsi DKI Jakarta yang berwenang mengubah tarif listrik PLN.");
      return;
    }
    Object.entries(localCategories).forEach(([catId, val]) => {
      if (catId === "school") return; // Tetap 900
      onUpdateCategoryRate(catId, val);
    });
    showToast("Tarif kategori berhasil diperbarui & diterapkan!");
  };

  const handleResetDefaults = () => {
    if (!isSuperAdmin) {
      alert("Akses Ditolak: Hanya Administrator Provinsi DKI Jakarta yang berwenang mereset tarif listrik PLN.");
      return;
    }
    if (window.confirm("Kembalikan semua tarif kategori dan kustom stasiun ke standar default PLN?")) {
      onResetAllToDefaults();
      showToast("Semua tarif dikembalikan ke standar PLN.");
    }
  };

  // Filtered stations for Tab 2
  const filteredStations = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return allStations.filter((st) => {
      const name = st.name || st.station_name || "";
      const cat = detectStationCategory(name);
      const stReg = getStationRegionFn ? getStationRegionFn(st) : (st.region ? String(st.region).toLowerCase() : "");

      if (categoryFilter === "my_region") {
        if (stReg !== userRegion) return false;
      } else if (categoryFilter !== "all" && cat !== categoryFilter) {
        return false;
      }

      if (q && !name.toLowerCase().includes(q) && !(st.region || "").toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [allStations, searchQuery, categoryFilter, getStationRegionFn, userRegion]);

  const customCount = useMemo(() => {
    return Object.keys(tariffConfig?.customRates || {}).length;
  }, [tariffConfig]);

  if (!isOpen) return null;

  return (
    <div className="tariff-modal-backdrop" onClick={onClose}>
      <div className="tariff-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="tariff-modal-header">
          <div className="tariff-modal-header-left">
            <div className="tariff-modal-icon-badge">⚡</div>
            <div>
              <h2 className="tariff-modal-title">Pengaturan Tarif Listrik (Revenue)</h2>
              <p className="tariff-modal-subtitle">
                Atur tarif dasar PLN (Rp/kWh) per kategori gedung atau tentukan tarif khusus per stasiun PLTS.
              </p>
            </div>
          </div>
          <button className="tariff-modal-close-btn" onClick={onClose} title="Tutup">
            ✕
          </button>
        </div>

        {/* Toast alert */}
        {toastMessage && (
          <div className="tariff-modal-toast">
            <span>✓</span> {toastMessage}
          </div>
        )}

        {/* Sub-tabs navigation */}
        <div className="tariff-modal-tabs">
          <button
            className={`tariff-tab-btn ${activeSubTab === "category" ? "active" : ""}`}
            onClick={() => setActiveSubTab("category")}
          >
            <span>Tarif Kategori Gedung</span>
            <span className="tariff-tab-pill">{isSuperAdmin ? "Preset Default" : "Khusus Provinsi"}</span>
          </button>
          <button
            className={`tariff-tab-btn ${activeSubTab === "station" ? "active" : ""}`}
            onClick={() => setActiveSubTab("station")}
          >
            <span>Tarif Khusus per Gedung</span>
            {customCount > 0 && <span className="tariff-tab-pill active">{customCount} Khusus</span>}
          </button>
        </div>

        {/* Modal Body */}
        <div className="tariff-modal-body">
          {activeSubTab === "category" && (
            <div className="tariff-category-content">
              {!isSuperAdmin ? (
                <div className="tariff-info-notice" style={{ background: "#fffbeb", borderColor: "#fde68a", color: "#92400e" }}>
                  <span className="notice-icon">🔒</span>
                  <div>
                    <strong>Mode Hanya Lihat:</strong> Pengaturan tarif kategori global PLN hanya dapat diubah oleh Administrator Provinsi DKI Jakarta. Sebagai <strong>{currentUser?.user_metadata?.name || currentUser?.name || "Admin Wilayah"}</strong>, Anda dapat menyesuaikan tarif stasiun di wilayah Anda pada tab <strong>"Tarif Khusus per Gedung"</strong>.
                  </div>
                </div>
              ) : (
                <div className="tariff-info-notice">
                  <span className="notice-icon">ℹ️</span>
                  <div>
                    <strong>Informasi Golongan Tarif PLN:</strong> Setiap kelompok gedung memiliki tarif rekening listrik PLN yang berbeda. Tarif kategori sekolah dikunci tetap <strong>Rp 900/kWh</strong> (Tarif Sosial S-2/S-3), sedangkan gedung pemerintahan dan publik lainnya dapat disesuaikan.
                  </div>
                </div>
              )}

              <div className="tariff-category-grid">
                {Object.values(DEFAULT_TARIFF_CATEGORIES).map((cat) => {
                  const isLocked = Boolean(cat.isLocked || cat.id === "school" || !isSuperAdmin);
                  const currentVal = (cat.isLocked || cat.id === "school")
                    ? cat.defaultRate
                    : (localCategories[cat.id] ?? cat.defaultRate);
                  return (
                    <div key={cat.id} className={`tariff-category-card ${isLocked ? "card-locked" : ""}`}>
                      <div className="tariff-category-card-header">
                        <span className="cat-icon">{cat.icon}</span>
                        <div className="cat-info">
                          <span className="cat-name">{cat.name}</span>
                          <span className="cat-desc">{cat.description}</span>
                        </div>
                        {isLocked && (
                          <span className="cat-locked-badge" title="Terkunci">
                            {cat.id === "school" ? "🔒 Tetap" : "🔒 Khusus Provinsi"}
                          </span>
                        )}
                      </div>
                      <div className={`tariff-input-group ${isLocked ? "is-locked" : ""}`}>
                        <span className="tariff-input-prefix">Rp</span>
                        <input
                          type="number"
                          step="0.01"
                          min="1"
                          disabled={isLocked}
                          title={isLocked ? "Tarif tidak dapat diubah" : undefined}
                          className="tariff-number-input"
                          value={currentVal}
                          onChange={(e) => {
                            if (isLocked) return;
                            setLocalCategories({
                              ...localCategories,
                              [cat.id]: e.target.value === "" ? "" : Number(e.target.value),
                            });
                          }}
                        />
                        <span className="tariff-input-suffix">/ kWh</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {isSuperAdmin && (
                <div className="tariff-category-actions">
                  <button
                    type="button"
                    className="tariff-save-btn"
                    onClick={handleSaveCategories}
                  >
                    Simpan &amp; Terapkan Tarif Kategori
                  </button>
                </div>
              )}
            </div>
          )}

          {activeSubTab === "station" && (
            <div className="tariff-station-content">
              {isRegionalAdmin && (
                <div className="tariff-info-notice" style={{ background: "#f0fdf4", borderColor: "#bbf7d0", color: "#166534", marginBottom: "14px" }}>
                  <span className="notice-icon">🏢</span>
                  <div>
                    <strong>Admin {currentUser?.user_metadata?.regionName || "Wilayah"}:</strong> Anda memiliki izin untuk menyesuaikan tarif stasiun/gedung di wilayah tugas Anda. Gedung sekolah tetap terkunci <strong>Rp 900/kWh</strong> (Tarif Sosial PLN).
                  </div>
                </div>
              )}

              {/* Filter & Search Bar */}
              <div className="tariff-station-toolbar">
                <div className="tariff-search-wrap">
                  <span className="tariff-search-icon">🔍</span>
                  <input
                    type="text"
                    className="tariff-search-input"
                    placeholder="Cari gedung (contoh: RSUD, GOR, Saefullah, Camat)..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button
                      className="tariff-search-clear"
                      onClick={() => setSearchQuery("")}
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="tariff-filter-chips">
                  {isRegionalAdmin && (
                    <button
                      className={`tariff-chip ${categoryFilter === "my_region" ? "active" : ""}`}
                      onClick={() => setCategoryFilter("my_region")}
                      style={{
                        background: categoryFilter === "my_region" ? "#047857" : "#ecfdf5",
                        color: categoryFilter === "my_region" ? "#ffffff" : "#065f46",
                        borderColor: "#6ee7b7",
                        fontWeight: 700,
                      }}
                    >
                      ⭐ Wilayah Saya ({allStations.filter((st) => (getStationRegionFn ? getStationRegionFn(st) : (st.region ? String(st.region).toLowerCase() : "")) === userRegion).length})
                    </button>
                  )}
                  <button
                    className={`tariff-chip ${categoryFilter === "all" ? "active" : ""}`}
                    onClick={() => setCategoryFilter("all")}
                  >
                    Semua ({allStations.length})
                  </button>
                  <button
                    className={`tariff-chip ${categoryFilter === "school" ? "active" : ""}`}
                    onClick={() => setCategoryFilter("school")}
                  >
                    🏫 Sekolah (🔒 Tetap)
                  </button>
                  <button
                    className={`tariff-chip ${categoryFilter === "government" ? "active" : ""}`}
                    onClick={() => setCategoryFilter("government")}
                  >
                    🏛️ Pemerintah
                  </button>
                  <button
                    className={`tariff-chip ${categoryFilter === "health" ? "active" : ""}`}
                    onClick={() => setCategoryFilter("health")}
                  >
                    🏥 Kesehatan
                  </button>
                  <button
                    className={`tariff-chip ${categoryFilter === "public_facility" ? "active" : ""}`}
                    onClick={() => setCategoryFilter("public_facility")}
                  >
                    🏟️ GOR / Publik
                  </button>
                </div>
              </div>

              {/* Station List Table */}
              <div className="tariff-table-container">
                <table className="tariff-station-table">
                  <thead>
                    <tr>
                      <th style={{ width: "38%" }}>Nama Gedung / Stasiun</th>
                      <th style={{ width: "24%" }}>Kategori Terdeteksi</th>
                      <th style={{ width: "26%" }}>Tarif Aktif (Rp/kWh)</th>
                      <th style={{ width: "12%", textAlign: "center" }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStations.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="tariff-table-empty">
                          Tidak ditemukan gedung dengan pencarian "{searchQuery}"
                        </td>
                      </tr>
                    ) : (
                      filteredStations.map((st) => {
                        const name = st.name || st.station_name || "Stasiun";
                        const id = String(st.station_id || st.station_numeric_id || st.id || "");
                        const uid = st.uid || `${st.source || st.platform || ""}-${id}`;
                        const catKey = detectStationCategory(name);
                        const catDef = DEFAULT_TARIFF_CATEGORIES[catKey];
                        const isSchool = catKey === "school";
                        const isCustom = !isSchool && tariffConfig?.customRates?.[uid] !== undefined;
                        const currentRate = getStationTariff(st, tariffConfig);
                        const canEditStationRate = !isSchool && (isSuperAdmin || canUserEditStation(currentUser, st, getStationRegionFn));

                        return (
                          <tr key={uid} className={isCustom ? "custom-row" : (isSchool ? "school-row" : "")}>
                            <td>
                              <div className="station-name-cell">
                                <span className="station-title">{name}</span>
                                <span className="station-meta">
                                  {st.source ? st.source.toUpperCase() : "PLTS"} · {st.region || "DKI Jakarta"}
                                </span>
                              </div>
                            </td>
                            <td>
                              <span className={`cat-pill cat-${catKey}`}>
                                {catDef?.icon} {catDef?.name?.split("&")?.[0]?.trim() || catDef?.name}
                              </span>
                            </td>
                            <td>
                              <div className={`tariff-table-input-wrap ${!canEditStationRate ? "is-locked" : ""}`}>
                                <span className="prefix">Rp</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="1"
                                  disabled={!canEditStationRate}
                                  title={
                                    isSchool
                                      ? "Tarif sekolah dikunci tetap Rp 900/kWh (Tarif Sosial PLN)"
                                      : (!canEditStationRate
                                        ? `Terkunci: PLTS ini berada di ${st.region || "wilayah lain"}. Anda hanya dapat mengedit tarif stasiun di wilayah Anda.`
                                        : "Sesuaikan tarif listrik khusus untuk gedung ini")
                                  }
                                  className={`station-rate-input ${isCustom ? "is-custom" : ""}`}
                                  value={currentRate}
                                  onChange={(e) => {
                                    if (!canEditStationRate) return;
                                    const val = e.target.value === "" ? "" : Number(e.target.value);
                                    if (val) {
                                      onUpdateStationRate(uid, val);
                                    }
                                  }}
                                />
                                <span className="suffix">/kWh</span>
                              </div>
                            </td>
                            <td style={{ textAlign: "center" }}>
                              {isSchool ? (
                                <span className="tariff-locked-tag" title="Tarif sekolah dikunci tetap Rp 900/kWh">
                                  🔒 Tetap Rp 900
                                </span>
                              ) : !canEditStationRate ? (
                                <span
                                  className="tariff-locked-tag"
                                  style={{ background: "#f1f5f9", color: "#64748b", borderColor: "#cbd5e1" }}
                                  title={`Terkunci: Stasiun berada di ${st.region || "wilayah lain"}`}
                                >
                                  🔒 Khusus {st.region || "Wilayah Lain"}
                                </span>
                              ) : isCustom ? (
                                <button
                                  type="button"
                                  className="tariff-reset-btn"
                                  title="Kembalikan ke tarif kategori bawaan"
                                  onClick={() => {
                                    onResetStationRate(uid);
                                    showToast(`Tarif ${name} dikembalikan ke kategori.`);
                                  }}
                                >
                                  Reset
                                </button>
                              ) : (
                                <span className="tariff-auto-tag">Bawaan</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="tariff-modal-footer">
          {isSuperAdmin ? (
            <button
              type="button"
              className="tariff-btn-secondary"
              onClick={handleResetDefaults}
            >
              ↺ Kembalikan ke Standar PLN
            </button>
          ) : (
            <span style={{ fontSize: "12px", color: "#64748b" }}>
              👤 Login: <strong>{currentUser?.user_metadata?.name || currentUser?.name || "Admin Wilayah"}</strong>
            </span>
          )}
          <button
            type="button"
            className="tariff-btn-primary"
            onClick={onClose}
          >
            Selesai &amp; Tutup
          </button>
        </div>
      </div>
    </div>
  );
}
