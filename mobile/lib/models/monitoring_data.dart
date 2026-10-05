class StationModel {
  final String id;
  final String name;
  final String platform;
  final String status;
  final double capacityKwp;
  final double currentPowerKw;
  final double dailyEnergyKwh;
  final double monthlyEnergyKwh;
  final double yearlyEnergyKwh;
  final double cumulativeEnergyKwh;
  final double cumulativeIncome;
  final double? latitude;
  final double? longitude;
  final String address;
  final double inverterPowerKw;
  final List<String> curveTimes;
  final List<double> curvePowers;

  StationModel({
    required this.id,
    required this.name,
    required this.platform,
    required this.status,
    required this.capacityKwp,
    required this.currentPowerKw,
    required this.dailyEnergyKwh,
    required this.monthlyEnergyKwh,
    required this.yearlyEnergyKwh,
    required this.cumulativeEnergyKwh,
    required this.cumulativeIncome,
    this.latitude,
    this.longitude,
    required this.address,
    required this.inverterPowerKw,
    this.curveTimes = const [],
    this.curvePowers = const [],
  });

  bool get isOnline =>
      status.toLowerCase() == 'normal' ||
      status.toLowerCase() == 'online' ||
      status.toLowerCase() == 'grid-connected';

  factory StationModel.fromJson(Map<String, dynamic> json, String platformName) {
    double parseDouble(dynamic val) {
      if (val == null) return 0.0;
      if (val is num) return val.toDouble();
      return double.tryParse(val.toString()) ?? 0.0;
    }

    // Extract power curve from Huawei or Kehua
    List<String> times = [];
    List<double> powers = [];

    // 1. Huawei daily_power_5min
    if (json['daily_power_5min'] is Map) {
      final curve = json['daily_power_5min'] as Map<String, dynamic>;
      final xList = curve['x'];
      final yList = curve['generation_power_kw'] ?? curve['power'] ?? curve['y'];
      if (xList is List) {
        times = xList.map((e) {
          final s = e.toString();
          if (s.contains(' ') && s.split(' ').length > 1) {
            return s.split(' ')[1];
          }
          return s;
        }).toList();
      }
      if (yList is List) {
        powers = yList.map((e) => parseDouble(e)).toList();
      }
    }

    // 2. Kehua station_power_trend inside charts
    if (powers.isEmpty && json['charts'] is Map) {
      final charts = json['charts'] as Map<String, dynamic>;
      final trend = charts['station_power_trend'];
      if (trend is Map && trend['series'] is Map) {
        final series = trend['series'] as Map<String, dynamic>;
        for (var dateKey in series.keys) {
          final dateVal = series[dateKey];
          if (dateVal is Map) {
            final xList = dateVal['x'];
            final yMap = dateVal['y'];
            if (xList is List) {
              times = xList.map((e) => e.toString()).toList();
            }
            if (yMap is Map) {
              final elec = yMap['y_data_elec'] ?? yMap['y_data_power'];
              if (elec is List) {
                powers = elec.map((e) => parseDouble(e)).toList();
              }
            }
            if (powers.isNotEmpty) break;
          }
        }
      }
    }

    // 3. Fallback day_power_curve
    if (powers.isEmpty && json['day_power_curve'] is Map) {
      final curve = json['day_power_curve'] as Map<String, dynamic>;
      final xList = curve['x'];
      final yMap = curve['y'];
      if (xList is List) {
        times = xList.map((e) => e.toString()).toList();
      }
      if (yMap is Map) {
        final elec = yMap['y_data_elec'] ?? yMap['y_data_power'] ?? yMap['power'];
        if (elec is List) {
          powers = elec.map((e) => parseDouble(e)).toList();
        }
      }
    }

    return StationModel(
      id: (json['station_id'] ?? json['id'] ?? '').toString(),
      name: (json['name'] ?? json['station_name'] ?? 'PLTS Station').toString(),
      platform: platformName,
      status: (json['status'] ?? 'unknown').toString(),
      capacityKwp: parseDouble(json['capacity_kwp']),
      currentPowerKw: parseDouble(json['current_power_kw']),
      dailyEnergyKwh: parseDouble(json['daily_energy_kwh']),
      monthlyEnergyKwh: parseDouble(json['monthly_energy_kwh']),
      yearlyEnergyKwh: parseDouble(json['yearly_energy_kwh']),
      cumulativeEnergyKwh: parseDouble(json['cumulative_energy_kwh']),
      cumulativeIncome: parseDouble(json['cumulative_income']),
      latitude: json['latitude'] != null ? parseDouble(json['latitude']) : null,
      longitude: json['longitude'] != null ? parseDouble(json['longitude']) : null,
      address: (json['address'] ?? json['location'] ?? '').toString(),
      inverterPowerKw: parseDouble(json['inverter_power_kw']),
      curveTimes: times,
      curvePowers: powers,
    );
  }
}

class FleetSummary {
  final int totalStations;
  final double totalCapacityKwp;
  final double totalCurrentPowerKw;
  final double totalDailyEnergyKwh;
  final double totalMonthlyEnergyKwh;
  final double totalCumulativeIncome;
  final int onlineStations;
  final int offlineStations;
  final DateTime? lastUpdated;

  FleetSummary({
    required this.totalStations,
    required this.totalCapacityKwp,
    required this.totalCurrentPowerKw,
    required this.totalDailyEnergyKwh,
    required this.totalMonthlyEnergyKwh,
    required this.totalCumulativeIncome,
    required this.onlineStations,
    required this.offlineStations,
    this.lastUpdated,
  });

  factory FleetSummary.fromStations(List<StationModel> stations, DateTime? updated) {
    double cap = 0;
    double current = 0;
    double daily = 0;
    double monthly = 0;
    double income = 0;
    int online = 0;
    int offline = 0;

    for (var s in stations) {
      cap += s.capacityKwp;
      current += s.currentPowerKw;
      daily += s.dailyEnergyKwh;
      monthly += s.monthlyEnergyKwh;
      income += s.cumulativeIncome;
      if (s.isOnline) {
        online++;
      } else {
        offline++;
      }
    }

    return FleetSummary(
      totalStations: stations.length,
      totalCapacityKwp: cap,
      totalCurrentPowerKw: current,
      totalDailyEnergyKwh: daily,
      totalMonthlyEnergyKwh: monthly,
      totalCumulativeIncome: income,
      onlineStations: online,
      offlineStations: offline,
      lastUpdated: updated,
    );
  }
}
