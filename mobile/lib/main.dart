import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:plts_mobile/models/monitoring_data.dart';
import 'package:plts_mobile/services/api_service.dart';
import 'package:plts_mobile/services/auth_service.dart';
import 'package:plts_mobile/widgets/summary_card.dart';
import 'package:plts_mobile/widgets/station_card.dart';
import 'package:plts_mobile/widgets/station_detail_sheet.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
    ),
  );
  runApp(const PltsMobileApp());
}

class PltsMobileApp extends StatefulWidget {
  const PltsMobileApp({super.key});

  @override
  State<PltsMobileApp> createState() => _PltsMobileAppState();
}

class _PltsMobileAppState extends State<PltsMobileApp> {
  bool _isLoggedIn = false;
  bool _isCheckingSession = true;

  @override
  void initState() {
    super.initState();
    _restoreSavedSession();
  }

  Future<void> _restoreSavedSession() async {
    final hasActiveSession = await AuthService.restoreSession();
    if (mounted) {
      setState(() {
        _isLoggedIn = hasActiveSession;
        _isCheckingSession = false;
      });
    }
  }

  void _onLoginSuccess() {
    setState(() {
      _isLoggedIn = true;
    });
  }

  Future<void> _onSignOut() async {
    await AuthService.signOut();
    if (mounted) {
      setState(() {
        _isLoggedIn = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PLTS Monitoring Mobile',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0B132B), // Deep Navy Slate
        primaryColor: const Color(0xFF0D9488),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF0D9488),
          secondary: Color(0xFFF59E0B),
          surface: Color(0xFF1E293B),
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF0F172A),
          elevation: 0,
          centerTitle: false,
          titleTextStyle: TextStyle(
            color: Colors.white,
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
      home: _isCheckingSession
          ? const Scaffold(
              backgroundColor: Color(0xFF0B132B),
              body: Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.solar_power_rounded, color: Color(0xFF10B981), size: 54),
                    SizedBox(height: 20),
                    CircularProgressIndicator(color: Color(0xFF0D9488), strokeWidth: 2.5),
                  ],
                ),
              ),
            )
          : (_isLoggedIn
              ? DashboardScreen(onSignOut: _onSignOut)
              : LoginScreen(onLoginSuccess: _onLoginSuccess)),
    );
  }
}

class LoginScreen extends StatefulWidget {
  final VoidCallback onLoginSuccess;

  const LoginScreen({super.key, required this.onLoginSuccess});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  bool _obscurePassword = true;
  bool _isLoading = false;
  String? _errorMessage;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _handleSignIn() async {
    final email = _emailController.text.trim();
    final password = _passwordController.text;

    if (email.isEmpty || password.isEmpty) {
      setState(() {
        _errorMessage = "Silakan masukkan email/username dan password.";
      });
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      await AuthService.signIn(email: email, password: password);
      if (mounted) {
        widget.onLoginSuccess();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString().replaceAll("Exception: ", "");
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0B132B),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFF0D9488).withValues(alpha: 0.15),
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: const Color(0xFF0D9488).withValues(alpha: 0.3),
                      width: 2,
                    ),
                  ),
                  child: const Icon(
                    Icons.solar_power_rounded,
                    color: Color(0xFF10B981),
                    size: 44,
                  ),
                ),
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1E293B),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: Colors.white12),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.school_rounded, color: Color(0xFF38BDF8), size: 15),
                      SizedBox(width: 6),
                      Text(
                        "Politeknik Negeri Jakarta",
                        style: TextStyle(
                          color: Color(0xFFCBD5E1),
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1E293B),
                    borderRadius: BorderRadius.circular(24),
                    border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.35),
                        blurRadius: 20,
                        offset: const Offset(0, 10),
                      ),
                    ],
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Text(
                        "Sign in to PLTS Monitor",
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.bold,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 6),
                      const Text(
                        "Put your email and password below.",
                        style: TextStyle(
                          color: Color(0xFF94A3B8),
                          fontSize: 13,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 24),
                      if (_errorMessage != null) ...[
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: Colors.redAccent.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: Colors.redAccent.withValues(alpha: 0.3)),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.error_outline, color: Colors.redAccent, size: 18),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  _errorMessage!,
                                  style: const TextStyle(color: Colors.redAccent, fontSize: 12),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],
                      const Text(
                        "Email / Username",
                        style: TextStyle(
                          color: Colors.white70,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 6),
                      TextField(
                        controller: _emailController,
                        style: const TextStyle(color: Colors.white),
                        decoration: InputDecoration(
                          hintText: "admin / operator@pnj.ac.id",
                          hintStyle: const TextStyle(color: Colors.white30, fontSize: 13),
                          prefixIcon: const Icon(Icons.person_outline, color: Colors.white54, size: 20),
                          filled: true,
                          fillColor: const Color(0xFF0F172A),
                          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: const BorderSide(color: Colors.white12),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: const BorderSide(color: Colors.white12),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: const BorderSide(color: Color(0xFF0D9488), width: 1.5),
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        "Password",
                        style: TextStyle(
                          color: Colors.white70,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 6),
                      TextField(
                        controller: _passwordController,
                        obscureText: _obscurePassword,
                        style: const TextStyle(color: Colors.white),
                        decoration: InputDecoration(
                          hintText: "••••••••",
                          hintStyle: const TextStyle(color: Colors.white30, fontSize: 13),
                          prefixIcon: const Icon(Icons.lock_outline, color: Colors.white54, size: 20),
                          suffixIcon: IconButton(
                            icon: Icon(
                              _obscurePassword ? Icons.visibility_off : Icons.visibility,
                              color: Colors.white54,
                              size: 20,
                            ),
                            onPressed: () {
                              setState(() => _obscurePassword = !_obscurePassword);
                            },
                          ),
                          filled: true,
                          fillColor: const Color(0xFF0F172A),
                          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: const BorderSide(color: Colors.white12),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: const BorderSide(color: Colors.white12),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: const BorderSide(color: Color(0xFF0D9488), width: 1.5),
                          ),
                        ),
                      ),
                      const SizedBox(height: 24),
                      ElevatedButton(
                        onPressed: _isLoading ? null : _handleSignIn,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF0D9488),
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          elevation: 4,
                        ),
                        child: _isLoading
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child: CircularProgressIndicator(
                                  color: Colors.white,
                                  strokeWidth: 2,
                                ),
                              )
                            : const Text(
                                "Sign in",
                                style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                              ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                const Text(
                  "Unified PLTS Monitoring • Versi Mobile",
                  style: TextStyle(color: Colors.white30, fontSize: 11),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class DashboardScreen extends StatefulWidget {
  final Future<void> Function() onSignOut;

  const DashboardScreen({super.key, required this.onSignOut});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  bool _isLoading = true;
  String? _statusMessage;
  List<StationModel> _stations = [];
  FleetSummary? _summary;
  String _selectedPlatform = 'all'; // 'all', 'huawei', 'kehua'
  String _searchQuery = '';
  Timer? _refreshTimer;

  final TextEditingController _urlController = TextEditingController(
    text: ApiService.activeBaseUrl,
  );

  @override
  void initState() {
    super.initState();
    _loadData();
    // Auto-refresh every 30 seconds
    _refreshTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      _loadData(isBackground: true);
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _loadData({bool isBackground = false}) async {
    if (!isBackground) {
      setState(() => _isLoading = true);
    }

    final result = await ApiService.fetchMonitoringData();

    if (mounted) {
      setState(() {
        _stations = result.stations;
        _summary = result.summary;
        _statusMessage = result.message;
        _isLoading = false;
      });
    }
  }

  void _showApiSettingsDialog() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.settings_ethernet, color: Color(0xFF0D9488)),
            SizedBox(width: 8),
            Text("Pengaturan Koneksi API", style: TextStyle(fontSize: 16)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              "Pilih URL Backend FastAPI Monitoring:",
              style: TextStyle(fontSize: 12, color: Colors.white70),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _urlController,
              decoration: InputDecoration(
                filled: true,
                fillColor: const Color(0xFF0F172A),
                labelText: "Base URL API",
                hintText: "http://10.0.2.2:8000",
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              children: [
                ActionChip(
                  label: const Text("Emulator (10.0.2.2)", style: TextStyle(fontSize: 11)),
                  onPressed: () {
                    _urlController.text = "http://10.0.2.2:8000";
                  },
                ),
                ActionChip(
                  label: const Text("Local PC (127.0.0.1)", style: TextStyle(fontSize: 11)),
                  onPressed: () {
                    _urlController.text = "http://127.0.0.1:8000";
                  },
                ),
              ],
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text("Batal", style: TextStyle(color: Colors.white60)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF0D9488),
            ),
            onPressed: () {
              ApiService.activeBaseUrl = _urlController.text.trim();
              Navigator.pop(ctx);
              _loadData();
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text("URL disimpan: ${ApiService.activeBaseUrl}")),
              );
            },
            child: const Text("Simpan & Refresh"),
          ),
        ],
      ),
    );
  }

  void _confirmSignOut() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text("Konfirmasi Keluar"),
        content: const Text(
          "Apakah Anda yakin ingin keluar dari akun PLTS Monitor? Sesi login di perangkat ini akan dihapus.",
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text("Batal", style: TextStyle(color: Colors.white60)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.redAccent,
              foregroundColor: Colors.white,
            ),
            onPressed: () async {
              Navigator.pop(ctx);
              await widget.onSignOut();
            },
            child: const Text("Ya, Keluar"),
          ),
        ],
      ),
    );
  }

  void _openStationDetail(StationModel station) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StationDetailSheet(station: station),
    );
  }

  List<StationModel> get _filteredStations {
    return _stations.where((station) {
      final matchesPlatform = _selectedPlatform == 'all' ||
          station.platform.toLowerCase() == _selectedPlatform;
      final matchesSearch = _searchQuery.isEmpty ||
          station.name.toLowerCase().contains(_searchQuery.toLowerCase()) ||
          station.address.toLowerCase().contains(_searchQuery.toLowerCase());
      return matchesPlatform && matchesSearch;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final huaweiCount = _stations.where((s) => s.platform.toLowerCase() == 'huawei').length;
    final kehuaCount = _stations.where((s) => s.platform.toLowerCase() == 'kehua').length;
    final user = AuthService.currentUser;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: const Color(0xFF0D9488).withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.bolt, color: Color(0xFF0D9488), size: 20),
            ),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text("PLTS Mobile", style: TextStyle(fontSize: 16)),
                if (user != null)
                  Text(
                    user.name,
                    style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                  ),
              ],
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.tune_rounded),
            tooltip: "Pengaturan Koneksi API",
            onPressed: _showApiSettingsDialog,
          ),
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: "Refresh Data",
            onPressed: () => _loadData(),
          ),
          IconButton(
            icon: const Icon(Icons.logout_rounded, color: Colors.redAccent),
            tooltip: "Keluar Akun",
            onPressed: _confirmSignOut,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  CircularProgressIndicator(color: Color(0xFF0D9488)),
                  SizedBox(height: 16),
                  Text("Memuat data PLTS...", style: TextStyle(color: Colors.white70)),
                ],
              ),
            )
          : RefreshIndicator(
              color: const Color(0xFF0D9488),
              onRefresh: () => _loadData(),
              child: CustomScrollView(
                slivers: [
                  if (_statusMessage != null && _statusMessage!.isNotEmpty)
                    SliverToBoxAdapter(
                      child: Container(
                        margin: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        decoration: BoxDecoration(
                          color: Colors.redAccent.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: Colors.redAccent.withValues(alpha: 0.3)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.wifi_off_rounded, color: Colors.redAccent, size: 18),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                _statusMessage!,
                                style: const TextStyle(color: Colors.redAccent, fontSize: 12),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),

                  if (_summary != null)
                    SliverToBoxAdapter(
                      child: SummaryCard(
                        summary: _summary!,
                        isFallback: false,
                      ),
                    ),

                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          TextField(
                            onChanged: (val) => setState(() => _searchQuery = val),
                            decoration: InputDecoration(
                              hintText: "Cari lokasi PLTS (e.g. SDN 09, SMPN 282)...",
                              hintStyle: const TextStyle(color: Colors.white38, fontSize: 13),
                              prefixIcon: const Icon(Icons.search, color: Colors.white38, size: 20),
                              filled: true,
                              fillColor: const Color(0xFF1E293B),
                              contentPadding: const EdgeInsets.symmetric(vertical: 0, horizontal: 16),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: BorderSide.none,
                              ),
                            ),
                          ),
                          const SizedBox(height: 12),
                          Row(
                            children: [
                              _buildFilterChip("Semua (${_stations.length})", 'all'),
                              const SizedBox(width: 8),
                              _buildFilterChip("Huawei ($huaweiCount)", 'huawei'),
                              const SizedBox(width: 8),
                              _buildFilterChip("Kehua ($kehuaCount)", 'kehua'),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                "DAFTAR LOKASI (${_filteredStations.length})",
                                style: const TextStyle(
                                  color: Color(0xFF94A3B8),
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                  letterSpacing: 1.1,
                                ),
                              ),
                              const Text(
                                "Klik stasiun untuk detail",
                                style: TextStyle(color: Colors.white38, fontSize: 11),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),

                  _filteredStations.isEmpty
                      ? SliverToBoxAdapter(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 24),
                            child: Center(
                              child: Column(
                                children: [
                                  Icon(
                                    _statusMessage != null
                                        ? Icons.cloud_off_rounded
                                        : Icons.solar_power_outlined,
                                    color: Colors.white24,
                                    size: 48,
                                  ),
                                  const SizedBox(height: 12),
                                  Text(
                                    _statusMessage ?? "Belum ada stasiun yang cocok.",
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(color: Colors.white60, fontSize: 13),
                                  ),
                                  const SizedBox(height: 16),
                                  ElevatedButton.icon(
                                    onPressed: () => _loadData(),
                                    icon: const Icon(Icons.refresh_rounded, size: 18),
                                    label: const Text("Coba Muat Ulang"),
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: const Color(0xFF0D9488),
                                      foregroundColor: Colors.white,
                                      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
                                      shape: RoundedRectangleBorder(
                                        borderRadius: BorderRadius.circular(10),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        )
                      : SliverList(
                          delegate: SliverChildBuilderDelegate(
                            (context, index) {
                              final station = _filteredStations[index];
                              return StationCard(
                                station: station,
                                onTap: () => _openStationDetail(station),
                              );
                            },
                            childCount: _filteredStations.length,
                          ),
                        ),

                  const SliverToBoxAdapter(
                    child: SizedBox(height: 40),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _buildFilterChip(String label, String platformKey) {
    final isSelected = _selectedPlatform == platformKey;
    return GestureDetector(
      onTap: () => setState(() => _selectedPlatform = platformKey),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
        decoration: BoxDecoration(
          color: isSelected ? const Color(0xFF0D9488) : const Color(0xFF1E293B),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? const Color(0xFF14B8A6) : Colors.white10,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isSelected ? Colors.white : Colors.white70,
            fontSize: 12,
            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ),
    );
  }
}
