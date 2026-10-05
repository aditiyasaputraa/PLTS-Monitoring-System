import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class UserModel {
  final String id;
  final String email;
  final String name;
  final String token;

  UserModel({
    required this.id,
    required this.email,
    required this.name,
    required this.token,
  });
}

class AuthService {
  static const String supabaseUrl = "https://hurtfiwuefjxfosvwbsj.supabase.co";
  static const String supabaseAnonKey =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cnRmaXd1ZWZqeGZvc3Z3YnNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5MjUwNTYsImV4cCI6MjEwNjUwMTA1Nn0.usLZoKGKfIqzeLYkJnOAXPZUsQC_pNOSR8gwfkMHYiw";

  static const String _keyUserId = 'auth_user_id';
  static const String _keyEmail = 'auth_user_email';
  static const String _keyName = 'auth_user_name';
  static const String _keyToken = 'auth_user_token';

  static UserModel? currentUser;

  static bool get isLoggedIn => currentUser != null;

  /// Memulihkan sesi login yang tersimpan di HP saat aplikasi baru dibuka
  static Future<bool> restoreSession() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString(_keyToken);
      final email = prefs.getString(_keyEmail);

      // Bersihkan jika sesi lama adalah akun demo
      if (token == null || token.isEmpty || token.startsWith('demo-') || (email != null && email.contains('demo'))) {
        await signOut();
        return false;
      }

      if (email != null && email.isNotEmpty) {
        currentUser = UserModel(
          id: prefs.getString(_keyUserId) ?? 'usr-stored',
          email: email,
          name: prefs.getString(_keyName) ?? email.split('@')[0],
          token: token,
        );
        return true;
      }
    } catch (_) {}
    currentUser = null;
    return false;
  }

  /// Login resmi ke Supabase Auth
  static Future<UserModel> signIn({
    required String email,
    required String password,
  }) async {
    final trimmed = email.trim();
    if (trimmed.isEmpty || password.isEmpty) {
      throw Exception("Silakan masukkan email/username dan password.");
    }

    // Format username lokal admin -> adminplts@sudinaker.go.id
    String formattedEmail = trimmed;
    if (!formattedEmail.contains('@')) {
      if (formattedEmail.toLowerCase() == 'admin' || formattedEmail.toLowerCase() == 'adminplts') {
        formattedEmail = 'adminplts@sudinaker.go.id';
      } else {
        formattedEmail = '$formattedEmail@sudinaker.go.id';
      }
    }

    try {
      final uri = Uri.parse('$supabaseUrl/auth/v1/token?grant_type=password');
      final response = await http.post(
        uri,
        headers: {
          'apikey': supabaseAnonKey,
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'email': formattedEmail,
          'password': password,
        }),
      ).timeout(const Duration(seconds: 10));

      final Map<String, dynamic> data = jsonDecode(response.body);

      if (response.statusCode == 200) {
        final accessToken = data['access_token'] ?? '';
        final userMap = data['user'] as Map<String, dynamic>? ?? {};
        final userMetadata = userMap['user_metadata'] as Map<String, dynamic>? ?? {};
        
        final name = userMetadata['name'] ??
            userMetadata['full_name'] ??
            formattedEmail.split('@')[0];

        final user = UserModel(
          id: userMap['id']?.toString() ?? 'usr-${DateTime.now().millisecondsSinceEpoch}',
          email: userMap['email']?.toString() ?? formattedEmail,
          name: name.toString(),
          token: accessToken.toString(),
        );

        currentUser = user;
        await _saveToStorage(user);
        return user;
      } else {
        final errorMsg = data['msg'] ?? data['error_description'] ?? data['message'] ?? 'Login gagal';
        if (errorMsg.toString().toLowerCase().contains('invalid login credentials')) {
          throw Exception("Email/username atau password salah. Silakan periksa kembali.");
        }
        throw Exception(errorMsg.toString());
      }
    } catch (e) {
      if (e is Exception) rethrow;
      throw Exception("Koneksi autentikasi gagal: ${e.toString()}");
    }
  }

  /// Keluar akun & bersihkan sesi di HP
  static Future<void> signOut() async {
    currentUser = null;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_keyUserId);
      await prefs.remove(_keyEmail);
      await prefs.remove(_keyName);
      await prefs.remove(_keyToken);
    } catch (_) {}
  }

  static Future<void> _saveToStorage(UserModel user) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_keyUserId, user.id);
      await prefs.setString(_keyEmail, user.email);
      await prefs.setString(_keyName, user.name);
      await prefs.setString(_keyToken, user.token);
    } catch (_) {}
  }
}
