const DEFAULT_THRESHOLDS = {
  wind_amber: 16,
  wind_red: 22,
  gust_amber: 26,
  gust_red: 32,
  rain_amber: 60,
  rain_red: 85,
  cold_amber: 8,
  cold_red: 4,
  wave_amber: 1.0,
  wave_red: 1.5,
  visibility_amber: 5,
  visibility_red: 2,
};

const els = {
  refreshBtn: document.getElementById('refreshBtn'),
  daySelect: document.getElementById('daySelect'),
  hourRange: document.getElementById('hourRange'),
  hourLabel: document.getElementById('hourLabel'),
  daysGrid: document.getElementById('daysGrid'),
  waveInput: document.getElementById('waveInput'),
  visibilityInput: document.getElementById('visibilityInput'),
  tideRiskSelect: document.getElementById('tideRiskSelect'),
  crewExperienceSelect: document.getElementById('crewExperienceSelect'),
  resetThresholdsBtn: document.getElementById('resetThresholdsBtn'),
  checkBtn: document.getElementById('checkBtn'),
  resultCard: document.getElementById('resultCard'),
  resultBand: document.getElementById('resultBand'),
  resultScore: document.getElementById('resultScore'),
  resultHeadline: document.getElementById('resultHeadline'),
  metricsGrid: document.getElementById('metricsGrid'),
  lastUpdatedChip: document.getElementById('lastUpdatedChip'),
  loadingIndicator: document.getElementById('loadingIndicator'),
  loadingText: document.getElementById('loadingText'),
  summaryTab: document.getElementById('tab-summary'),
  reasonsTab: document.getElementById('tab-reasons'),
  policyTab: document.getElementById('tab-policy')
};

let state = {
  forecast: null,
  selectedDayLabel: null,
  selectedHour: 10,
};

function formatDate(iso) {
  if (!iso) return 'Date not parsed';
  const d = new Date(iso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatHourLabel(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function getForecastAtHour(day, hour) {
  if (!day) return null;
  const hourly = Array.isArray(day.hourly) && day.hourly.length ? day.hourly : (Array.isArray(day.hours) ? day.hours : []);
  if (hourly.length) {
    const selected = hourly.find(h => h.hour === hour) || hourly[0];
    return {
      ...day,
      ...selected,
      max_wind_mph: selected.wind_mph ?? day.max_wind_mph,
      max_gust_mph: selected.gust_mph ?? day.max_gust_mph,
      max_precip_pct: selected.chance_of_rain_pct ?? day.max_precip_pct,
      min_temp_feels_like_c: selected.feels_like_c ?? day.min_temp_feels_like_c,
      dominant_direction_text: selected.direction_from ?? day.dominant_direction_text,
      onshore_risk: selected.onshore_risk ?? day.onshore_risk,
    };
  }
  return day;
}

function setThresholdInputs(values) {
  document.querySelectorAll('.threshold').forEach(input => {
    const key = input.dataset.key;
    input.value = values[key];
  });
}

function getThresholds() {
  const out = {};
  document.querySelectorAll('.threshold').forEach(input => {
    out[input.dataset.key] = Number(input.value);
  });
  return out;
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function renderDays() {
  const days = state.forecast?.days || [];
  els.daySelect.innerHTML = '';
  els.daysGrid.innerHTML = '';
  days.forEach(day => {
    const option = document.createElement('option');
    option.value = day.label;
    option.textContent = `${day.label} • ${formatDate(day.date_iso)}`;
    els.daySelect.appendChild(option);

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'day-card' + (state.selectedDayLabel === day.label ? ' active' : '');
    card.innerHTML = `
      <div class="day-label">${escapeHtml(day.label)}</div>
      <div class="day-date">${escapeHtml(formatDate(day.date_iso))}</div>
      <div class="day-mini">Wind: ${day.max_wind_mph ?? '–'} mph<br>Gust: ${day.max_gust_mph ?? '–'} mph<br>Rain: ${day.max_precip_pct ?? '–'}%</div>
    `;
    card.addEventListener('click', () => {
      state.selectedDayLabel = day.label;
      els.daySelect.value = day.label;
      renderDays();
      renderSelectedDaySummary();
      runCheck();
    });
    els.daysGrid.appendChild(card);
  });
  if (state.selectedDayLabel) els.daySelect.value = state.selectedDayLabel;
}

function getSelectedDay() {
  return state.forecast?.days?.find(d => d.label === state.selectedDayLabel) || null;
}

function metric(label, value, sub = '') {
  return `
    <div class="metric">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
      ${sub ? `<div class="metric-sub">${escapeHtml(sub)}</div>` : ''}
    </div>
  `;
}

function renderSelectedDaySummary() {
  const day = getSelectedDay();
  if (!day) {
    els.summaryTab.innerHTML = '<p>No forecast loaded yet.</p>';
    return;
  }
  const forecastAtHour = getForecastAtHour(day, state.selectedHour);
  const hourly = Array.isArray(day.hourly) && day.hourly.length ? day.hourly : (Array.isArray(day.hours) ? day.hours : []);
  const tideItems = Array.isArray(day.tides) && day.tides.length
    ? day.tides.map(tide => `<li><strong>${escapeHtml(tide.type.toUpperCase())} tide:</strong> ${escapeHtml(tide.time)} at ${escapeHtml(String(tide.metres))} metres</li>`).join('')
    : '<li>No tide data parsed.</li>';
  const hourlyItems = hourly.length
    ? hourly.map(hour => `<li><strong>${escapeHtml(hour.time || '—')}</strong> - Wind ${escapeHtml(String(hour.wind_mph ?? 'Not parsed'))} mph, gust ${escapeHtml(String(hour.gust_mph ?? 'Not parsed'))} mph, feels like ${escapeHtml(String(hour.feels_like_c ?? 'Not parsed'))}°C, rain ${escapeHtml(String(hour.chance_of_rain_pct ?? 'Not parsed'))}%, direction ${escapeHtml(hour.direction_from || 'Not parsed')}</li>`).join('')
    : '<li>No hourly data parsed.</li>';
  els.summaryTab.innerHTML = `
    <ul class="info-list">
      <li><strong>Day:</strong> ${escapeHtml(day.label)} (${escapeHtml(formatDate(day.date_iso))})</li>
      <li><strong>Selected time:</strong> ${escapeHtml(formatHourLabel(state.selectedHour))}${!hourly.length ? ' (daily peak values shown)' : ''}</li>
      <li><strong>Max temperature:</strong> ${forecastAtHour.max_temp_c ?? 'Not parsed'}°C</li>
      <li><strong>Min temperature:</strong> ${forecastAtHour.min_temp_c ?? 'Not parsed'}°C</li>
      <li><strong>Min feels-like:</strong> ${forecastAtHour.min_temp_feels_like_c ?? 'Not parsed'}°C</li>
      <li><strong>Max sustained wind:</strong> ${forecastAtHour.max_wind_mph ?? 'Not parsed'} mph</li>
      <li><strong>Max gust:</strong> ${forecastAtHour.max_gust_mph ?? 'Not parsed'} mph</li>
      <li><strong>Max precipitation chance:</strong> ${forecastAtHour.max_precip_pct ?? 'Not parsed'}%</li>
      <li><strong>Direction / beach hint:</strong> ${escapeHtml(forecastAtHour.dominant_direction_text || day.dominant_direction_text || 'Not parsed')}</li>
      <li><strong>Interpreted direction risk:</strong> ${escapeHtml(forecastAtHour.onshore_risk || day.onshore_risk || 'unknown')}</li>
      <li><strong>Parsed data fields:</strong> ${escapeHtml((day.source_notes || []).join(', ') || 'very limited')}</li>
    </ul>
    <div class="summary-subsection">
      <h3>Hourly forecast</h3>
      <ul class="info-list">${hourlyItems}</ul>
    </div>
    <div class="summary-subsection">
      <h3>Tides</h3>
      <ul class="info-list">${tideItems}</ul>
    </div>
  `;
}

function detectOnshoreRisk(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('cross-onshore')) return 'cross-onshore';
  if (/onshore/.test(t)) return 'onshore';
  if (t.includes('alongshore')) return 'alongshore';
  if (t.includes('offshore')) return 'offshore';
  return 'unknown';
}

function classifyLikelihood(day, thresholds, waveHeight, visibilityKm, tideRisk, crewExperience) {
  let score = 100;
  const blockers = [];
  const cautions = [];
  const positives = [];

  const applyPenalty = (points, reason, level = 'caution') => {
    score -= points;
    (level === 'blocker' ? blockers : cautions).push(reason);
  };

  if (day.max_wind_mph != null) {
    if (day.max_wind_mph >= thresholds.wind_red) applyPenalty(30, `Sustained wind peaks around ${day.max_wind_mph} mph (red threshold ${thresholds.wind_red} mph)`, 'blocker');
    else if (day.max_wind_mph >= thresholds.wind_amber) applyPenalty(16, `Sustained wind peaks around ${day.max_wind_mph} mph (amber threshold ${thresholds.wind_amber} mph)`);
    else positives.push(`Sustained wind looks manageable at roughly ${day.max_wind_mph} mph.`);
  }

  if (day.max_gust_mph != null) {
    if (day.max_gust_mph >= thresholds.gust_red) applyPenalty(30, `Wind gusts peak around ${day.max_gust_mph} mph (red threshold ${thresholds.gust_red} mph)`, 'blocker');
    else if (day.max_gust_mph >= thresholds.gust_amber) applyPenalty(14, `Wind gusts peak around ${day.max_gust_mph} mph (amber threshold ${thresholds.gust_amber} mph)`);
    else positives.push(`Wind gusts stay below the current amber threshold at about ${day.max_gust_mph} mph.`);
  }

  const risk = day.onshore_risk || detectOnshoreRisk(day.dominant_direction_text);
  if (risk === 'onshore' || risk === 'cross-onshore') {
    if ((day.max_wind_mph || 0) >= thresholds.wind_amber - 2) applyPenalty(20, `Wind direction appears ${risk}, which is more challenging near the beach in stronger winds.`, 'blocker');
    else applyPenalty(10, `Wind direction appears ${risk}; beach launch/return could be less forgiving.`);
  } else if (risk === 'alongshore') {
    applyPenalty(6, 'Wind direction appears alongshore, which may still need cox judgement at the waterside.');
  } else if (risk === 'offshore') {
    positives.push('Direction looks more offshore/cross-offshore than onshore.');
  }

  if (day.max_precip_pct != null) {
    if (day.max_precip_pct >= thresholds.rain_red) applyPenalty(12, `Precipitation risk peaks around ${day.max_precip_pct}% indicating very unsettled conditions.`);
    else if (day.max_precip_pct >= thresholds.rain_amber) applyPenalty(6, `Precipitation risk peaks around ${day.max_precip_pct}%.`);
    else positives.push(`Rain risk is relatively limited at about ${day.max_precip_pct}% max.`);
  }

  const lowFeels = day.min_temp_feels_like_c;
  if (lowFeels != null) {
    if (lowFeels <= thresholds.cold_red) applyPenalty(15, `Minimum feels-like temperature is around ${lowFeels}°C (red threshold ${thresholds.cold_red}°C).`, 'blocker');
    else if (lowFeels <= thresholds.cold_amber) applyPenalty(8, `Minimum feels-like temperature is around ${lowFeels}°C (amber threshold ${thresholds.cold_amber}°C).`);
    else positives.push(`Feels-like temperature stays above the amber cold threshold (${lowFeels}°C).`);
  }

  if (waveHeight != null) {
    if (waveHeight >= thresholds.wave_red) applyPenalty(25, `Manual wave height input is ${waveHeight.toFixed(1)} m (red threshold ${thresholds.wave_red} m).`, 'blocker');
    else if (waveHeight >= thresholds.wave_amber) applyPenalty(12, `Manual wave height input is ${waveHeight.toFixed(1)} m (amber threshold ${thresholds.wave_amber} m).`);
    else positives.push(`Manual wave height input is relatively modest at ${waveHeight.toFixed(1)} m.`);
  }

  if (visibilityKm != null) {
    if (visibilityKm <= thresholds.visibility_red) applyPenalty(20, `Manual visibility input is only ${visibilityKm.toFixed(1)} km (red threshold ${thresholds.visibility_red} km).`, 'blocker');
    else if (visibilityKm <= thresholds.visibility_amber) applyPenalty(10, `Manual visibility input is ${visibilityKm.toFixed(1)} km (amber threshold ${thresholds.visibility_amber} km).`);
    else positives.push(`Manual visibility input looks acceptable at ${visibilityKm.toFixed(1)} km.`);
  }

  if (tideRisk === 2) applyPenalty(18, 'Manual tide risk set to HIGH.', 'blocker');
  else if (tideRisk === 1) applyPenalty(8, 'Manual tide risk set to MODERATE.');

  if (crewExperience === 'novice') {
    score -= 10;
    cautions.push('Crew experience set to NOVICE, so tolerance is reduced.');
  } else if (crewExperience === 'experienced') {
    score += 5;
    positives.push('Crew experience set to EXPERIENCED.');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let band, headline, statusClass;
  if (blockers.length || score < 40) {
    band = 'UNLIKELY';
    headline = 'Row looks unlikely to go ahead.';
    statusClass = 'status-unlikely';
  } else if (score < 70) {
    band = 'MARGINAL / COX REVIEW';
    headline = 'Could go ahead, but this looks borderline.';
    statusClass = 'status-marginal';
  } else {
    band = 'LIKELY';
    headline = 'Conditions look broadly favourable.';
    statusClass = 'status-likely';
  }

  let confidence = 'medium';
  const notesCount = (day.source_notes || []).length;
  if (notesCount <= 2) confidence = 'low';
  else if (notesCount >= 4) confidence = 'medium-high';

  return { score, band, headline, statusClass, confidence, blockers, cautions, positives };
}

function renderReasons(result) {
  const block = (title, items, cls) => `
    <div class="reasons-block ${cls}">
      <h3>${escapeHtml(title)}</h3>
      ${items.length ? `<ul>${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : '<p>None flagged.</p>'}
    </div>
  `;
  els.reasonsTab.innerHTML = [
    block('Main blockers', result.blockers, 'blockers'),
    block('Cautions', result.cautions, 'cautions'),
    block('Positives', result.positives, 'positives')
  ].join('');
}

function renderPolicyTab() {
  els.policyTab.innerHTML = `
    <div class="policy-note">
      <p><strong>Advisory only.</strong> This app should support, not replace, the first cox/s decision.</p>
      <p>The uploaded club policy says cancellation should be based on a balanced combination of tides, wind speed, wind direction, visibility, temperatures, wave height and crew capability, with the Met Office as the primary weather source.</p>
      <p>The app therefore gives a traffic-light style likelihood rather than a formal go / no-go ruling.</p>
    </div>
  `;
}

function runCheck() {
  const selectedDay = getSelectedDay();
  if (!selectedDay) return;
  const day = getForecastAtHour(selectedDay, state.selectedHour);

  const wave = els.waveInput.value ? Number(els.waveInput.value) : null;
  const visibility = els.visibilityInput.value ? Number(els.visibilityInput.value) : null;
  const tideRisk = Number(els.tideRiskSelect.value || 0);
  const crew = els.crewExperienceSelect.value || 'mixed';
  const thresholds = getThresholds();

  const result = classifyLikelihood(day, thresholds, wave, visibility, tideRisk, crew);
  els.resultCard.classList.remove('status-likely', 'status-marginal', 'status-unlikely');
  els.resultCard.classList.add(result.statusClass);
  els.resultBand.textContent = result.band;
  els.resultScore.textContent = `Score: ${result.score}/100 • Confidence: ${result.confidence}`;
  els.resultHeadline.textContent = result.headline;

  els.metricsGrid.innerHTML = [
    metric('Wind', day.max_wind_mph != null ? `${day.max_wind_mph} mph` : 'Not parsed', 'Max sustained wind'),
    metric('Gusts', day.max_gust_mph != null ? `${day.max_gust_mph} mph` : 'Not parsed', 'Max gust'),
    metric('Rain', day.max_precip_pct != null ? `${day.max_precip_pct}%` : 'Not parsed', 'Max precipitation chance'),
    metric('Feels-like', day.min_temp_feels_like_c != null ? `${day.min_temp_feels_like_c}°C` : 'Not parsed', 'Minimum feels-like'),
    metric('Direction risk', day.onshore_risk || 'unknown', 'Beach orientation hint'),
    metric('Crew', crew.charAt(0).toUpperCase() + crew.slice(1), 'Local refinement')
  ].join('');

  renderReasons(result);
}

function setForecastData(data, sourceLabel = 'Forecast loaded') {
  state.forecast = data;
  state.selectedDayLabel = data.days?.[0]?.label || null;
  els.lastUpdatedChip.textContent = data.updated_text ? `Met Office updated: ${data.updated_text}` : sourceLabel;
  renderDays();
  renderSelectedDaySummary();
  renderPolicyTab();
  runCheck();
}

function showBackendFetchError(message) {
  els.lastUpdatedChip.textContent = 'Forecast unavailable';
  els.loadingIndicator.style.display = 'none';
  els.resultCard.classList.remove('status-likely', 'status-marginal', 'status-unlikely');
  els.resultBand.textContent = 'Forecast unavailable';
  els.resultScore.textContent = 'Unable to load live forecast';
  els.resultHeadline.textContent = 'A live backend is required to fetch Met Office data.';
  els.metricsGrid.innerHTML = '';
  els.summaryTab.innerHTML = `<p>${escapeHtml(message)}</p>`;
  els.daysGrid.innerHTML = '';
  els.daySelect.innerHTML = '';
}

async function fetchLiveForecast() {
  els.lastUpdatedChip.textContent = 'Fetching forecast…';
  els.loadingIndicator.style.display = 'flex';
  els.loadingText.textContent = 'Fetching forecast...';
  try {
    // Request the backend scraper endpoint which fetches per-date Met Office pages.
    const apiUrl = '/api/metoffice-forecast.json';
    const response = await fetch(apiUrl, { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`Failed to fetch backend forecast: ${response.status}`);
    }

    const forecastData = await response.json();

    els.loadingIndicator.style.display = 'none';
    setForecastData(forecastData, 'Met Office (backend scraped)');
  } catch (err) {
    console.error('Forecast fetch error:', err);
    showBackendFetchError('Unable to fetch the live Met Office forecast backend. Ensure the local API server is running, or deploy the backend endpoint to the same origin as the app.');
  }
}

function parseMetOfficeForecast(html) {
  const now = new Date();
  const days = [];
  
  // Build 7 days of forecast data from explicit Met Office values only
  for (let i = 0; i < 7; i++) {
    const dateObj = new Date(now);
    dateObj.setDate(dateObj.getDate() + i);
    const dateIso = dateObj.toISOString().slice(0, 10);
    const dayLabels = ['Today', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed'];
    
    // Extract real data from HTML without inventing fallback values.
    let maxTemp = null;
    let minTemp = null;
    let wind = null;
    let gust = null;
    let rain = null;
    let direction = null;
    let onshoreRisk = null;

    const tempMatches = html.match(/(\d+)°/g) || [];
    if (tempMatches.length > i) {
      maxTemp = parseInt(tempMatches[i], 10);
    }

    const windMatch = html.match(/wind[^0-9]*(\d+)\s*mph/i);
    if (windMatch && i === 0) {
      wind = parseInt(windMatch[1], 10);
    }

    const gustMatch = html.match(/gust[^0-9]*(\d+)\s*mph/i);
    if (gustMatch && i === 0) {
      gust = parseInt(gustMatch[1], 10);
    }

    const rainMatch = html.match(/rain[^0-9]*(\d+)\s*%/i);
    if (rainMatch && i === 0) {
      rain = parseInt(rainMatch[1], 10);
    }

    const directionMatch = html.match(/(?:wind|direction)[^>\d]*(north|south|east|west|northwest|northeast|southwest|southeast)/i);
    if (directionMatch) {
      direction = directionMatch[1].toLowerCase();
    }

    const riskMatch = html.match(/onshore|offshore/i);
    if (riskMatch) {
      onshoreRisk = riskMatch[0].toLowerCase();
    }

    days.push({
      label: dayLabels[i],
      date_iso: dateIso,
      max_temp_c: maxTemp,
      min_temp_c: minTemp,
      min_temp_feels_like_c: minTemp != null ? minTemp - 2 : null,
      max_wind_mph: wind,
      max_gust_mph: gust,
      max_precip_pct: rain,
      dominant_direction_text: direction,
      onshore_risk: onshoreRisk,
      source_notes: ['web scraped from Met Office']
    });
  }
  
  return {
    source: 'Met Office Lyme Regis (web scraped)',
    updated_text: `Updated ${now.toLocaleTimeString('en-GB')}`,
    days: days
  };
}

function loadSampleForecast() {
  const now = new Date();
  const days = [];
  
  for (let i = 0; i < 7; i++) {
    const dateObj = new Date(now);
    dateObj.setDate(dateObj.getDate() + i);
    const dateIso = dateObj.toISOString().slice(0, 10);
    const dayLabels = ['Today', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed'];
    
    days.push({
      label: dayLabels[i],
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
  }
  
  setForecastData({
    source: 'Met Office forecast unavailable',
    updated_text: `Loaded ${now.toLocaleTimeString('en-GB')}`,
    days: days
  }, 'Met Office unavailable');
}

function wireTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

function init() {
  setThresholdInputs(DEFAULT_THRESHOLDS);
  wireTabs();
  renderPolicyTab();
  els.hourLabel.textContent = formatHourLabel(state.selectedHour);

  els.refreshBtn.addEventListener('click', fetchLiveForecast);
  els.resetThresholdsBtn.addEventListener('click', () => { setThresholdInputs(DEFAULT_THRESHOLDS); runCheck(); });
  els.checkBtn.addEventListener('click', runCheck);
  els.daySelect.addEventListener('change', () => {
    state.selectedDayLabel = els.daySelect.value;
    renderDays();
    renderSelectedDaySummary();
    runCheck();
  });
  els.hourRange.addEventListener('input', () => {
    state.selectedHour = Number(els.hourRange.value);
    els.hourLabel.textContent = formatHourLabel(state.selectedHour);
    renderSelectedDaySummary();
    runCheck();
  });
  [els.waveInput, els.visibilityInput, els.tideRiskSelect, els.crewExperienceSelect].forEach(el => {
    el.addEventListener('input', runCheck);
    el.addEventListener('change', runCheck);
  });
  document.querySelectorAll('.threshold').forEach(el => el.addEventListener('input', runCheck));

  fetchLiveForecast();
}

init();