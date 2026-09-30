/**
 * GreenGrid Frontend Application
 */

// ==========================================
// 1. CONFIG & GLOBALS
// ==========================================
const API_BASE = '/api';
const RANGES = {
  moisture: { min: 0, max: 100, healthyMin: 30, healthyMax: 70 },
  temperature: { min: -10, max: 60, healthyMin: 18, healthyMax: 32 },
  humidity: { min: 0, max: 100, healthyMin: 40, healthyMax: 80 }
};

let state = {
  beds: [],
  latestReadings: [],
  readings: [],
  trendBedId: null,
  trendMetric: 'soil_moisture',
  trendChartInstance: null,
  pollInterval: null,
  isPolling: true,
  lastSync: null,
  editingId: null
};

// ==========================================
// 2. UTILS
// ==========================================
const escapeHTML = (str) => {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

const formatTime = (isoString) => {
  if (!isoString) return '';
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDate = (isoString) => {
  if (!isoString) return '';
  return new Date(isoString).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
};

const getRelativeTime = (isoString) => {
  if (!isoString) return 'No data';
  const diffMs = new Date() - new Date(isoString);
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins === 1) return '1 min ago';
  if (diffMins < 60) return `${diffMins} mins ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours === 1) return '1 hour ago';
  return `${diffHours} hours ago`;
};

const showToast = (message, type = 'success') => {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
};

const checkRange = (metric, val) => {
  if (val === null || val === undefined) return 'nodata';
  const r = RANGES[metric];
  if (val < r.healthyMin || val > r.healthyMax) return 'danger';
  if (val - r.healthyMin <= 5 || r.healthyMax - val <= 5) return 'warning';
  return 'success';
};

const getColorClass = (status) => {
  if (status === 'success') return 'val-green';
  if (status === 'warning') return 'val-amber';
  if (status === 'danger') return 'val-red';
  return '';
};

// ==========================================
// 3. API CLIENT
// ==========================================
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'Accept': 'application/json',
    ...(options.headers || {})
  };
  
  if (options.body) headers['Content-Type'] = 'application/json';
  
  const key = sessionStorage.getItem('greengrid_key');
  if (key) headers['x-write-key'] = key;

  try {
    const res = await fetch(url, { ...options, headers });
    
    if (res.status === 401) {
      return new Promise((resolve, reject) => {
        openPasscodeModal(async (newKey) => {
          sessionStorage.setItem('greengrid_key', newKey);
          try {
            const retryRes = await apiRequest(endpoint, options);
            resolve(retryRes);
          } catch (e) { reject(e); }
        }, () => reject(new Error('Unauthorized')));
      });
    }
    
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw { status: res.status, data };
    return data;
  } catch (err) {
    if (err.status) throw err;
    throw { status: 0, data: { error: 'Network error' } };
  }
}

// ==========================================
// 4. RENDERERS
// ==========================================

function updateSyncStatus(ok = true) {
  const dot = document.querySelector('.dot');
  const text = document.getElementById('sync-status');
  if (!dot || !text) return;
  
  if (ok) {
    state.lastSync = new Date();
    dot.className = 'dot pulsing';
    text.textContent = `Last synced ${formatTime(state.lastSync)}`;
  } else {
    dot.className = 'dot offline';
    text.textContent = 'Offline - retrying';
  }
}

function renderKPIs() {
  const container = document.getElementById('kpi-container');
  if (!container) return;

  const readings = state.latestReadings.filter(r => r.id !== null);
  let sumMoist = 0, sumTemp = 0, sumHum = 0;
  let attentionBeds = 0;

  readings.forEach(r => {
    sumMoist += Number(r.soil_moisture);
    sumTemp += Number(r.temperature);
    sumHum += Number(r.humidity);
    
    const mStat = checkRange('moisture', r.soil_moisture);
    const tStat = checkRange('temperature', r.temperature);
    const hStat = checkRange('humidity', r.humidity);
    if (mStat === 'danger' || tStat === 'danger' || hStat === 'danger') {
      attentionBeds++;
    }
  });

  const avgMoist = readings.length ? (sumMoist / readings.length).toFixed(1) : '--';
  const avgTemp = readings.length ? (sumTemp / readings.length).toFixed(1) : '--';
  const avgHum = readings.length ? (sumHum / readings.length).toFixed(1) : '--';

  container.innerHTML = `
    <div class="kpi-card"><div class="kpi-title">Avg Soil Moisture</div><div class="kpi-val">${avgMoist}%</div></div>
    <div class="kpi-card"><div class="kpi-title">Avg Temperature</div><div class="kpi-val">${avgTemp}°C</div></div>
    <div class="kpi-card"><div class="kpi-title">Avg Humidity</div><div class="kpi-val">${avgHum}%</div></div>
    <div class="kpi-card" style="border-left: 4px solid var(${attentionBeds > 0 ? '--c-danger' : '--c-success'})">
      <div class="kpi-title">Beds Needing Attention</div><div class="kpi-val">${attentionBeds}</div>
    </div>
  `;
}

function renderBedsGrid() {
  const container = document.getElementById('beds-container');
  if (!container) return;
  
  if (state.latestReadings.length === 0) {
    container.innerHTML = `<div class="card">No beds found.</div>`;
    return;
  }

  // Inline SVGs for metrics
  const svgMoist = `<svg class="metric-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`;
  const svgTemp = `<svg class="metric-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>`;
  const svgHum = `<svg class="metric-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>`;

  container.innerHTML = state.latestReadings.map(r => {
    const hasData = r.id !== null;
    const mStat = hasData ? checkRange('moisture', r.soil_moisture) : 'nodata';
    const tStat = hasData ? checkRange('temperature', r.temperature) : 'nodata';
    const hStat = hasData ? checkRange('humidity', r.humidity) : 'nodata';
    
    let overallStat = 'Healthy';
    let statClass = 'badge-sensor';
    if (!hasData) { overallStat = 'No data'; statClass = 'badge-warning'; }
    else if (mStat === 'danger' || tStat === 'danger' || hStat === 'danger') {
      overallStat = 'Action Needed'; statClass = 'badge-danger';
    } else if (mStat === 'warning' || tStat === 'warning' || hStat === 'warning') {
      overallStat = 'Check Soon'; statClass = 'badge-warning';
    }

    return `
    <div class="card bed-card">
      <div class="bed-header">
        <div>
          <h3 class="bed-title">${escapeHTML(r.bed_name)}</h3>
          <p class="bed-sub">${escapeHTML(r.crop)} • ${escapeHTML(r.location)}</p>
        </div>
        <span class="badge ${statClass}">${overallStat}</span>
      </div>
      
      <div class="bed-metrics">
        <div class="metric" aria-label="Moisture: ${hasData ? r.soil_moisture + '%' : 'no data'}">
          ${svgMoist}
          <span class="metric-val ${getColorClass(mStat)}">${hasData ? Number(r.soil_moisture).toFixed(1) + '%' : '--'}</span>
        </div>
        <div class="metric" aria-label="Temperature: ${hasData ? r.temperature + '°C' : 'no data'}">
          ${svgTemp}
          <span class="metric-val ${getColorClass(tStat)}">${hasData ? Number(r.temperature).toFixed(1) + '°C' : '--'}</span>
        </div>
        <div class="metric" aria-label="Humidity: ${hasData ? r.humidity + '%' : 'no data'}">
          ${svgHum}
          <span class="metric-val ${getColorClass(hStat)}">${hasData ? Number(r.humidity).toFixed(1) + '%' : '--'}</span>
        </div>
      </div>
      
      <div class="bed-footer">
        <span>Updated ${getRelativeTime(r.recorded_at)}</span>
        ${hasData ? `<span class="badge ${r.source === 'manual' ? 'badge-manual' : 'badge-sensor'}">${escapeHTML(r.source)}</span>` : ''}
      </div>
    </div>
    `;
  }).join('');
}

async function renderTrendChart() {
  const canvas = document.getElementById('trendChart');
  if (!canvas) return;

  if (!state.trendBedId && state.beds.length > 0) {
    state.trendBedId = state.beds[0].id;
  }
  
  const select = document.getElementById('trend-bed-select');
  if (select && select.children.length === 0) {
    select.innerHTML = state.beds.map(b => `<option value="${b.id}">${escapeHTML(b.name)}</option>`).join('');
    select.value = state.trendBedId;
  }

  if (!state.trendBedId) return;

  try {
    const data = await apiRequest(`/readings?bed_id=${state.trendBedId}&limit=40`);
    data.reverse(); // Chronological for chart
    
    const labels = data.map(d => formatTime(d.recorded_at));
    const dataset = data.map(d => Number(d[state.trendMetric]));
    
    // Default to moisture styling
    let color = '#2B7BB9', label = 'Soil Moisture %';
    if (state.trendMetric === 'temperature') { color = '#E8833A'; label = 'Temperature °C'; }
    else if (state.trendMetric === 'humidity') { color = '#2A9D8F'; label = 'Humidity %'; }

    // Check prefers-color-scheme for correct text colors in chart
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const textColor = isDark ? '#9ba8a0' : '#5e6b62';
    const gridColor = isDark ? '#2c3a31' : '#E3E9E1';

    if (state.trendChartInstance) {
      state.trendChartInstance.data.labels = labels;
      state.trendChartInstance.data.datasets[0] = { 
        label, data: dataset, borderColor: color, backgroundColor: color + '33', fill: true, tension: 0.2, pointRadius: 2
      };
      state.trendChartInstance.options.scales.x.ticks.color = textColor;
      state.trendChartInstance.options.scales.y.ticks.color = textColor;
      state.trendChartInstance.options.scales.x.grid.color = gridColor;
      state.trendChartInstance.options.scales.y.grid.color = gridColor;
      state.trendChartInstance.update('none'); // No animation for polling updates
    } else {
      const ctx = canvas.getContext('2d');
      Chart.defaults.font.family = 'Inter';
      state.trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{ label, data: dataset, borderColor: color, backgroundColor: color + '33', fill: true, tension: 0.2, pointRadius: 2 }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { 
            y: { beginAtZero: false, ticks: { color: textColor }, grid: { color: gridColor } },
            x: { ticks: { color: textColor, maxTicksLimit: 10 }, grid: { color: gridColor } }
          },
          animation: { duration: 0 } // start with no anim to avoid initial glitch
        }
      });
    }
  } catch (e) {
    console.error('Trend chart fetch error', e);
  }
}

function renderReadingsTable() {
  const tbody = document.querySelector('#readings-table tbody');
  if (!tbody) return;

  if (state.readings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 2rem;">No readings found. Log the first one!</td></tr>`;
    return;
  }

  tbody.innerHTML = state.readings.map(r => {
    // Implausibility check for demo
    const implausible = (Number(r.soil_moisture) === 0 && Number(r.temperature) > 55);
    
    return `
    <tr id="row-${r.id}">
      <td data-label="ID">#${r.id}</td>
      <td data-label="Bed">${escapeHTML(r.bed_name)}</td>
      <td data-label="Moisture %">${Number(r.soil_moisture).toFixed(1)}</td>
      <td data-label="Temp °C">${Number(r.temperature).toFixed(1)}</td>
      <td data-label="Humidity %">${Number(r.humidity).toFixed(1)}</td>
      <td data-label="Source"><span class="badge ${r.source === 'manual' ? 'badge-manual' : 'badge-sensor'}">${escapeHTML(r.source)}</span></td>
      <td data-label="Notes">
        ${implausible ? `<span class="badge badge-danger" style="margin-bottom: 4px; display: inline-block;">Faulty sensor?</span><br>` : ''}
        ${escapeHTML(r.notes || '')}
      </td>
      <td data-label="Recorded">${formatDate(r.recorded_at)}</td>
      <td data-label="Actions">
        <button class="btn-icon" aria-label="Edit reading #${r.id}" onclick="editReading(${r.id})">✎</button>
        <button class="btn-icon" aria-label="Delete reading #${r.id}" onclick="confirmDelete(${r.id})">🗑</button>
      </td>
    </tr>
    `;
  }).join('');
}

// ==========================================
// 5. EVENT HANDLERS & MODALS
// ==========================================

// Global Exposed Handlers for inline onclick
window.editReading = (id) => {
  const r = state.readings.find(x => x.id === id);
  if (!r) return;
  state.editingId = id;
  document.getElementById('modal-reading-title').textContent = 'Edit Reading';
  
  const form = document.getElementById('form-reading');
  form.reset();
  document.querySelectorAll('.error-msg').forEach(el => el.textContent = '');
  document.getElementById('form-server-error').textContent = '';
  
  document.getElementById('input-id').value = r.id;
  document.getElementById('input-bed').value = r.bed_id;
  document.getElementById('input-moisture').value = r.soil_moisture;
  document.getElementById('input-temp').value = r.temperature;
  document.getElementById('input-humidity').value = r.humidity;
  document.getElementById('input-notes').value = r.notes || '';
  document.getElementById('notes-count').textContent = `${(r.notes || '').length}/255`;
  
  if (r.recorded_at) {
    const d = new Date(r.recorded_at);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    document.getElementById('input-recorded').value = d.toISOString().slice(0, 16);
  }
  
  openModal('modal-reading', document.activeElement);
};

window.confirmDelete = (id) => {
  const r = state.readings.find(x => x.id === id);
  if (!r) return;
  document.getElementById('delete-details').innerHTML = `
    <strong>Bed:</strong> ${escapeHTML(r.bed_name)}<br>
    <strong>Recorded:</strong> ${formatDate(r.recorded_at)}<br>
    <strong>Metrics:</strong> Moisture: ${r.soil_moisture}%, Temp: ${r.temperature}°C, Humidity: ${r.humidity}%
  `;
  document.getElementById('btn-confirm-delete').dataset.id = id;
  openModal('modal-delete', document.activeElement);
};

// Modals logic
let lastFocus = null;
function openModal(id, triggerElement) {
  if (triggerElement) lastFocus = triggerElement;
  document.getElementById('modal-overlay').hidden = false;
  const modal = document.getElementById(id);
  modal.hidden = false;
  const focusable = modal.querySelector('button, input, select, textarea');
  if (focusable) focusable.focus();
}

function closeModals() {
  document.getElementById('modal-overlay').hidden = true;
  document.querySelectorAll('.modal').forEach(m => m.hidden = true);
  state.editingId = null;
  if (lastFocus) { lastFocus.focus(); lastFocus = null; }
}

let onPasscodeSuccess, onPasscodeFail;
function openPasscodeModal(successCb, failCb) {
  onPasscodeSuccess = successCb;
  onPasscodeFail = failCb;
  document.getElementById('input-passcode').value = '';
  openModal('modal-passcode');
}

function bindEvents() {
  window.addEventListener('hashchange', router);
  
  // Modals Close
  document.querySelectorAll('.btn-close').forEach(b => b.addEventListener('click', closeModals));
  document.getElementById('btn-cancel-reading').addEventListener('click', closeModals);
  document.getElementById('btn-cancel-delete').addEventListener('click', closeModals);
  document.getElementById('modal-overlay').addEventListener('click', closeModals);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });
  
  // Log Reading Button
  document.getElementById('btn-log-reading').addEventListener('click', (e) => {
    state.editingId = null;
    document.getElementById('modal-reading-title').textContent = 'Log Reading';
    const form = document.getElementById('form-reading');
    form.reset();
    document.querySelectorAll('.error-msg').forEach(el => el.textContent = '');
    document.getElementById('form-server-error').textContent = '';
    document.getElementById('notes-count').textContent = '0/255';
    
    // Set default time (local)
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    document.getElementById('input-recorded').value = d.toISOString().slice(0, 16);
    
    // Populate beds
    const bedSelect = document.getElementById('input-bed');
    if (bedSelect.children.length === 0) {
      bedSelect.innerHTML = `<option value="">Select a bed...</option>` + 
        state.beds.map(b => `<option value="${b.id}">${escapeHTML(b.name)}</option>`).join('');
    }
    
    openModal('modal-reading', e.target);
  });

  // Notes counter
  document.getElementById('input-notes').addEventListener('input', e => {
    document.getElementById('notes-count').textContent = `${e.target.value.length}/255`;
  });

  // Form Submit (Log/Edit)
  document.getElementById('form-reading').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Client Validation
    let valid = true;
    document.querySelectorAll('.error-msg').forEach(el => el.textContent = '');
    
    const v = (id) => Number(document.getElementById(id).value);
    if (v('input-moisture') < RANGES.moisture.min || v('input-moisture') > RANGES.moisture.max) {
      document.getElementById('error-moisture').textContent = `Must be ${RANGES.moisture.min}-${RANGES.moisture.max}`;
      valid = false;
    }
    if (v('input-temp') < RANGES.temperature.min || v('input-temp') > RANGES.temperature.max) {
      document.getElementById('error-temp').textContent = `Must be ${RANGES.temperature.min}-${RANGES.temperature.max}`;
      valid = false;
    }
    if (v('input-humidity') < RANGES.humidity.min || v('input-humidity') > RANGES.humidity.max) {
      document.getElementById('error-humidity').textContent = `Must be ${RANGES.humidity.min}-${RANGES.humidity.max}`;
      valid = false;
    }
    
    if (!valid) return;

    const btn = document.getElementById('btn-submit-reading');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    document.getElementById('form-server-error').textContent = '';

    const recVal = document.getElementById('input-recorded').value;
    const payload = {
      bed_id: document.getElementById('input-bed').value,
      soil_moisture: v('input-moisture'),
      temperature: v('input-temp'),
      humidity: v('input-humidity'),
      notes: document.getElementById('input-notes').value,
      source: 'manual',
      recorded_at: recVal ? new Date(recVal).toISOString() : new Date().toISOString()
    };

    try {
      if (state.editingId) {
        await apiRequest(`/readings/${state.editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Reading updated successfully');
      } else {
        await apiRequest('/readings', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Reading logged successfully');
      }
      closeModals();
      loadData(); // refresh current view
    } catch (err) {
      if (err.data && err.data.errors) {
        document.getElementById('form-server-error').textContent = err.data.errors.join(', ');
      } else {
        document.getElementById('form-server-error').textContent = err.data?.error || 'Failed to save';
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Reading';
    }
  });

  // Delete Confirm
  document.getElementById('btn-confirm-delete').addEventListener('click', async (e) => {
    const id = e.target.dataset.id;
    const btn = e.target;
    btn.disabled = true;
    try {
      await apiRequest(`/readings/${id}`, { method: 'DELETE' });
      closeModals();
      showToast('Reading deleted');
      
      const row = document.getElementById(`row-${id}`);
      if (row) {
        row.classList.add('row-fadeOut');
        setTimeout(() => loadData(), 300);
      } else {
        loadData();
      }
    } catch (err) {
      showToast(err.data?.error || 'Delete failed', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Passcode Submit
  document.getElementById('form-passcode').addEventListener('submit', e => {
    e.preventDefault();
    const key = document.getElementById('input-passcode').value;
    closeModals();
    if (onPasscodeSuccess) onPasscodeSuccess(key);
  });
}

// ==========================================
// 6. VIEW ROUTER & DATA LOADING
// ==========================================

async function loadDashboardData() {
  try {
    state.latestReadings = await apiRequest('/readings/latest');
    updateSyncStatus(true);
    renderKPIs();
    renderBedsGrid();
    renderTrendChart();
  } catch (e) {
    updateSyncStatus(false);
  }
}

async function loadReadingsData() {
  try {
    const bedEl = document.getElementById('filter-bed');
    const srcEl = document.getElementById('filter-source');
    const limEl = document.getElementById('filter-limit');
    
    if (bedEl && bedEl.children.length <= 1) {
      bedEl.innerHTML = `<option value="">All Beds</option>` + 
        state.beds.map(b => `<option value="${b.id}">${escapeHTML(b.name)}</option>`).join('');
    }

    let url = '/readings?';
    if (bedEl && bedEl.value) url += `bed_id=${bedEl.value}&`;
    if (srcEl && srcEl.value) url += `source=${srcEl.value}&`;
    if (limEl && limEl.value) url += `limit=${limEl.value}`;
    else url += 'limit=25';

    state.readings = await apiRequest(url);
    renderReadingsTable();
  } catch (e) {
    showToast('Failed to load readings', 'error');
  }
}

function loadData() {
  const hash = window.location.hash || '#/dashboard';
  if (hash === '#/dashboard') loadDashboardData();
  else if (hash === '#/readings') loadReadingsData();
}

function router() {
  const main = document.getElementById('main-content');
  const hash = window.location.hash || '#/dashboard';
  
  document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
  
  if (hash === '#/readings') {
    document.getElementById('nav-readings').classList.add('active');
    const tpl = document.getElementById('tpl-readings');
    main.innerHTML = tpl.innerHTML;
    
    // Bind Readings specific events
    document.getElementById('btn-refresh').addEventListener('click', loadReadingsData);
    ['filter-bed', 'filter-source', 'filter-limit'].forEach(id => {
      document.getElementById(id).addEventListener('change', loadReadingsData);
    });
    
  } else {
    // Default to Dashboard
    window.location.hash = '#/dashboard';
    document.getElementById('nav-dashboard').classList.add('active');
    const tpl = document.getElementById('tpl-dashboard');
    main.innerHTML = tpl.innerHTML;
    
    // Bind Dashboard specific events
    document.getElementById('trend-bed-select').addEventListener('change', (e) => {
      state.trendBedId = e.target.value;
      renderTrendChart();
    });
    
    document.querySelectorAll('.btn-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-toggle').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        state.trendMetric = e.target.dataset.metric;
        renderTrendChart();
      });
    });
  }
  
  loadData();
}

// ==========================================
// 7. POLLING & INIT
// ==========================================

function setupPolling() {
  document.addEventListener("visibilitychange", () => {
    state.isPolling = !document.hidden;
    if (state.isPolling) loadData();
  });

  setInterval(() => {
    if (state.isPolling && window.location.hash === '#/dashboard') {
      loadData();
    }
  }, 5000);
}

async function init() {
  try {
    state.beds = await apiRequest('/beds');
  } catch (e) {
    console.error('Failed to load beds on init');
  }
  
  bindEvents();
  router();
  setupPolling();
}

document.addEventListener('DOMContentLoaded', init);
