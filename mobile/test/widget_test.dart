import 'package:flutter_test/flutter_test.dart';
import 'package:plts_mobile/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('PLTS Mobile App smoke test', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const PltsMobileApp());
    await tester.pumpAndSettle();

    expect(find.text('Sign in to PLTS Monitor'), findsOneWidget);
    expect(find.text('Politeknik Negeri Jakarta'), findsOneWidget);
  });
}