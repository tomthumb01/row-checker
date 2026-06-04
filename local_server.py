import http.server
import json
import os
import re
import socketserver
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

PORT = 8000
BASE_URL = 'https://weather.metoffice.gov.uk/forecast/gcjbt4nsf'
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36'


def fetch_page(url):
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(request, timeout=20) as response:
        charset = response.headers.get_content_charset() or 'utf-8'
        return response.read().decode(charset, errors='replace')


def normalize_text(html):
    text = re.sub(r'<script[^>]*>.*?</script>', ' ', html, flags=re.S | re.I)
    text = re.sub(r'<style[^>]*>.*?</style>', ' ', text, flags=re.S | re.I)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = text.replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', text).strip()


def parse_chance(text):
    if not text:
        return None
    if text.strip().startswith('<5'):
        return 5
    match = re.search(r'(\d+)%', text)
    return int(match.group(1)) if match else None


def parse_hour_label(hour_label):
    match = re.match(r'^(\d{1,2})(am|pm)$', hour_label.strip().lower())
    if not match:
        return None
    hour = int(match.group(1))
    period = match.group(2)
    if period == 'am':
        return 0 if hour == 12 else hour
    return 12 if hour == 12 else hour + 12


def parse_single_day(html, date_iso, label):
    text = normalize_text(html)
    source_notes = []

    max_temp = None
    min_temp = None
    feels_like = None
    wind = None
    gust = None
    rain = None
    direction = None
    onshore_risk = None

    max_temp_match = re.search(r'Maximum daytime temperature:\s*(\d+)\s*degrees\s*Celsius', text, re.I)
    if max_temp_match:
        max_temp = int(max_temp_match.group(1))
        source_notes.append('max_temp')

    min_temp_match = re.search(r'Minimum nighttime temperature:\s*(\d+)\s*degrees\s*Celsius', text, re.I)
    if min_temp_match:
        min_temp = int(min_temp_match.group(1))
        source_notes.append('min_temp')

    feels_match = re.search(r'feels like temperature:\s*(\d+)\s*degrees\s*Celsius', text, re.I)
    if feels_match:
        feels_like = int(feels_match.group(1))
        source_notes.append('feels_like')

    gust_match = re.search(r'(?:Daily highest gust|Max gust)\s*(\d+)\s*mph', text, re.I)
    if gust_match:
        gust = int(gust_match.group(1))
        source_notes.append('gust')

    rain_match = re.search(r'Chance of rain\s*(\d+)%', text, re.I)
    if rain_match:
        rain = int(rain_match.group(1))
        source_notes.append('precip')

    direction_match = re.search(r'from the\s+(north|south|east|west|northwest|northeast|southwest|southeast)', text, re.I)
    if direction_match:
        direction = direction_match.group(1).lower()
        source_notes.append('direction')

    risk_match = re.search(r'cross-onshore|cross-offshore|alongshore|onshore|offshore', text, re.I)
    if risk_match:
        onshore_risk = risk_match.group(0).lower()
        source_notes.append('onshore_risk')

    hourly_section = text
    hour_labels = [m.group(0).lower() for m in re.finditer(r'\b(1[0-2]|0?\d)(?:am|pm)\b', hourly_section, re.I)]
    wind_values = [int(m.group(1)) for m in re.finditer(r'\b(\d+)mph\b', hourly_section, re.I)]
    precip_values = [parse_chance(m.group(1)) for m in re.finditer(r'(<5%|\d+%)', hourly_section, re.I)]

    feels_values = [int(m.group(1)) for m in re.finditer(r'feels like temperature:\s*(\d+)\s*degrees\s*Celsius', text, re.I)]

    hourly = []
    max_hours = min(len(hour_labels), max(len(wind_values), len(precip_values)))
    for i in range(max_hours):
        hour_label = hour_labels[i] if i < len(hour_labels) else None
        hourly.append({
            'hour': parse_hour_label(hour_label) if hour_label else None,
            'time': hour_label or None,
            'wind_mph': wind_values[i] if i < len(wind_values) else wind,
            'gust_mph': gust,
            'direction_from': direction,
            'feels_like_c': feels_values[i] if i < len(feels_values) else feels_like,
            'chance_of_rain_pct': precip_values[i] if i < len(precip_values) else rain,
        })

    if not hourly and (wind is not None or gust is not None or rain is not None or feels_like is not None):
        hourly.append({
            'hour': 12,
            'time': '12pm',
            'wind_mph': wind,
            'gust_mph': gust,
            'direction_from': direction,
            'feels_like_c': feels_like,
            'chance_of_rain_pct': rain,
        })

    if hourly:
        wind_values = [item['wind_mph'] for item in hourly if item.get('wind_mph') is not None]
        precip_values = [item['chance_of_rain_pct'] for item in hourly if item.get('chance_of_rain_pct') is not None]
        direction_values = [item['direction_from'] for item in hourly if item.get('direction_from')]
        feels_values = [item['feels_like_c'] for item in hourly if item.get('feels_like_c') is not None]

        if wind_values:
            wind = max(wind_values)
            if 'wind' not in source_notes:
                source_notes.append('wind')
        if rain is None and precip_values:
            rain = max(precip_values)
        if not direction and direction_values:
            direction = direction_values[0]
        if feels_values and feels_like is None:
            feels_like = min(feels_values)
            if 'feels_like' not in source_notes:
                source_notes.append('feels_like')

    tides = []
    for match in re.finditer(r'(low|high)\s+tide\s+(\d{1,2}:\d{2}(?:am|pm)?)\s+([\d.]+)\s*(?:metres|m)\b', text, re.I):
        tides.append({
            'type': match.group(1).lower(),
            'time': match.group(2).lower(),
            'metres': float(match.group(3)),
        })

    return {
        'label': label,
        'date_iso': date_iso,
        'max_temp_c': max_temp,
        'min_temp_c': min_temp,
        'min_temp_feels_like_c': feels_like if feels_like is not None else (min_temp - 2 if min_temp is not None else None),
        'max_wind_mph': wind,
        'max_gust_mph': gust,
        'max_precip_pct': rain,
        'dominant_direction_text': direction,
        'onshore_risk': onshore_risk,
        'hourly': hourly,
        'tides': tides,
        'source_notes': source_notes,
    }


def build_forecast():
    today = datetime.utcnow().date()
    labels = ['Today', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']
    days = []

    for i in range(7):
        date_obj = today + timedelta(days=i)
        date_iso = date_obj.isoformat()
        url = f'{BASE_URL}?date={date_iso}'
        try:
            html = fetch_page(url)
        except urllib.error.HTTPError:
            url = f'{BASE_URL}#?date={date_iso}'
            html = fetch_page(url)
        day = parse_single_day(html, date_iso, labels[i])
        days.append(day)

    updated_text = f'Met Office forecast updated {datetime.utcnow().strftime("%H:%M UTC")}'
    return {
        'source': 'Met Office Lyme Regis Forecast (Python local server)',
        'updated_text': updated_text,
        'days': days,
    }


class LocalRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/api/metoffice-forecast.json':
            self.handle_forecast()
        else:
            return super().do_GET()

    def handle_forecast(self):
        try:
            forecast = build_forecast()
            body = json.dumps(forecast, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(exc)}).encode('utf-8'))


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)) or '.')
    with socketserver.ThreadingTCPServer(('127.0.0.1', PORT), LocalRequestHandler) as httpd:
        print(f'Local server running at http://127.0.0.1:{PORT}')
        print('Open that URL in your browser to run the full app and fetch live Met Office data.')
        httpd.serve_forever()
