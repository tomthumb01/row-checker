const https = require('https');
const { URL } = require('url');

const METOFFICE_API_KEY = process.env.METOFFICE_APIKEY;
const FORECAST_HOST = 'data.hub.api.metoffice.gov.uk';
const FORECAST_PATH = '/sitespecific/v0/point/hourly';
const DEFAULT_LATITUDE = '50.72';
const DEFAULT_LONGITUDE = '-2.96';

function createError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function safeNumber(value) {
  if (value == null || value === '' || value === 'null' || value === 'undefined') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.values)) return raw.values;
  return null;
}

function normalizeTimeKey(timeSeries) {
  const keys = Object.keys(timeSeries || {});
  const timeKey = keys.find(k => /time/i.test(k));
  if (timeKey) return timeKey;
  return keys.find(k => Array.isArray(asArray(timeSeries[k])) && asArray(timeSeries[k]).every(v => typeof v === 'string')) || null;
}

function parseDirectionDegrees(value) {
  const deg = safeNumber(value);
  if (deg == null || Number.isNaN(deg)) return null;
  const normalized = ((deg % 360) + 360) % 360;
  return normalized;
}

function degreesToCardinal(deg) {
  if (deg == null) return 'unknown';
  const cardinals = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(deg / 22.5) % 16;
  return cardinals[index];
}

function getParamValue(row, names) {
  for (const name of names) {
    if (row[name] != null) return row[name];
  }
  return null;
}

function convertWindToMph(value, unit) {
  const number = safeNumber(value);
  if (number == null) return null;
  if (!unit || typeof unit !== 'string') return number;
  const normalized = unit.toLowerCase();
  if (normalized.includes('m/s') || normalized.includes('m per s')) return number * 2.2369362920544;
  if (normalized.includes('km/h')) return number * 0.62137119223733;
  if (normalized.includes('kt') || normalized.includes('knot')) return number * 1.1507794480235;
  return number;
}

function ensurePercent(value, unit) {
  const num = safeNumber(value);
  if (num == null) return null;
  if (!unit || typeof unit !== 'string') {
    if (num <= 1) return num * 100;
    return num;
  }
  const lower = unit.toLowerCase();
  if (lower.includes('%') || lower.includes('percent')) return num;
  if (num <= 1) return num * 100;
  return num;
}

function buildParameterUnits(parameters) {
  const units = {};
  if (!Array.isArray(parameters)) return units;
  for (const paramMeta of parameters) {
    if (paramMeta && typeof paramMeta === 'object') {
      for (const [name, metadata] of Object.entries(paramMeta)) {
        if (metadata && typeof metadata === 'object' && metadata.unit) {
          units[name] = String(metadata.unit);
        }
      }
    }
  }
  return units;
}

function createRowTime(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  return {
    date,
    iso: date.toISOString(),
    day: date.toISOString().slice(0, 10),
    hour: date.getUTCHours(),
  };
}

function buildHourEntry(row, units) {
  const directionRaw = getParamValue(row, ['wind_direction', 'wind_from_direction', 'direction', 'direction_of_wind']);
  const directionDegrees = parseDirectionDegrees(directionRaw);
  const directionText = typeof row.wind_direction_text === 'string'
    ? row.wind_direction_text
    : degreesToCardinal(directionDegrees);

  const temp = getParamValue(row, ['air_temperature', 'temperature', 'temp', 'air_temp', 't']);
  const feelsLike = getParamValue(row, ['feels_like_temperature', 'feels_like', 'apparent_temperature', 'air_temperature']);
  const wind = getParamValue(row, ['wind_speed', 'wind_speed_mean', 'wind_speed_10m', 'wind_speed_2m']);
  const gust = getParamValue(row, ['wind_gust', 'wind_speed_gust', 'wind_gust_speed']);
  const precip = getParamValue(row, ['probability_of_precipitation', 'precipitation_probability', 'rain_probability', 'precipitation_chance', 'poa', 'rainfall_probability']);

  return {
    hour: row.hour,
    temp_c: safeNumber(temp),
    feels_like_c: safeNumber(feelsLike),
    wind_mph: convertWindToMph(wind, units['wind_speed'] || units['wind_speed_mean'] || units['wind_speed_10m'] || units['wind_speed_2m']),
    gust_mph: convertWindToMph(gust, units['wind_gust'] || units['wind_speed_gust'] || units['wind_gust_speed']),
    precip_pct: ensurePercent(precip, units['probability_of_precipitation'] || units['precipitation_probability'] || units['rain_probability'] || units['precipitation_chance']),
    wind_direction_degrees: directionDegrees,
    wind_direction_text: directionText,
  };
}

function aggregateDay(dayRows, units) {
  const temps = dayRows.map(r => safeNumber(getParamValue(r, ['air_temperature', 'temperature', 'temp', 'air_temp', 't']))).filter(v => v != null);
  const feels = dayRows.map(r => safeNumber(getParamValue(r, ['feels_like_temperature', 'feels_like', 'apparent_temperature', 'air_temperature']))).filter(v => v != null);
  const winds = dayRows.map(r => convertWindToMph(getParamValue(r, ['wind_speed', 'wind_speed_mean', 'wind_speed_10m', 'wind_speed_2m']), units['wind_speed'] || units['wind_speed_mean'] || units['wind_speed_10m'] || units['wind_speed_2m'])).filter(v => v != null);
  const gusts = dayRows.map(r => convertWindToMph(getParamValue(r, ['wind_gust', 'wind_speed_gust', 'wind_gust_speed']), units['wind_gust'] || units['wind_speed_gust'] || units['wind_gust_speed'])).filter(v => v != null);
  const precips = dayRows.map(r => ensurePercent(getParamValue(r, ['probability_of_precipitation', 'precipitation_probability', 'rain_probability', 'precipitation_chance', 'poa', 'rainfall_probability']), units['probability_of_precipitation'] || units['precipitation_probability'] || units['rain_probability'] || units['precipitation_chance'])).filter(v => v != null);
  const directions = dayRows.map(r => parseDirectionDegrees(getParamValue(r, ['wind_direction', 'wind_from_direction', 'direction', 'direction_of_wind']))).filter(v => v != null);

  const dayLabel = (dateIso) => {
    const date = new Date(dateIso + 'T00:00:00Z');
    const now = new Date();
    if (date.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) return 'Today';
    return date.toLocaleDateString('en-GB', { weekday: 'short' });
  };

  const directionDegrees = directions.length ? directions[Math.floor(directions.length / 2)] : null;
  const directionText = degreesToCardinal(directionDegrees);

  return {
    max_temp_c: temps.length ? Math.max(...temps) : null,
    min_temp_c: temps.length ? Math.min(...temps) : null,
    min_temp_feels_like_c: feels.length ? Math.min(...feels) : null,
    max_wind_mph: winds.length ? Math.max(...winds) : null,
    max_gust_mph: gusts.length ? Math.max(...gusts) : null,
    max_precip_pct: precips.length ? Math.max(...precips) : null,
    dominant_direction_text: directionText,
    onshore_risk: 'unknown',
    source_notes: ['hourly data']
  };
}

function groupHourlyRecords(features, parameters) {
  if (!features || !features.length) return [];
  const feature = features[0];
  const timeSeries = feature.properties && feature.properties.timeSeries;
  if (!timeSeries || typeof timeSeries !== 'object') return [];
  const timeKey = normalizeTimeKey(timeSeries);
  if (!timeKey) return [];

  const units = buildParameterUnits(parameters);
  const timeValues = asArray(timeSeries[timeKey]) || [];
  const rowCount = timeValues.length;
  const rows = [];
  const seriesKeys = Object.keys(timeSeries).filter(key => key !== timeKey);

  for (let i = 0; i < rowCount; i++) {
    const timestamp = String(timeValues[i]);
    const timeInfo = createRowTime(timestamp);
    if (!timeInfo) continue;
    const row = {
      time: timeInfo.iso,
      day: timeInfo.day,
      hour: timeInfo.hour,
    };
    for (const key of seriesKeys) {
      row[key] = asArray(timeSeries[key])?.[i] ?? null;
    }
    rows.push(row);
  }

  const buckets = rows.reduce((acc, row) => {
    if (!row.day) return acc;
    if (!acc[row.day]) acc[row.day] = [];
    acc[row.day].push(row);
    return acc;
  }, {});

  return Object.entries(buckets).map(([dateIso, dayRows]) => {
    const aggregated = aggregateDay(dayRows, units);
    const label = (new Date(dateIso + 'T00:00:00Z')).toLocaleDateString('en-GB', { weekday: 'short' });
    const hourly = dayRows.map(row => ({ ...buildHourEntry(row, units), hour: row.hour })).sort((a, b) => a.hour - b.hour);
    return {
      label: dayRows[0].day === (new Date().toISOString().slice(0, 10)) ? 'Today' : label,
      date_iso: dateIso,
      ...aggregated,
      hourly,
    };
  });
}

function fetchForecast(latitude = DEFAULT_LATITUDE, longitude = DEFAULT_LONGITUDE) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://${FORECAST_HOST}${FORECAST_PATH}`);
    url.searchParams.set('latitude', latitude);
    url.searchParams.set('longitude', longitude);
    url.searchParams.set('dataSource', 'BD1');
    url.searchParams.set('includeLocationName', 'true');

    const options = {
      headers: {
        apikey: METOFFICE_API_KEY,
        Accept: 'application/json',
      },
    };

    const req = https.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(createError(res.statusCode, `Met Office API returned ${res.statusCode}: ${body.slice(0, 200)}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(createError(502, `Unable to parse Met Office response: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => reject(createError(502, `Met Office request failed: ${err.message}`)));
    req.end();
  });
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    };
    return;
  }

  if (!METOFFICE_API_KEY) {
    context.res = {
      status: 500,
      body: {
        error: 'METOFFICE_APIKEY is not configured on the server. Set the Met Office API key as an environment variable.',
      },
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    };
    return;
  }

  try {
    const rawForecast = await fetchForecast();
    const features = rawForecast.features || [];
    const days = groupHourlyRecords(features, rawForecast.parameters || []);
    const updatedText = (features[0] && features[0].properties && features[0].properties.modelRunDate)
      ? `Met Office model run ${features[0].properties.modelRunDate}`
      : 'Met Office site-specific forecast';

    context.res = {
      status: 200,
      body: {
        source: 'Met Office Site Specific Forecast',
        updated_text: updatedText,
        days,
      },
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    };
  } catch (err) {
    context.log && context.log.error(err);
    context.res = {
      status: err.statusCode || 500,
      body: {
        error: err.message || 'Unexpected error fetching Met Office forecast',
      },
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    };
  }
};
