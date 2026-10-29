import os
import unittest
from unittest.mock import patch

from supabase_store import SupabaseStore, merge_payload_preserve_history


class SupabaseStoreHistoryMergeTests(unittest.TestCase):
    def test_merge_payload_preserves_historical_months(self):
        existing = {
            "by_site": {
                "kehua": {
                    "stations": [
                        {
                            "station_id": "17483",
                            "name": "SDN 09 JAKUT",
                            "charts": {
                                "company_power_trends": {
                                    "month_daily": {
                                        "series": {
                                            "2022-01": {"x": ["1"], "y": [10.5]},
                                            "2023-05": {"x": ["1"], "y": [20.0]},
                                        }
                                    }
                                }
                            },
                            "energy_charts": {
                                "daily_by_month": {
                                    "2022-01": {"labels": ["01"], "values": [10.5]}
                                }
                            }
                        }
                    ]
                }
            }
        }
        incoming = {
            "by_site": {
                "kehua": {
                    "stations": [
                        {
                            "station_id": "17483",
                            "name": "SDN 09 JAKUT",
                            "charts": {
                                "company_power_trends": {
                                    "month_daily": {
                                        "series": {
                                            "2026-10": {"x": ["1"], "y": [35.0]},
                                        }
                                    }
                                }
                            },
                            "energy_charts": {
                                "daily_by_month": {
                                    "2026-10": {"labels": ["01"], "values": [35.0]}
                                }
                            }
                        }
                    ]
                }
            }
        }
        merged = merge_payload_preserve_history(existing, incoming)
        st = merged["by_site"]["kehua"]["stations"][0]
        series = st["charts"]["company_power_trends"]["month_daily"]["series"]
        self.assertIn("2022-01", series)
        self.assertIn("2023-05", series)
        self.assertIn("2026-10", series)
        dbm = st["energy_charts"]["daily_by_month"]
        self.assertIn("2022-01", dbm)
        self.assertIn("2026-10", dbm)


class SupabaseStoreEnvironmentTests(unittest.TestCase):
    def test_reads_optional_daily_rollup_table_name(self):
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SECRET_KEY": "sb_secret_server_key",
                "SUPABASE_DAILY_TABLE": "custom_site_daily",
            },
            clear=True,
        ), patch("supabase_store.create_client"):
            store = SupabaseStore.from_env()

        self.assertTrue(store.configured)
        self.assertEqual(store.config.daily_table, "custom_site_daily")

    def test_rejects_publishable_key_used_as_server_secret(self):
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SECRET_KEY": "sb_publishable_browser_key",
            },
            clear=True,
        ):
            store = SupabaseStore.from_env()

        self.assertFalse(store.configured)
        self.assertIn("publishable", store.config_error)
        self.assertIn("server secret", store.config_error)

    def test_rejects_legacy_anon_jwt_used_as_server_secret(self):
        anon_jwt = (
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
            "eyJyb2xlIjoiYW5vbiJ9."
            "signature"
        )
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SECRET_KEY": anon_jwt,
            },
            clear=True,
        ):
            store = SupabaseStore.from_env()

        self.assertFalse(store.configured)
        self.assertIn("anonymous JWT", store.config_error)


if __name__ == "__main__":
    unittest.main()
