import json
import os
import unittest
from unittest.mock import patch

from scrape_monitoring import (
    build_normalized_site,
    load_huawei_accounts_from_env,
    load_sma_accounts_from_env,
    load_kehua_accounts_from_env,
    merge_normalized_sites,
)


class MultiVendorAccountsTests(unittest.TestCase):
    def test_loads_huawei_secondary_and_json_accounts(self):
        additional = [{
            "name": "jakbar-huawei",
            "username": "third-huawei",
            "password": "third-password",
        }]
        with patch.dict(os.environ, {
            "HUAWEI_USERNAME": "primary-huawei",
            "HUAWEI_PASSWORD": "primary-password",
            "HUAWEI_USERNAME_2": "secondary-huawei",
            "HUAWEI_PASSWORD_2": "secondary-password",
            "HUAWEI_ACCOUNTS_JSON": json.dumps(additional),
        }, clear=True):
            accounts = load_huawei_accounts_from_env()

        self.assertEqual(len(accounts), 3)
        self.assertEqual(accounts[0]["username"], "primary-huawei")
        self.assertTrue(accounts[0]["use_shared_cookies"])
        self.assertEqual(accounts[1]["username"], "secondary-huawei")
        self.assertFalse(accounts[1]["use_shared_cookies"])
        self.assertEqual(accounts[2]["username"], "third-huawei")
        self.assertFalse(accounts[2]["use_shared_cookies"])

    def test_loads_sma_secondary_and_json_accounts(self):
        additional = [{
            "name": "jakbar-sma",
            "username": "third-sma",
            "password": "third-password",
        }]
        with patch.dict(os.environ, {
            "SMA_USERNAME": "primary-sma",
            "SMA_PASSWORD": "primary-password",
            "SMA_USERNAME_2": "secondary-sma",
            "SMA_PASSWORD_2": "secondary-password",
            "SMA_ACCOUNTS_JSON": json.dumps(additional),
        }, clear=True):
            accounts = load_sma_accounts_from_env()

        self.assertEqual(len(accounts), 3)
        self.assertEqual(accounts[0]["username"], "primary-sma")
        self.assertTrue(accounts[0]["use_shared_cookies"])
        self.assertEqual(accounts[1]["username"], "secondary-sma")
        self.assertFalse(accounts[1]["use_shared_cookies"])
        self.assertEqual(accounts[2]["username"], "third-sma")
        self.assertFalse(accounts[2]["use_shared_cookies"])

    def test_loads_sma_accounts_3_and_4(self):
        with patch.dict(os.environ, {
            "SMA_USERNAME": "primary-sma",
            "SMA_PASSWORD": "primary-password",
            "SMA_USERNAME_2": "second-sma",
            "SMA_PASSWORD_2": "second-password",
            "SMA_USERNAME_3": "jakpus-sma",
            "SMA_PASSWORD_3": "jakpus-password",
            "SMA_USERNAME_4": "jaksel-sma",
            "SMA_PASSWORD_4": "jaksel-password",
        }, clear=True):
            accounts = load_sma_accounts_from_env()

        self.assertEqual(len(accounts), 4)
        self.assertEqual(accounts[2]["username"], "jakpus-sma")
        self.assertEqual(accounts[2]["name"], "account_3")
        self.assertEqual(accounts[3]["username"], "jaksel-sma")
        self.assertEqual(accounts[3]["name"], "account_4")

    def test_build_normalized_site_assigns_jakpus_and_jaksel_to_sma_accounts(self):
        def make_sma_result(acc_name):
            return {
                "site": "sma",
                "scraped_at": "2026-10-19T10:00:00+00:00",
                "account": {"name": acc_name},
                "summary": {"success_count": 1, "failed_count": 0, "auth_error_count": 0},
                "calls": [{
                    "name": "navigation",
                    "response_body": [{
                        "componentId": "99901",
                        "name": "PLTS Gedung A",
                        "status": "OK",
                    }]
                }],
            }

        norm_3 = build_normalized_site(make_sma_result("account_3"))
        self.assertEqual(norm_3["stations"][0]["region"], "Jakarta Pusat")

        norm_4 = build_normalized_site(make_sma_result("account_4"))
        self.assertEqual(norm_4["stations"][0]["region"], "Jakarta Selatan")

        norm_2 = build_normalized_site(make_sma_result("account_2"))
        self.assertEqual(norm_2["stations"][0]["region"], "Jakarta Barat")

    def test_merges_huawei_accounts_preserves_platform(self):
        first = {
            "platform": "huawei",
            "updated_at": "2026-10-16T10:00:00+00:00",
            "scrape_status": {"success_count": 10, "failed_count": 0, "auth_error_count": 0},
            "overview": {"station_count": 1, "capacity_kwp": 25.0, "daily_energy_kwh": 30.0},
            "stations": [{"station_id": "HW-01", "name": "Huawei Station Jakut"}],
            "alarms": {"unsolved_count": 0, "event_total": 0, "events": []},
            "devices": {"device_count": 1, "devices": [{"device_id": 101}]},
            "charts": {},
        }
        second = {
            "platform": "huawei",
            "updated_at": "2026-10-16T10:01:00+00:00",
            "scrape_status": {"success_count": 12, "failed_count": 0, "auth_error_count": 0},
            "overview": {"station_count": 1, "capacity_kwp": 30.0, "daily_energy_kwh": 40.0},
            "stations": [{"station_id": "HW-02", "name": "Huawei Station Jakbar"}],
            "alarms": {"unsolved_count": 0, "event_total": 0, "events": []},
            "devices": {"device_count": 1, "devices": [{"device_id": 102}]},
            "charts": {},
        }

        merged = merge_normalized_sites([first, second])
        self.assertEqual(merged["platform"], "huawei")
        self.assertEqual(merged["overview"]["station_count"], 2)
        self.assertEqual(merged["overview"]["capacity_kwp"], 55.0)
        self.assertEqual(merged["overview"]["daily_energy_kwh"], 70.0)
        self.assertEqual(len(merged["stations"]), 2)


if __name__ == "__main__":
    unittest.main()
