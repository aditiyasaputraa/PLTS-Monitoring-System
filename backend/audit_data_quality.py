import os
from pathlib import Path
from env_loader import load_env_file

env_path = Path(__file__).resolve().parent / ".env"
load_env_file(env_path)
from supabase import create_client

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SECRET_KEY")
client = create_client(url, key)
res = client.table("monitoring_current").select("updated_at, payload, summary").eq("id", 1).execute()

if not res.data:
    print("No data found in monitoring_current id 1")
    exit(1)

row = res.data[0]
print(f"LAST UPDATED: {row.get('updated_at')}")
print(f"SUMMARY: {row.get('summary')}")

payload = row.get("payload", {})
by_site = payload.get("by_site", {})

all_stations = []
issues = []

for site, sdata in by_site.items():
    stations = sdata.get("stations", [])
    print(f"\n==================== SITE: {site.upper()} ({len(stations)} stations) ====================")
    region_counts = {}
    for st in stations:
        name = st.get("name")
        reg = st.get("region")
        cap = st.get("capacity_kwp")
        pwr = st.get("current_power_kw")
        daily = st.get("daily_energy_kwh")
        monthly = st.get("monthly_energy_kwh")
        cum = st.get("cumulative_energy_kwh")
        lat = st.get("latitude")
        lng = st.get("longitude")
        
        region_counts[reg] = region_counts.get(reg, 0) + 1
        all_stations.append((site, st))
        
        # Check issues
        st_issues = []
        if not reg:
            st_issues.append("MISSING REGION")
        if cap is None:
            st_issues.append("MISSING CAPACITY")
        if lat is None or lng is None:
            st_issues.append("MISSING COORD")
        if daily is None:
            st_issues.append("MISSING DAILY ENERGY")
        if st_issues:
            issues.append(f"[{site}] {name}: {', '.join(st_issues)}")

    print(f"Region Distribution: {region_counts}")

print("\n==================== TOTAL REGIONAL BREAKDOWN ====================")
total_regions = {}
for site, st in all_stations:
    r = st.get("region") or "UNKNOWN"
    total_regions[r] = total_regions.get(r, 0) + 1

for r, count in sorted(total_regions.items()):
    print(f"  {r}: {count} stations")

print(f"\nTOTAL ALL STATIONS: {len(all_stations)}")

if issues:
    print(f"\n==================== FOUND {len(issues)} POTENTIAL ISSUES ====================")
    for issue in issues[:30]:
        print(f"  ! {issue}")
    if len(issues) > 30:
        print(f"  ... and {len(issues) - 30} more")
else:
    print("\nALL STATIONS HAVE COMPLETE REGIONS, COORDINATES, CAPACITY, AND ENERGY METRICS!")
