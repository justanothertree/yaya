# The Sun path toy's reference table: src/gpu/sun.reference.json.
#
# Run OUTSIDE the repository's toolchain — it is not part of any build, test or install, and astral
# is deliberately not a dependency of this project:
#   python3 -m venv /tmp/sunref && /tmp/sunref/bin/pip install astral==3.2
#   /tmp/sunref/bin/python -I scripts/sun-reference.py > src/gpu/sun.reference.json.rows
# then wrap the printed rows as the JSON file's "rows". It exists so the reference can be checked and
# regenerated, and so the test is against an implementation that shares no code with src/gpu/sun.ts:
# astral's NOAA/Meeus solar position and Python's own zoneinfo copy of the IANA database.
#
# The place list must match PLACES in src/gpu/sun.ts; sun.test.ts fails if a place is missing.
import json, datetime as dt
from zoneinfo import ZoneInfo
from astral import Observer
from astral.sun import sunrise, sunset
P = [('Longyearbyen',78.2,15.65,'Arctic/Longyearbyen'),('Tromsø',69.6,18.96,'Europe/Oslo'),('Reykjavík',64.1,-21.94,'Atlantic/Reykjavik'),('Edinburgh',55.95,-3.19,'Europe/London'),('London',51.5,-0.13,'Europe/London'),('New York',40.7,-74.01,'America/New_York'),('Lisbon',38.7,-9.14,'Europe/Lisbon'),('Cairo',30.0,31.24,'Africa/Cairo'),('Mumbai',19.1,72.88,'Asia/Kolkata'),('Singapore',1.35,103.82,'Asia/Singapore'),('Quito',-0.2,-78.47,'America/Guayaquil'),('Lima',-12.0,-77.04,'America/Lima'),('Sydney',-33.9,151.21,'Australia/Sydney'),('Cape Town',-33.9,18.42,'Africa/Johannesburg'),('Ushuaia',-54.8,-68.3,'America/Argentina/Ushuaia')]
dates = [(1,15),(3,20),(5,10),(6,21),(8,5),(9,22),(11,8),(12,21)]
# each zone's clock-change days in 2026 and the day after
extra = {'Europe/London':[(3,29),(3,30),(10,25),(10,26)],'Europe/Lisbon':[(3,29),(10,25)],'Europe/Oslo':[(3,29),(10,25)],'Arctic/Longyearbyen':[(3,29)],
 'America/New_York':[(3,8),(3,9),(11,1),(11,2)],'Australia/Sydney':[(4,5),(4,6),(10,4),(10,5)],'Africa/Cairo':[(4,24),(4,25),(10,29),(10,30)]}
out = []
for name, lat, lon, tz in P:
    z = ZoneInfo(tz); ob = Observer(latitude=lat, longitude=lon)
    for m, d in dates + extra.get(tz, []):
        day = dt.date(2026, m, d)
        row = {'place': name, 'month': m, 'date': d}
        for k, f in (('rise', sunrise), ('set', sunset)):
            try:
                t = f(ob, day, tzinfo=z)
                # hours on the local clock, counted from that day's local midnight (so 24.05 = 00:03 next day)
                row[k] = round((t.replace(tzinfo=None) - dt.datetime(2026, m, d)).total_seconds() / 3600, 4)
                row[k + 'Off'] = t.utcoffset().total_seconds() / 3600
            except ValueError:
                row[k] = None
        if row['rise'] is not None and row['set'] is not None and row['set'] < row['rise']:
            t = sunset(ob, day + dt.timedelta(days=1), tzinfo=z)
            row['set'] = round((t.replace(tzinfo=None) - dt.datetime(2026, m, d)).total_seconds() / 3600, 4)
            row['setOff'] = t.utcoffset().total_seconds() / 3600
        out.append(row)
print(json.dumps(out))
