import test from "node:test";
import assert from "node:assert/strict";
import {
  REGIONAL_ACCOUNTS,
  authenticateLocalAccount,
  canUserEditStation,
  canUserEditCategoryTariff,
} from "./auth_roles.js";

test("authenticates all 5 regional accounts and super admin", () => {
  // 1. Jakarta Pusat
  const pusat = authenticateLocalAccount("admin.pusat", "adminpusat123");
  assert.ok(pusat);
  assert.equal(pusat.region, "jakpus");
  assert.equal(pusat.role, "regional_admin");

  // 2. Jakarta Utara
  const utara = authenticateLocalAccount("admin.utara@jakarta.go.id", "adminutara123");
  assert.ok(utara);
  assert.equal(utara.region, "jakut");
  assert.equal(pusat.role, "regional_admin");

  // 3. Jakarta Barat
  const barat = authenticateLocalAccount("admin.barat", "adminbarat123");
  assert.ok(barat);
  assert.equal(barat.region, "jakbar");

  // 4. Jakarta Selatan
  const selatan = authenticateLocalAccount("admin.selatan", "adminselatan123");
  assert.ok(selatan);
  assert.equal(selatan.region, "jaksel");

  // 5. Jakarta Timur
  const timur = authenticateLocalAccount("admin.timur", "admintimur123");
  assert.ok(timur);
  assert.equal(timur.region, "jaktim");

  // Super Admin
  const superAdmin = authenticateLocalAccount("admin", "admin123");
  assert.ok(superAdmin);
  assert.equal(superAdmin.region, "all");
  assert.equal(superAdmin.role, "super_admin");
});

test("enforces scoped editing permissions per region", () => {
  const adminBarat = authenticateLocalAccount("admin.barat", "adminbarat123");
  const adminUtara = authenticateLocalAccount("admin.utara", "adminutara123");
  const superAdmin = authenticateLocalAccount("admin", "admin123");

  const stationJakbar = { name: "SMPN 190 JAKBAR", region: "jakbar" };
  const stationJakut = { name: "GOR Sekda Saefullah", region: "jakut" };
  const getRegion = (st) => st.region;

  // Admin Barat can edit Jakbar station, but NOT Jakut station
  assert.equal(canUserEditStation(adminBarat, stationJakbar, getRegion), true);
  assert.equal(canUserEditStation(adminBarat, stationJakut, getRegion), false);

  // Admin Utara can edit Jakut station, but NOT Jakbar station
  assert.equal(canUserEditStation(adminUtara, stationJakut, getRegion), true);
  assert.equal(canUserEditStation(adminUtara, stationJakbar, getRegion), false);

  // Super Admin can edit any station
  assert.equal(canUserEditStation(superAdmin, stationJakbar, getRegion), true);
  assert.equal(canUserEditStation(superAdmin, stationJakut, getRegion), true);
});

test("restricts category global tariff edits to super admin", () => {
  const adminBarat = authenticateLocalAccount("admin.barat", "adminbarat123");
  const superAdmin = authenticateLocalAccount("admin", "admin123");

  assert.equal(canUserEditCategoryTariff(adminBarat), false);
  assert.equal(canUserEditCategoryTariff(superAdmin), true);
});
