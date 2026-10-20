import json
import os
import unittest
from unittest.mock import patch

from scrape_monitoring import (
    build_normalized_site,
    kehua_request_sign,
    load_kehua_accounts_from_env,
    merge_normalized_sites,
    parse_form_payload,
    prepare_kehua_account_call,
    prepare_replay_call,
)


class KehuaAccountsTests(unittest.TestCase):
    def test_loads_legacy_and_additional_accounts_without_duplicates(self):
        additional = [{
            "name": "school-09",
            "username": "second-user",
            "password": "second-password",
            "company_id": 1831,
            "station_id": 17483,
            "area_code": 2054,
        }]
        with patch.dict(os.environ, {
            "KEHUA_USERNAME": "primary-user",
            "KEHUA_PASSWORD": "primary-password",
            "KEHUA_ACCOUNTS_JSON": json.dumps(additional),
        }, clear=True):
            accounts = load_kehua_accounts_from_env()

        self.assertEqual(len(accounts), 2)
        self.assertTrue(accounts[0]["use_shared_cookies"])
        self.assertEqual(accounts[1]["company_id"], "1831")
        self.assertEqual(accounts[1]["station_id"], "17483")
        self.assertEqual(accounts[1]["area_code"], "2054")

    def test_loads_second_account_from_simple_env(self):
        with patch.dict(os.environ, {
            "KEHUA_USERNAME": "primary-user",
            "KEHUA_PASSWORD": "primary-password",
            "KEHUA_USERNAME_2": "second-user",
            "KEHUA_PASSWORD_2": "second-password",
        }, clear=True):
            accounts = load_kehua_accounts_from_env()

        self.assertEqual(len(accounts), 2)
        self.assertEqual(accounts[0]["username"], "primary-user")
        self.assertEqual(accounts[1]["username"], "second-user")
        self.assertFalse(accounts[1]["use_shared_cookies"])

    def test_loads_third_account_from_simple_env(self):
        with patch.dict(os.environ, {
            "KEHUA_USERNAME": "primary-user",
            "KEHUA_PASSWORD": "primary-password",
            "KEHUA_USERNAME_2": "second-user",
            "KEHUA_PASSWORD_2": "second-password",
            "KEHUA_USERNAME_3": "third-user",
            "KEHUA_PASSWORD_3": "third-password",
        }, clear=True):
            accounts = load_kehua_accounts_from_env()

        self.assertEqual(len(accounts), 3)
        self.assertEqual(accounts[0]["username"], "primary-user")
        self.assertEqual(accounts[1]["username"], "second-user")
        self.assertEqual(accounts[2]["username"], "third-user")
        self.assertEqual(accounts[2]["name"], "account_3")
        self.assertFalse(accounts[2]["use_shared_cookies"])

    def test_build_normalized_site_assigns_jakarta_barat_to_additional_accounts(self):
        site_result_jakbar = {
            "site": "kehua",
            "scraped_at": "2026-10-16T10:00:00+00:00",
            "account": {"name": "account_3"},
            "summary": {"success_count": 1, "failed_count": 0, "auth_error_count": 0},
            "calls": [{
                "name": "listStationCardInfoByCondition",
                "response_body": {
                    "code": "0",
                    "data": {
                        "result": [{
                            "stationId": "99999",
                            "stationName": "SMKN 53 JAKBAR",
                            "capacity": 15.0,
                        }]
                    }
                }
            }],
        }
        normalized_jakbar = build_normalized_site(site_result_jakbar)
        self.assertEqual(len(normalized_jakbar["stations"]), 1)
        self.assertEqual(normalized_jakbar["stations"][0]["region"], "Jakarta Barat")

        # Verify account 2 (secondary Jakarta Utara) does NOT get overwritten as Jakarta Barat
        site_result_jakut = {
            "site": "kehua",
            "scraped_at": "2026-10-16T10:00:00+00:00",
            "account": {"name": "secondary"},
            "summary": {"success_count": 1, "failed_count": 0, "auth_error_count": 0},
            "calls": [{
                "name": "listStationCardInfoByCondition",
                "response_body": {
                    "code": "0",
                    "data": {
                        "result": [{
                            "stationId": "17483",
                            "stationName": "SDN 09 JAKUT",
                            "capacity": 15.0,
                        }]
                    }
                }
            }],
        }
        normalized_jakut = build_normalized_site(site_result_jakut)
        self.assertNotEqual(normalized_jakut["stations"][0].get("region"), "Jakarta Barat")

        # Verify account 5 (Jakarta Pusat) is assigned to Jakarta Pusat
        site_result_jakpus = {
            "site": "kehua",
            "scraped_at": "2026-10-16T10:00:00+00:00",
            "account": {"name": "account_5"},
            "summary": {"success_count": 1, "failed_count": 0, "auth_error_count": 0},
            "calls": [{
                "name": "listStationCardInfoByCondition",
                "response_body": {
                    "code": "0",
                    "data": {
                        "result": [{
                            "stationId": "34142",
                            "stationName": "SMPN 72 Jakpus",
                            "capacity": 15.0,
                        }]
                    }
                }
            }],
        }
        normalized_jakpus_5 = build_normalized_site(site_result_jakpus)
        self.assertEqual(len(normalized_jakpus_5["stations"]), 1)
        self.assertEqual(normalized_jakpus_5["stations"][0]["region"], "Jakarta Pusat")

        # Verify account 6 is also assigned to Jakarta Pusat
        site_result_jakpus["account"] = {"name": "account_6"}
        normalized_jakpus_6 = build_normalized_site(site_result_jakpus)
        self.assertEqual(normalized_jakpus_6["stations"][0]["region"], "Jakarta Pusat")

        # Verify account 7 and 8 are assigned to Jakarta Selatan
        site_result_jaksel = {
            "site": "kehua",
            "scraped_at": "2026-10-20T10:00:00+00:00",
            "account": {"name": "account_7"},
            "summary": {"success_count": 1, "failed_count": 0, "auth_error_count": 0},
            "calls": [{
                "name": "listStationCardInfoByCondition",
                "response_body": {
                    "code": "0",
                    "data": {
                        "result": [{
                            "stationId": "77777",
                            "stationName": "SMPN JAKSEL",
                            "capacity": 15.0,
                        }]
                    }
                }
            }],
        }
        normalized_jaksel_7 = build_normalized_site(site_result_jaksel)
        self.assertEqual(normalized_jaksel_7["stations"][0]["region"], "Jakarta Selatan")

        site_result_jaksel["account"] = {"name": "account_8"}
        normalized_jaksel_8 = build_normalized_site(site_result_jaksel)
        self.assertEqual(normalized_jaksel_8["stations"][0]["region"], "Jakarta Selatan")

    def test_loads_fifth_and_sixth_accounts_from_simple_env(self):
        with patch.dict(os.environ, {
            "KEHUA_USERNAME": "primary-user",
            "KEHUA_PASSWORD": "primary-password",
            "KEHUA_USERNAME_5": "fifth-user",
            "KEHUA_PASSWORD_5": "fifth-password",
            "KEHUA_USERNAME_6": "sixth-user",
            "KEHUA_PASSWORD_6": "sixth-password",
            "KEHUA_USERNAME_7": "seventh-user",
            "KEHUA_PASSWORD_7": "seventh-password",
        }, clear=True):
            accounts = load_kehua_accounts_from_env()

        self.assertEqual(len(accounts), 4)
        self.assertEqual(accounts[1]["username"], "fifth-user")
        self.assertEqual(accounts[1]["name"], "account_5")
        self.assertEqual(accounts[2]["username"], "sixth-user")
        self.assertEqual(accounts[2]["name"], "account_6")
        self.assertEqual(accounts[3]["username"], "seventh-user")
        self.assertEqual(accounts[3]["name"], "account_7")

    def test_rewrites_account_identifiers_and_resigns_the_request(self):
        call = {
            "site": "kehua",
            "name": "station",
            "headers": {"sign": "stale"},
            "payload_raw": "companyId=1832&areaCode=2055&stationId=17478",
        }
        account = {
            "company_id": "1831",
            "area_code": "2054",
            "station_id": "17483",
        }

        rewritten = prepare_kehua_account_call(call, account)
        prepared = prepare_replay_call(rewritten, sign_timestamp_ms=123)
        payload = parse_form_payload(prepared["payload_raw"])

        self.assertEqual(payload["companyId"], "1831")
        self.assertEqual(payload["areaCode"], "2054")
        self.assertEqual(payload["stationId"], "17483")
        self.assertEqual(prepared["headers"]["sign"], kehua_request_sign(payload, 123))

    def test_merges_accounts_while_preserving_station_specific_charts(self):
        first = {
            "platform": "kehua",
            "updated_at": "2026-08-03T10:00:00+00:00",
            "scrape_status": {"success_count": 42, "failed_count": 0, "auth_error_count": 0},
            "overview": {"station_count": 1, "capacity_kwp": 15.0, "daily_energy_kwh": 10.0},
            "stations": [{"station_id": "17478", "name": "School 282"}],
            "alarms": {"unsolved_count": 0, "event_total": 0, "events": []},
            "devices": {"device_count": 1, "devices": [{"device_id": 1}]},
            "charts": {"daily_generation": {"x": ["00:00"], "y": [1.0]}},
        }
        second = {
            "platform": "kehua",
            "updated_at": "2026-08-03T10:01:00+00:00",
            "scrape_status": {"success_count": 42, "failed_count": 0, "auth_error_count": 0},
            "overview": {"station_count": 1, "capacity_kwp": 20.0, "daily_energy_kwh": 12.0},
            "stations": [{"station_id": "17483", "name": "School 09"}],
            "alarms": {"unsolved_count": 1, "event_total": 1, "events": [{"id": 2}]},
            "devices": {"device_count": 1, "devices": [{"device_id": 2}]},
            "charts": {"daily_generation": {"x": ["00:00"], "y": [2.0]}},
        }

        merged = merge_normalized_sites([first, second])

        self.assertEqual(merged["overview"]["station_count"], 2)
        self.assertEqual(merged["overview"]["capacity_kwp"], 35.0)
        self.assertEqual(merged["overview"]["daily_energy_kwh"], 22.0)
        self.assertEqual(merged["scrape_status"]["success_count"], 84)
        self.assertEqual(len(merged["stations"]), 2)
        self.assertEqual(merged["stations"][1]["charts"]["daily_generation"]["y"], [2.0])
        self.assertEqual(merged["devices"]["device_count"], 2)


if __name__ == "__main__":
    unittest.main()
