import 'package:flutter_test/flutter_test.dart';
import 'package:plts_mobile/models/monitoring_data.dart';

void main() {
  group('StationModel Kehua Automatic Revenue Calculation', () {
    test('Calculates Kehua cumulative income when missing or 0 at Rp 900/kWh', () {
      final json = {
        'station_id': 'kh_01',
        'name': 'Gedung Kehua PLTS',
        'platform': 'kehua',
        'status': 'normal',
        'capacity_kwp': 15.0,
        'current_power_kw': 10.5,
        'daily_energy_kwh': 20.0,
        'monthly_energy_kwh': 500.0,
        'yearly_energy_kwh': 6000.0,
        'cumulative_energy_kwh': 12000.0,
        'cumulative_income': 0, // Missing or 0
        'daily_income': 0,
        'monthly_income': 0,
      };

      final station = StationModel.fromJson(json, 'kehua');

      expect(station.isKehua, isTrue);
      // 12000 kWh * 900 = 10,800,000 IDR
      expect(station.cumulativeIncome, equals(10800000.0));
      // 20 kWh * 900 = 18,000 IDR
      expect(station.dailyIncome, equals(18000.0));
      // 500 kWh * 900 = 450,000 IDR
      expect(station.monthlyIncome, equals(450000.0));
    });

    test('Preserves existing non-zero income if provided by vendor', () {
      final json = {
        'station_id': 'kh_02',
        'name': 'Kehua Station with Vendor Income',
        'platform': 'kehua',
        'cumulative_energy_kwh': 1000.0,
        'cumulative_income': 1500000.0,
        'daily_energy_kwh': 10.0,
        'daily_income': 15000.0,
      };

      final station = StationModel.fromJson(json, 'kehua');
      expect(station.cumulativeIncome, equals(1500000.0));
      expect(station.dailyIncome, equals(15000.0));
    });

    test('Does not calculate Kehua tariff for Huawei stations', () {
      final json = {
        'station_id': 'hw_01',
        'name': 'Huawei Station',
        'platform': 'huawei',
        'cumulative_energy_kwh': 5000.0,
        'cumulative_income': 0, // Huawei raw 0 should not be multiplied by 900
      };

      final station = StationModel.fromJson(json, 'huawei');
      expect(station.isKehua, isFalse);
      expect(station.cumulativeIncome, equals(0.0));
    });

    test('FleetSummary accurately aggregates Huawei and Kehua incomes', () {
      final kehua = StationModel.fromJson({
        'station_id': 'kh_01',
        'name': 'Kehua Station',
        'platform': 'kehua',
        'cumulative_energy_kwh': 1000.0, // 1000 * 900 = 900,000
        'daily_energy_kwh': 10.0,
        'monthly_energy_kwh': 100.0,
      }, 'kehua');

      final huawei = StationModel.fromJson({
        'station_id': 'hw_01',
        'name': 'Huawei Station',
        'platform': 'huawei',
        'cumulative_energy_kwh': 2000.0,
        'cumulative_income': 2500000.0,
        'daily_energy_kwh': 20.0,
        'monthly_energy_kwh': 200.0,
      }, 'huawei');

      final summary = FleetSummary.fromStations([kehua, huawei], DateTime.now());
      expect(summary.totalCumulativeIncome, equals(900000.0 + 2500000.0));
    });
  });
}
