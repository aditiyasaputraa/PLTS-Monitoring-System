/**
 * Mock data for PLTS Monitoring Dashboard (Clean Slate / Siap Input)
 * Stasiun dummy dikosongkan agar siap diisi oleh akun vendor asli atau input manual.
 */

export const MOCK_MONITORING_DATA = {
  schema: "monitoring_current.v2",
  updated_at: new Date().toISOString(),
  by_site: {
    huawei: {
      platform: "huawei",
      overview: {
        capacity_kwp: 0,
        current_power_kw: 0,
        daily_energy_kwh: 0,
        monthly_energy_kwh: 0,
        yearly_energy_kwh: 0,
        cumulative_energy_kwh: 0,
        monthly_income: 0,
        yearly_income: 0,
        cumulative_income: 0,
      },
      stations: [],
    },
    kehua: {
      platform: "kehua",
      overview: {
        capacity_kwp: 0,
        current_power_kw: 0,
        daily_energy_kwh: 0,
        monthly_energy_kwh: 0,
        yearly_energy_kwh: 0,
        cumulative_energy_kwh: 0,
        monthly_income: 0,
        yearly_income: 0,
        cumulative_income: 0,
      },
      stations: [],
    },
  },
};
