import test from "node:test";
import assert from "node:assert/strict";
import {
  REGIONAL_ACCOUNTS,
  authenticateLocalAccount,
  canUserEditStation,
  canUserEditCategoryTariff,
} from "./auth_roles.js";

// Setup dummy environment variables for test execution only (NO real passwords in git)
process.env.VITE_AUTH_ADMIN_PUSAT_PASS = "test_env_pass_pusat";
process.env.VITE_AUTH_ADMIN_UTARA_PASS = "test_env_pass_utara";
process.env.VITE_AUTH_ADMIN_BARAT_PASS = "test_env_pass_barat";
process.env.VITE_AUTH_ADMIN_SELATAN_PASS = "test_env_pass_selatan";
process.env.VITE_AUTH_ADMIN_TIMUR_PASS = "test_env_pass_timur";
process.env.VITE_AUTH_SUPERADMIN_PASS = "test_env_pass_superadmin";

test("authenticates all 5 regional accounts and super admin from environment variables", () => {
  // 1. Jakarta Pusat
  const pusat = authenticateLocalAccount("admin.pusat", "test_env_pass_pusat");
  assert.ok(pusat);
  assert.equal(pusat.region, "jakpus");
  assert.equal(pusat.role, "regional_admin");

  // 2. Jakarta Utara
  const utara = authenticateLocalAccount("admin.utara@jakarta.go.id", "test_env_pass_utara");
  assert.ok(utara);
  assert.equal(utara.region, "jakut");
  assert.equal(utara.role, "regional_admin");

  // 3. Jakarta Barat
  const barat = authenticateLocalAccount("admin.barat", "test_env_pass_barat");
  assert.ok(barat);
  assert.equal(barat.region, "jakbar");

  // 4. Jakarta Selatan
  const selatan = authenticateLocalAccount("admin.selatan", "test_env_pass_selatan");
  assert.ok(selatan);
  assert.equal(selatan.region, "jaksel");

  // 5. Jakarta Timur
  const timur = authenticateLocalAccount("admin.timur", "test_env_pass_timur");
  assert.ok(timur);
  assert.equal(timur.region, "jaktim");

  // Super Admin
  const superAdmin = authenticateLocalAccount("admin", "test_env_pass_superadmin");
  assert.ok(superAdmin);
  assert.equal(superAdmin.region, "all");
  assert.equal(superAdmin.role, "super_admin");
});

test("rejects invalid passwords or unknown users", () => {
  assert.equal(authenticateLocalAccount("admin.pusat", "wrongpass"), null);
  assert.equal(authenticateLocalAccount("admin.utara", "12345"), null);
  assert.equal(authenticateLocalAccount("random.user", "test_env_pass_superadmin"), null);
});

test("enforces scoped editing permissions per region", () => {
  const adminBarat = authenticateLocalAccount("admin.barat", "test_env_pass_barat");
  const adminUtara = authenticateLocalAccount("admin.utara", "test_env_pass_utara");
  const superAdmin = authenticateLocalAccount("admin", "test_env_pass_superadmin");

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
  const adminBarat = authenticateLocalAccount("admin.barat", "test_env_pass_barat");
  const superAdmin = authenticateLocalAccount("admin", "test_env_pass_superadmin");

  assert.equal(canUserEditCategoryTariff(adminBarat), false);
  assert.equal(canUserEditCategoryTariff(superAdmin), true);
});

test("restricts electricity tariffs (canUserEditTariffs) strictly to super admin", () => {
  const pusat = authenticateLocalAccount("admin.pusat", "test_env_pass_pusat");
  const utara = authenticateLocalAccount("admin.utara", "test_env_pass_utara");
  const barat = authenticateLocalAccount("admin.barat", "test_env_pass_barat");
  const selatan = authenticateLocalAccount("admin.selatan", "test_env_pass_selatan");
  const timur = authenticateLocalAccount("admin.timur", "test_env_pass_timur");
  const superAdmin = authenticateLocalAccount("admin", "test_env_pass_superadmin");

  // All 5 regional accounts must NOT be able to edit tariffs
  assert.equal(canUserEditCategoryTariff(pusat), false);
  assert.equal(canUserEditCategoryTariff(utara), false);
  assert.equal(canUserEditCategoryTariff(barat), false);
  assert.equal(canUserEditCategoryTariff(selatan), false);
  assert.equal(canUserEditCategoryTariff(timur), false);

  // Super Admin can edit tariffs
  assert.equal(canUserEditCategoryTariff(superAdmin), true);
});
