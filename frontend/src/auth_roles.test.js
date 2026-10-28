import test from "node:test";
import assert from "node:assert/strict";
import {
  REGIONAL_ACCOUNTS,
  authenticateLocalAccount,
  canUserEditStation,
  canUserEditCategoryTariff,
} from "./auth_roles.js";

// Setup environment variables for test execution
process.env.VITE_AUTH_ADMIN_PUSAT_PASS = "JaksPV!Pusat#2026";
process.env.VITE_AUTH_ADMIN_UTARA_PASS = "JaksPV!Utara#2026";
process.env.VITE_AUTH_ADMIN_BARAT_PASS = "JaksPV!Barat#2026";
process.env.VITE_AUTH_ADMIN_SELATAN_PASS = "JaksPV!Selatan#2026";
process.env.VITE_AUTH_ADMIN_TIMUR_PASS = "JaksPV!Timur#2026";
process.env.VITE_AUTH_SUPERADMIN_PASS = "admin123";

test("authenticates all 5 regional accounts and super admin from environment variables", () => {
  // 1. Jakarta Pusat
  const pusat = authenticateLocalAccount("admin.pusat", "JaksPV!Pusat#2026");
  assert.ok(pusat);
  assert.equal(pusat.region, "jakpus");
  assert.equal(pusat.role, "regional_admin");

  // 2. Jakarta Utara
  const utara = authenticateLocalAccount("admin.utara@jakarta.go.id", "JaksPV!Utara#2026");
  assert.ok(utara);
  assert.equal(utara.region, "jakut");
  assert.equal(utara.role, "regional_admin");

  // 3. Jakarta Barat
  const barat = authenticateLocalAccount("admin.barat", "JaksPV!Barat#2026");
  assert.ok(barat);
  assert.equal(barat.region, "jakbar");

  // 4. Jakarta Selatan
  const selatan = authenticateLocalAccount("admin.selatan", "JaksPV!Selatan#2026");
  assert.ok(selatan);
  assert.equal(selatan.region, "jaksel");

  // 5. Jakarta Timur
  const timur = authenticateLocalAccount("admin.timur", "JaksPV!Timur#2026");
  assert.ok(timur);
  assert.equal(timur.region, "jaktim");

  // Super Admin
  const superAdmin = authenticateLocalAccount("admin", "admin123");
  assert.ok(superAdmin);
  assert.equal(superAdmin.region, "all");
  assert.equal(superAdmin.role, "super_admin");
});

test("rejects invalid passwords or unknown users", () => {
  assert.equal(authenticateLocalAccount("admin.pusat", "wrongpass"), null);
  assert.equal(authenticateLocalAccount("admin.utara", "12345"), null);
  assert.equal(authenticateLocalAccount("random.user", "admin123"), null);
});

test("enforces scoped editing permissions per region", () => {
  const adminBarat = authenticateLocalAccount("admin.barat", "JaksPV!Barat#2026");
  const adminUtara = authenticateLocalAccount("admin.utara", "JaksPV!Utara#2026");
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
  const adminBarat = authenticateLocalAccount("admin.barat", "JaksPV!Barat#2026");
  const superAdmin = authenticateLocalAccount("admin", "admin123");

  assert.equal(canUserEditCategoryTariff(adminBarat), false);
  assert.equal(canUserEditCategoryTariff(superAdmin), true);
});

test("restricts electricity tariffs (canUserEditTariffs) strictly to super admin", () => {
  const pusat = authenticateLocalAccount("admin.pusat", "JaksPV!Pusat#2026");
  const utara = authenticateLocalAccount("admin.utara", "JaksPV!Utara#2026");
  const barat = authenticateLocalAccount("admin.barat", "JaksPV!Barat#2026");
  const selatan = authenticateLocalAccount("admin.selatan", "JaksPV!Selatan#2026");
  const timur = authenticateLocalAccount("admin.timur", "JaksPV!Timur#2026");
  const superAdmin = authenticateLocalAccount("admin", "admin123");

  // All 5 regional accounts must NOT be able to edit tariffs
  assert.equal(canUserEditCategoryTariff(pusat), false);
  assert.equal(canUserEditCategoryTariff(utara), false);
  assert.equal(canUserEditCategoryTariff(barat), false);
  assert.equal(canUserEditCategoryTariff(selatan), false);
  assert.equal(canUserEditCategoryTariff(timur), false);

  // Super Admin can edit tariffs
  assert.equal(canUserEditCategoryTariff(superAdmin), true);
});
