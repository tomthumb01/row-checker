const https = require('https');
const http = require('http');

// Base forecast page (site-specific ID for Lyme Regis). We'll request per-date.
const LYME_REGIS_BASE = 'https://weather.metoffice.gov.uk/forecast/gcjbt4nsf';

function createError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const request = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(createError(res.statusCode, `Failed to fetch: ${res.statusCode}`));
        }
        resolve(body);
      });
    });
    request.on('error', (err) => reject(createError(502, `Request failed: ${err.message}`)));
    request.setTimeout(10000, () => {
      request.destroy();
      reject(createError(504, 'Request timeout'));
    });
  });
}

function extractNumberFromText(text) {
  if (!text) return null;
  const match = text.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function normalizeText(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseChance(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  if (trimmed.startsWith('<5')) return 5;
  const match = trimmed.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function parseHourLabel(label) {
  const match = String(label || '').trim().toLowerCase().match(/^(\d{1,2})(am|pm)$/);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const period = match[2];
  if (period === 'am') {
    return hour === 12 ? 0 : hour;
  }
  return hour === 12 ? 12 : hour + 12;
}

// Parse explicit values from one page of HTML (for a single date). Returns an object
// with fields set to numbers when found, otherwise null.
function parseSingleDayFromHtml(html, dateIso, label) {
  const text = normalizeText(html);
  const sourceNotes = [];
  let maxTemp = null;
  let minTemp = null;
  let wind = null;
  let gust = null;
  let rain = null;
  let direction = null;
  let onshoreRisk = null;

  // Temperatures (take first two numeric degree values if present)
  const maxTempMatch = text.match(/Maximum daytime temperature:\s*(\d+)\s+degrees\s+Celsius/i);
  if (maxTempMatch) {
    maxTemp = parseInt(maxTempMatch[1], 10);
    sourceNotes.push('max_temp');
  }

  const minTempMatch = text.match(/Minimum nighttime temperature:\s*(\d+)\s+degrees\s+Celsius/i);
  if (minTempMatch) {
    minTemp = parseInt(minTempMatch[1], 10);
    sourceNotes.push('min_temp');
  }

  const feelsMatch = text.match(/feels like temperature:\s*(\d+)\s+degrees\s+Celsius/i);
  const feelsLike = feelsMatch ? parseInt(feelsMatch[1], 10) : (minTemp != null ? minTemp - 2 : null);

  const windMatch = text.match(/Wind\s+speed\s+and\s+direction\s+([\s\S]*?)(?:Tides|Humidity|UV|Visibility|Sunrise and sunset|Air pollution|Pollen|Updated:)/i);
  if (windMatch) {
    sourceNotes.push('hourly_wind');
  }

  const gustMatch = text.match(/Daily\s+highest\s+gust\s+(\d+)\s*mph/i) || text.match(/Max gust\s+(\d+)\s*mph/i);
  if (gustMatch) {
    gust = parseInt(gustMatch[1], 10);
    sourceNotes.push('gust');
  }

  const rainMatch = text.match(/Chance of rain\s+(\d+)%/i) || text.match(/Light showers\s+(\d+)%/i);
  if (rainMatch) {
    rain = parseInt(rainMatch[1], 10);
    sourceNotes.push('precip');
  }

  const directionMatch = text.match(/from the\s+(north|south|east|west|northwest|northeast|southwest|southeast)/i);
  if (directionMatch) {
    direction = directionMatch[1].toLowerCase();
    sourceNotes.push('direction');
  }

  const riskMatch = text.match(/onshore|offshore|alongshore|cross-onshore|cross-offshore/i);
  if (riskMatch) {
    onshoreRisk = riskMatch[0].toLowerCase();
    sourceNotes.push('onshore_risk');
  }

  const hourlySectionMatch = text.match(/Hourly forecast\s+Time\s+([\s\S]*?)(?:\bMon\b|\bTue\b|\bWed\b|\bThu\b|\bFri\b|\bSat\b|\bSun\b)\s+Time\s+/i);
  const hourlySection = hourlySectionMatch ? hourlySectionMatch[1] : text;

  const hourMatches = [...hourlySection.matchAll(/\b(1[0-2]|0?\d)(?:am|pm)\b/ig)].map(m => m[0].toLowerCase());
  const tempMatches = [...hourlySection.matchAll(/\b(\d+)°\b/g)].map(m => parseInt(m[1], 10));
  const precipMatches = [...hourlySection.matchAll(/(<5%|\d+%)/g)].map(m => parseChance(m[1]));
  const windMatches = [...hourlySection.matchAll(/\b(\d+)mph\b/ig)].map(m => parseInt(m[1], 10));
  const feelsMatches = [...text.matchAll(/feels like temperature:\s*(\d+)\s+degrees\s+Celsius/ig)].map(m => parseInt(m[1], 10));

  const hourly = [];
  const maxHours = Math.min(hourMatches.length, windMatches.length || hourMatches.length);
  for (let i = 0; i < maxHours; i++) {
    const hourLabel = hourMatches[i];
    hourly.push({
      hour: parseHourLabel(hourLabel),
      time: hourLabel,
      wind_mph: windMatches[i] != null ? windMatches[i] : wind,
      gust_mph: gust,
      direction_from: direction,
      feels_like_c: feelsMatches[i] != null ? feelsMatches[i] : feelsLike,
      chance_of_rain_pct: precipMatches[i] != null ? precipMatches[i] : rain,
    });
  }

  if (!hourly.length && feelsLike != null) {
    hourly.push({
      time: '12pm',
      wind_mph: wind,
      gust_mph: gust,
      direction_from: direction,
      feels_like_c: feelsLike,
      chance_of_rain_pct: rain,
    });
  }

  if (hourly.length) {
    const windValues = hourly.map(item => item.wind_mph).filter(value => Number.isFinite(value));
    const precipValues = hourly.map(item => item.chance_of_rain_pct).filter(value => Number.isFinite(value));
    const directionValues = hourly.map(item => item.direction_from).filter(Boolean);
    const feelsValues = hourly.map(item => item.feels_like_c).filter(value => Number.isFinite(value));

    if (windValues.length) {
      wind = Math.max(...windValues);
      sourceNotes.push('wind');
    }
    if (!Number.isFinite(rain) && precipValues.length) {
      rain = Math.max(...precipValues);
    }
    if (!direction && directionValues.length) {
      direction = directionValues[0];
    }
    if (feelsValues.length && !Number.isFinite(feelsLike)) {
      const minFeels = Math.min(...feelsValues);
      if (minTemp == null) {
        minTemp = Math.min(...feelsValues);
      }
    }
  }

  const tides = [];
  const tideMatches = [...text.matchAll(/(low|high) tide\s+(\d{1,2}:\d{2}(?:am|pm)?)\s+([\d.]+)\s+metres/ig)];
  for (const match of tideMatches) {
    tides.push({
      type: match[1].toLowerCase(),
      time: match[2].toLowerCase(),
      metres: parseFloat(match[3]),
    });
  }

  return {
    label: label,
    date_iso: dateIso,
    max_temp_c: maxTemp,
    min_temp_c: minTemp,
    min_temp_feels_like_c: feelsLike,
    max_wind_mph: wind,
    max_gust_mph: gust,
    max_precip_pct: rain,
    dominant_direction_text: direction,
    onshore_risk: onshoreRisk,
    hourly: hourly,
    tides: tides,
    source_notes: sourceNotes
  };
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

  try {
    const today = new Date();
    const labels = ['Today', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed'];
    const days = [];

    for (let i = 0; i < 7; i++) {
      const dateObj = new Date(today);
      dateObj.setDate(dateObj.getDate() + i);
      const dateIso = dateObj.toISOString().slice(0, 10);

      // Prefer using a query param so the server-side request can include the date.
      const urlWithQuery = `${LYME_REGIS_BASE}?date=${dateIso}`;
      let html = null;
      try {
        html = await fetchPage(urlWithQuery);
      } catch (e) {
        // If query param doesn't work, try fragment form as a fallback.
        try {
          html = await fetchPage(`${LYME_REGIS_BASE}#?date=${dateIso}`);
        } catch (errFetch) {
          // If fetch for this date fails, push a day entry with nulls and continue.
          days.push({
            label: labels[i] || `Day ${i}`,
            date_iso: dateIso,
            max_temp_c: null,
            min_temp_c: null,
            min_temp_feels_like_c: null,
            max_wind_mph: null,
            max_gust_mph: null,
            max_precip_pct: null,
            dominant_direction_text: null,
            onshore_risk: null,
            hourly: [],
            tides: [],
            source_notes: ['fetch_failed']
          });
          continue;
        }
      }

      const day = parseSingleDayFromHtml(html, dateIso, labels[i] || `Day ${i}`);
      days.push(day);
    }

    const now = new Date();
    const updatedText = `Met Office forecast updated ${now.toLocaleTimeString('en-GB')}`;

    context.res = {
      status: 200,
      body: {
        source: 'Met Office Lyme Regis Forecast (web scraped)',
        updated_text: updatedText,
        days: days.slice(0, 8),
      },
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    };
  } catch (err) {
    context.log && context.log.error && context.log.error(err);
    context.res = {
      status: err.statusCode || 500,
      body: {
        error: err.message || 'Unable to fetch Met Office forecast',
      },
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    };
  }
};
