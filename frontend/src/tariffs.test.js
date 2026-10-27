import test from "node:test";
import assert from "node:assert/strict";
import {
  detectStationCategory,
  getStationTariff,
  DEFAULT_TARIFF_CATEGORIES,
} from "./tariffs.js";

test("detects building categories correctly from name", () => {
  assert.equal(detectStationCategory("SDN 09 JAKUT"), "school");
  assert.equal(detectStationCategory("SMPN 51 Jakarta"), "school");
  assert.equal(detectStationCategory("SMAN 75 Jakarta Utara"), "school");
  assert.equal(detectStationCategory("SMKN 29 Jakarta Selatan"), "school");
  assert.equal(detectStationCategory("PPKD Jakarta Barat"), "school");

  assert.equal(detectStationCategory("Kantor Dinas PMPTSP"), "government");
  assert.equal(detectStationCategory("Kantor Camat Duren Sawit"), "government");
  assert.equal(detectStationCategory("Kantor Lurah Petojo Selatan"), "government");
  assert.equal(detectStationCategory("Suku Dinas Sosial Jakarta Timur"), "government");

  assert.equal(detectStationCategory("RSUD Tanjung Priok"), "health");
  assert.equal(detectStationCategory("Puskesmas Kemayoran"), "health");
  assert.equal(detectStationCategory("Labkesda DKI Jakarta"), "health");

  assert.equal(detectStationCategory("GOR Sekda Saefullah"), "public_facility");
  assert.equal(detectStationCategory("GOR Cilandak"), "public_facility");
  assert.equal(detectStationCategory("PPOP RAGUNAN"), "public_facility");
  assert.equal(detectStationCategory("Dinas Pertamanan Hutan Kota"), "government");
  assert.equal(detectStationCategory("Jakarta Islamic Center"), "public_facility");
});

test("returns correct default tariffs per category", () => {
  const schoolStation = { name: "SMPN 190 JAKBAR", uid: "sma-1" };
  const govStation = { name: "Kantor Dinas PMPTSP", uid: "huawei-2" };
  const healthStation = { name: "RSUD Tanjung Priok", uid: "kehua-3" };
  const gorStation = { name: "GOR Sekda Saefullah", uid: "huawei-4" };

  assert.equal(getStationTariff(schoolStation), 900);
  assert.equal(getStationTariff(govStation), 1444.7);
  assert.equal(getStationTariff(healthStation), 1114.74);
  assert.equal(getStationTariff(gorStation), 1444.7);
});

test("respects category rate adjustments and custom per-station overrides", () => {
  const config = {
    categoryRates: {
      school: 950,
      government: 1699.53,
      health: 1200,
      public_facility: 1500,
      other: 1500,
    },
    customRates: {
      "huawei-4": 1800, // custom override for GOR Sekda Saefullah
    },
  };

  const schoolStation = { name: "SMPN 190 JAKBAR", uid: "sma-1" };
  const govStation = { name: "Kantor Dinas PMPTSP", uid: "huawei-2" };
  const gorStation = { name: "GOR Sekda Saefullah", uid: "huawei-4" };

  assert.equal(getStationTariff(schoolStation, config), 950);
  assert.equal(getStationTariff(govStation, config), 1699.53);
  assert.equal(getStationTariff(gorStation, config), 1800);
});
