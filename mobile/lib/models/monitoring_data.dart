class StationModel {
  static const double kehuaTariffPerKwh = 900.0;

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
  final double dailyIncome;
  final double monthlyIncome;
  final double yearlyIncome;
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
    this.dailyIncome = 0.0,
    this.monthlyIncome = 0.0,
    this.yearlyIncome = 0.0,
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

  bool get isKehua =>
      platform.toLowerCase().contains('kehua') ||
      name.toLowerCase().contains('kehua');

  factory StationModel.fromJson(Map<String, dynamic> json, String platformName) {
    double parseDouble(dynamic val) {
      if (val == null) return 0.0;
      if (val is num) return val.toDouble();
      return double.tryParse(val.toString()) ?? 0.0;
    }

    final String platform = (json['platform'] ?? json['platform_name'] ?? platformName).toString();
    final String name = (json['name'] ?? json['station_name'] ?? 'PLTS Station').toString();
    final bool isKehuaStation = platform.toLowerCase().contains('kehua') ||
        (json['vendor'] ?? '').toString().toLowerCase().contains('kehua') ||
        name.toLowerCase().contains('kehua');

    final double dailyKwh = parseDouble(json['daily_energy_kwh']);
    final double monthlyKwh = parseDouble(json['monthly_energy_kwh']);
    final double yearlyKwh = parseDouble(json['yearly_energy_kwh']);
    final double cumKwh = parseDouble(json['cumulative_energy_kwh']);

    double dailyIncome = parseDouble(json['daily_income']);
    double monthlyIncome = parseDouble(json['monthly_income']);
    double yearlyIncome = parseDouble(json['yearly_income']);
    double cumulativeIncome = parseDouble(json['cumulative_income'] ?? json['total_income'] ?? json['income']);

    // Perhitungan otomatis pendapatan vendor Kehua: Rp 900 / kWh
    if (isKehuaStation) {
      if (dailyIncome <= 0 && dailyKwh > 0) {
        dailyIncome = (dailyKwh * kehuaTariffPerKwh).roundToDouble();
      }
      if (monthlyIncome <= 0 && monthlyKwh > 0) {
        monthlyIncome = (monthlyKwh * kehuaTariffPerKwh).roundToDouble();
      }
      if (yearlyIncome <= 0 && yearlyKwh > 0) {
        yearlyIncome = (yearlyKwh * kehuaTariffPerKwh).roundToDouble();
      }
      if (cumulativeIncome <= 0 && cumKwh > 0) {
        cumulativeIncome = (cumKwh * kehuaTariffPerKwh).roundToDouble();
      }
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
      name: name,
      platform: platform,
      status: (json['status'] ?? 'unknown').toString(),
      capacityKwp: parseDouble(json['capacity_kwp']),
      currentPowerKw: parseDouble(json['current_power_kw']),
      dailyEnergyKwh: dailyKwh,
      monthlyEnergyKwh: monthlyKwh,
      yearlyEnergyKwh: yearlyKwh,
      cumulativeEnergyKwh: cumKwh,
      dailyIncome: dailyIncome,
      monthlyIncome: monthlyIncome,
      yearlyIncome: yearlyIncome,
      cumulativeIncome: cumulativeIncome,
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
  final double totalDailyIncome;
  final double totalMonthlyIncome;
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
    this.totalDailyIncome = 0.0,
    this.totalMonthlyIncome = 0.0,
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
    double dailyInc = 0;
    double monthlyInc = 0;
    double income = 0;
    int online = 0;
    int offline = 0;

    for (var s in stations) {
      cap += s.capacityKwp;
      current += s.currentPowerKw;
      daily += s.dailyEnergyKwh;
      monthly += s.monthlyEnergyKwh;
      dailyInc += s.dailyIncome;
      monthlyInc += s.monthlyIncome;
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
      totalDailyIncome: dailyInc,
      totalMonthlyIncome: monthlyInc,
      totalCumulativeIncome: income,
      onlineStations: online,
      offlineStations: offline,
      lastUpdated: updated,
    );
  }
}
