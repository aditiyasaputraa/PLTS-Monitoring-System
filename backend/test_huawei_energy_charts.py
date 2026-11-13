import unittest
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

from scrape_monitoring import (
    huawei_energy_balance_by_station,
    huawei_energy_balance_calls,
    normalize_huawei_stations,
    normalize_kehua_stations,
)


class HuaweiEnergyChartTests(unittest.TestCase):
    def test_builds_day_month_and_year_energy_calls_for_each_station(self):
        station_list_call = {
            "response_body": {
                "data": {"list": [{"dn": "NE=64589850"}]},
            }
        }
        site = {
            "base_url": "https://sg5.fusionsolar.huawei.com",
            "dashboard_url": "https://sg5.fusionsolar.huawei.com/dashboard",
        }

        calls = huawei_energy_balance_calls(
            site,
            station_list_call,
            datetime(2026, 8, 3, 2, 30, tzinfo=timezone.utc),
        )

        self.assertEqual([call["name"] for call in calls], [
            "energy-balance-daily",
            "energy-balance-monthly",
            "energy-balance-yearly",
            "energy-balance-lifetime",
        ])
        queries = [parse_qs(urlparse(call["url"]).query) for call in calls]
        self.assertEqual([query["timeDim"][0] for query in queries], ["2", "4", "5", "6"])
        self.assertEqual(queries[0]["dateStr"], ["2026-08-03 00:00:00"])
        self.assertEqual(queries[1]["dateStr"], ["2026-08-01 00:00:00"])
        self.assertEqual(queries[2]["dateStr"], ["2026-01-01 00:00:00"])
        self.assertEqual(queries[3]["dateStr"], ["2026-08-03 00:00:00"])

    def test_normalizes_month_and_year_product_power_as_energy_charts(self):
        grouped = {
            "energy-balance-monthly": [{
                "url": "https://example/energy-balance?stationDn=NE%3D64589850&timeDim=4",
                "response_body": {"data": {
                    "xAxis": ["01", "02", "03", "04"],
                    "productPower": ["64.67", "62.14", "60.40", "--"],
                }},
            }],
            "energy-balance-yearly": [{
                "url": "https://example/energy-balance?stationDn=NE%3D64589850&timeDim=5",
                "response_body": {"data": {
                    "xAxis": ["01", "02", "03", "04"],
                    "productPower": ["2084.12", "1990.17", "2814.79", "2925.45"],
                }},
            }],
        }

        result = huawei_energy_balance_by_station(grouped)["NE=64589850"]

        self.assertEqual(result["energy_charts"]["daily"]["values"], [64.67, 62.14, 60.4, None])
        self.assertEqual(result["energy_charts"]["monthly"]["values"], [2084.12, 1990.17, 2814.79, 2925.45])

    def test_huawei_power_fallback_from_inverter_or_5min_and_status_alignment(self):
        grouped = {
            "station-list": [{
                "response_body": {"data": {"list": [
                    {
                        "dn": "NE=51294066",
                        "name": "Puskesmas Pasar Rebo",
                        "plantStatus": "connected",
                        "currentPower": 0.0,
                        "dailyEnergy": 67.5,
                    },
                    {
                        "dn": "NE=110759320",
                        "name": "SDN Rawa Badak Utara 19",
                        "plantStatus": "connected",
                        "currentPower": 0.0,
                        "dailyEnergy": 0.0,
                    },
                    {
                        "dn": "NE=51230152",
                        "name": "SDN Tugu Utara 09",
                        "plantStatus": "disconnected",
                        "currentPower": 6.11,
                        "inverterPower": 6.112,
                        "dailyEnergy": 90.99,
                    },
                ]}},
            }],
            "energy-balance-daily": [{
                "url": "https://example/energy-balance?stationDn=NE%3D51294066&timeDim=2",
                "response_body": {"data": {
                    "xAxis": ["14:40", "14:45", "14:50"],
                    "productPower": ["3.339", "2.107", "--"],
                }},
            }],
        }

        stations = {s["station_id"]: s for s in normalize_huawei_stations(grouped)}
        self.assertEqual(stations["NE=51294066"]["current_power_kw"], 2.107)
        self.assertEqual(stations["NE=51294066"]["status"], "normal")
        self.assertEqual(stations["NE=110759320"]["current_power_kw"], 0.0)
        self.assertEqual(stations["NE=110759320"]["status"], "offline")
        self.assertEqual(stations["NE=51230152"]["current_power_kw"], 6.11)
        self.assertEqual(stations["NE=51230152"]["status"], "normal")

    def test_kehua_power_fallback_and_vacant_status_alignment(self):
        grouped = {
            "listStationInfoByCondition": [{
                "response_body": {"data": {"result": [
                    {
                        "stationId": 17774,
                        "stationName": "SDN Cengkareng Timur 07",
                        "stationStatus": 3,
                        "activePower": 0.0,
                        "dayElec": 7.8,
                    },
                    {
                        "stationId": 17483,
                        "stationName": "SDN 09 JAKUT",
                        "stationStatus": 4,
                        "activePower": 3.7,
                        "dayElec": 41.0,
                    },
                ]}},
            }],
            "getTopologyInfo": [{
                "payload_raw": "stationId=17483",
                "response_body": {"data": {
                    "outputPower": 0.0,
                    "outputPowerUnit": "kW",
                    "pvPower": 3.7,
                    "pvPowerUnit": "kW",
                }},
            }],
        }

        stations = {s["station_id"]: s for s in normalize_kehua_stations(grouped)}
        self.assertEqual(stations["17774"]["current_power_kw"], 0.0)
        self.assertEqual(stations["17774"]["status"], "offline")
        self.assertEqual(stations["17483"]["current_power_kw"], 3.7)
        self.assertEqual(stations["17483"]["status"], "normal")


if __name__ == "__main__":
    unittest.main()
