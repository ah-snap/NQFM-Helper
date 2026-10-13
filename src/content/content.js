// Injects a floating NQFM panel on the Jira sprint report page, fetches the sprint
// report directly from the greenhopper REST API (same-origin, so the session cookie
// just works), computes standard + alternate metrics, and renders an editable ticket
// table with copy-to-clipboard buttons for pasting into the spreadsheet.
(function () {
  const NQFM = window.NQFM;

  const state = {
    rapidViewId: null,
    sprintId: null,
    sprintName: '',
    tickets: [],
    settings: null,
    overrides: {},
    derived: [],
    metrics: null
  };

  let els = null; // cached DOM refs, built once

  function getParams() {
    const params = new URLSearchParams(location.search);
    return {
      rapidViewId: params.get('rapidView'),
      sprintId: params.get('sprint'),
      projectKey: params.get('projectKey')
    };
  }

  async function fetchSprintReport(rapidViewId, sprintId) {
    const url = `/rest/greenhopper/1.0/rapid/charts/sprintreport?rapidViewId=${encodeURIComponent(
      rapidViewId
    )}&sprintId=${encodeURIComponent(sprintId)}&_=${Date.now()}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to load sprint report (HTTP ${res.status})`);
    return res.json();
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'nqfm-panel';
    panel.innerHTML = `
      <div id="nqfm-panel-header">
        <strong>NQFM Helper</strong>
        <div class="nqfm-header-actions">
          <span id="nqfm-maximize-toggle" title="Maximize">⤢</span>
          <span id="nqfm-toggle">▾</span>
        </div>
      </div>
      <div id="nqfm-body">
        <div id="nqfm-status" class="nqfm-status"></div>
        <div id="nqfm-summary-container"></div>
        <div class="nqfm-actions">
          <label>Cost (team size): <input type="number" id="nqfm-cost-input" min="0" step="1" /></label>
          <button id="nqfm-copy-summary" class="nqfm-secondary">Copy Summary</button>
        </div>
        <div class="nqfm-section-title">Tickets</div>
        <div id="nqfm-ticket-table-wrap"></div>
        <div class="nqfm-actions">
          <button id="nqfm-copy-tickets">Copy to QFS Format</button>
          <button id="nqfm-copy-debug" class="nqfm-secondary">Copy Raw Sample (debug)</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    makeHeaderInteractive(panel, panel.querySelector('#nqfm-panel-header'));

    panel.querySelector('#nqfm-maximize-toggle').addEventListener('click', (e) => {
      e.stopPropagation(); // the header's own click handler toggles collapse, which we don't want here
      setMaximized(panel, !panel.classList.contains('nqfm-maximized'));
      savePanelState(panel);
    });

    applyStoredPanelState(panel);

    const costInput = panel.querySelector('#nqfm-cost-input');
    costInput.addEventListener('change', async () => {
      const value = Number(costInput.value) || 0;
      state.settings.cost = value;
      await NQFM.storage.saveSettings(state.settings);
      recomputeAndRender();
    });

    panel.querySelector('#nqfm-copy-summary').addEventListener('click', async () => {
      const text = NQFM.format.summaryToTsv(state.metrics, state.sprintName);
      const ok = await NQFM.format.copyToClipboard(text);
      setStatus(ok ? 'Summary copied to clipboard.' : 'Copy failed — select the text manually.');
    });

    panel.querySelector('#nqfm-copy-tickets').addEventListener('click', async () => {
      const text = NQFM.format.ticketsToTsv(state.derived);
      const ok = await NQFM.format.copyToClipboard(text);
      setStatus(ok ? 'Ticket rows copied to clipboard.' : 'Copy failed — select the text manually.');
    });

    panel.querySelector('#nqfm-copy-debug').addEventListener('click', async () => {
      const key = (window.prompt('Ticket key to sample (blank = first "not completed" ticket):', '') || '').trim().toUpperCase();
      const sample = findSampleRawIssue(state.rawReport, key || undefined);
      if (!sample) {
        setStatus(key ? `No raw issue found for ${key}.` : 'No raw issue available yet — load a sprint first.', true);
        return;
      }
      const ok = await NQFM.format.copyToClipboard(JSON.stringify(sample, null, 2));
      setStatus(ok ? 'Raw issue JSON copied — paste it to Copilot.' : 'Copy failed — check the console (window.__nqfmLastRawIssue__).');
    });

    return {
      panel,
      status: panel.querySelector('#nqfm-status'),
      summaryContainer: panel.querySelector('#nqfm-summary-container'),
      ticketTableWrap: panel.querySelector('#nqfm-ticket-table-wrap'),
      costInput
    };
  }

  function setStatus(message, isError) {
    els.status.textContent = message || '';
    els.status.className = isError ? 'nqfm-error' : 'nqfm-status';
  }

  function renderSummaryTable() {
    const m = state.metrics;
    if (!m) {
      els.summaryContainer.innerHTML = '';
      return;
    }
    const row = (label, metrics) => `
      <tr>
        <td>${label}</td>
        <td class="nqfm-summary-cell">${NQFM.format.pct(metrics.reliability)}</td>
        <td class="nqfm-summary-cell">${NQFM.format.pct(metrics.predictability)}</td>
        <td class="nqfm-summary-cell">${NQFM.format.pct(metrics.quality)}</td>
        <td class="nqfm-summary-cell">${NQFM.format.round2(metrics.throughput)}</td>
        <td class="nqfm-summary-cell">${metrics.cost}</td>
        <td class="nqfm-summary-cell">${NQFM.format.round2(metrics.score)}</td>
      </tr>`;

    els.summaryContainer.innerHTML = `
      <div class="nqfm-section-title">${state.sprintName || 'Sprint'} — Summary Metrics</div>
      <table>
        <thead>
          <tr><th>Sprint</th><th>Reliability</th><th>Predictability</th><th>Quality</th><th>Throughput</th><th>Cost</th><th>Score</th></tr>
        </thead>
        <tbody>
          ${row('Standard', m.standard)}
          ${row('Alternate', m.alternate)}
        </tbody>
      </table>`;
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderTicketTable() {
    const moscowOptions = Object.keys(state.settings.moscowModifiers || {});

    const headerCells = NQFM.TICKET_COLUMNS.map((c) => `<th>${c.label}</th>`).join('');

    const rows = state.derived
      .map((t) => {
        const moscowSelect = `<select data-key="${escapeHtml(t.key)}" data-field="moscow">${moscowOptions
          .map((opt) => `<option value="${escapeHtml(opt)}" ${opt === t.moscow ? 'selected' : ''}>${escapeHtml(opt)}</option>`)
          .join('')}</select>`;

        const ovrcCheckbox = `<input type="checkbox" data-key="${escapeHtml(t.key)}" data-field="isOvrC" ${t.isOvrC ? 'checked' : ''} />`;
        const creditCheckbox = `<input type="checkbox" data-key="${escapeHtml(t.key)}" data-field="creditAlreadyTaken" ${t.creditAlreadyTaken ? 'checked' : ''} />`;

        return `<tr>
          <td><a href="/browse/${escapeHtml(t.key)}" target="_blank" rel="noopener">${escapeHtml(t.key)}</a></td>
          <td class="nqfm-summary-col" title="${escapeHtml(t.summary)}">${escapeHtml(t.summary)}</td>
          <td>${escapeHtml(t.issueType)}</td>
          <td>${escapeHtml(t.priority)}</td>
          <td>${escapeHtml(t.status)}</td>
          <td>${t.storyPoints}</td>
          <td>${t.completed ? 'TRUE' : 'FALSE'}</td>
          <td>${t.unplanned ? 'TRUE' : 'FALSE'}</td>
          <td>${moscowSelect}</td>
          <td>${t.storyValue}</td>
          <td>${ovrcCheckbox}</td>
          <td>${t.isAlternateDone ? 'TRUE' : 'FALSE'}</td>
          <td>${creditCheckbox}</td>
        </tr>`;
      })
      .join('');

    els.ticketTableWrap.innerHTML = `<table><thead><tr>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;

    els.ticketTableWrap.querySelectorAll('select[data-field], input[data-field]').forEach((el) => {
      el.addEventListener('change', async (e) => {
        const key = e.target.getAttribute('data-key');
        const field = e.target.getAttribute('data-field');
        const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        state.overrides[key] = Object.assign({}, state.overrides[key], { [field]: value });
        await NQFM.storage.saveOverrides(state.rapidViewId, state.sprintId, state.overrides);
        recomputeAndRender();
      });
    });
  }

  function recomputeAndRender() {
    state.derived = state.tickets.map((t) => NQFM.metrics.computeTicketDerivedFields(t, state.settings, state.overrides[t.key]));
    state.metrics = NQFM.metrics.computeSummaryMetrics(state.derived, state.settings.cost);
    els.costInput.value = state.settings.cost;
    renderSummaryTable();
    renderTicketTable();
  }

  // Pulls a raw issue object straight out of the API response, for diagnosing
  // field-mapping mismatches (e.g. Status not matching what the native Jira report shows).
  // Checks the "not completed"/punted buckets first since those are the ones where the
  // native report page renders a status label the sprintreport payload might carry directly.
  function findSampleRawIssue(raw, key) {
    if (!raw || !raw.contents) return null;
    const buckets = [
      raw.contents.issuesNotCompletedInCurrentSprint,
      raw.contents.puntedIssues,
      raw.contents.completedIssues,
      raw.contents.issuesCompletedInAnotherSprint
    ];
    if (key) {
      for (const bucket of buckets) {
        if (!Array.isArray(bucket)) continue;
        const match = bucket.find((issue) => issue && issue.key === key);
        if (match) return match;
      }
      return null;
    }
    for (const bucket of buckets) {
      if (Array.isArray(bucket) && bucket.length > 0) return bucket[0];
    }
    return null;
  }

  // Lets the panel be dragged by its header; a drag that moves the pointer suppresses the
  // collapse-toggle click that would otherwise fire on release.
  function makeHeaderInteractive(panel, header) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('#nqfm-toggle, #nqfm-maximize-toggle')) return;
      dragging = true;
      moved = false;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      header.setPointerCapture(e.pointerId);
    });

    header.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      if (!moved) return;
      const maxLeft = Math.max(window.innerWidth - panel.offsetWidth, 0);
      const maxTop = Math.max(window.innerHeight - panel.offsetHeight, 0);
      panel.style.left = `${Math.min(Math.max(startLeft + dx, 0), maxLeft)}px`;
      panel.style.top = `${Math.min(Math.max(startTop + dy, 0), maxTop)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });

    header.addEventListener('pointerup', (e) => {
      dragging = false;
      header.releasePointerCapture(e.pointerId);
    });

    header.addEventListener('click', () => {
      if (moved) {
        moved = false;
        return;
      }
      panel.classList.toggle('nqfm-collapsed');
      savePanelState(panel);
    });
  }

  // Maximizing moves the panel to a fixed full-viewport position; stash whatever
  // position dragging had set so restoring it afterward doesn't snap to the corner.
  function setMaximized(panel, maximized) {
    if (maximized) {
      panel.dataset.prevLeft = panel.style.left;
      panel.dataset.prevTop = panel.style.top;
      panel.dataset.prevRight = panel.style.right;
      panel.dataset.prevBottom = panel.style.bottom;
      panel.style.left = '16px';
      panel.style.top = '16px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    } else if (panel.dataset.prevLeft !== undefined) {
      panel.style.left = panel.dataset.prevLeft;
      panel.style.top = panel.dataset.prevTop;
      panel.style.right = panel.dataset.prevRight;
      panel.style.bottom = panel.dataset.prevBottom;
      delete panel.dataset.prevLeft;
      delete panel.dataset.prevTop;
      delete panel.dataset.prevRight;
      delete panel.dataset.prevBottom;
    }
    panel.classList.toggle('nqfm-maximized', maximized);
    panel.querySelector('#nqfm-maximize-toggle').title = maximized ? 'Restore' : 'Maximize';
  }

  function savePanelState(panel) {
    NQFM.storage.savePanelState({
      collapsed: panel.classList.contains('nqfm-collapsed'),
      maximized: panel.classList.contains('nqfm-maximized')
    });
  }

  async function applyStoredPanelState(panel) {
    const panelState = await NQFM.storage.getPanelState();
    if (panelState.collapsed) panel.classList.add('nqfm-collapsed');
    if (panelState.maximized) setMaximized(panel, true);
  }

  async function loadAndRender(rapidViewId, sprintId, projectKey) {
    setStatus('Loading sprint report…');
    try {
      state.settings = await NQFM.storage.getSettings();
      state.overrides = await NQFM.storage.getOverrides(rapidViewId, sprintId);

      const raw = await fetchSprintReport(rapidViewId, sprintId);
      const parsed = NQFM.sprintReportParser.parse(raw);

      // The sprintreport endpoint only returns statusId/priorityId/typeId (a point-in-time
      // snapshot), so resolve names via Jira's global reference lists rather than each
      // ticket's current live status. Labels aren't in the payload at all and still need a
      // per-issue lookup (for label-based OvrC detection).
      try {
        const [referenceMaps, labelsByKey] = await Promise.all([
          NQFM.jiraApi.fetchReferenceMaps(),
          NQFM.jiraApi.fetchLabelsByKey(parsed.tickets.map((t) => t.key))
        ]);
        NQFM.sprintReportParser.applyFieldEnrichment(parsed.tickets, referenceMaps, labelsByKey);
      } catch (enrichErr) {
        console.warn('NQFM: failed to resolve issue status/priority/type/labels', enrichErr);
      }

      state.rawReport = raw;
      window.__nqfmLastRawIssue__ = findSampleRawIssue(raw); // inspect in DevTools console if the Copy Raw Sample button fails

      state.rapidViewId = rapidViewId;
      state.sprintId = sprintId;
      state.sprintName = parsed.sprint.name || `Sprint ${sprintId}`;
      state.tickets = parsed.tickets;

      await NQFM.storage.saveLastBoard({
        rapidViewId,
        sprintId,
        projectKey,
        sprintName: state.sprintName,
        url: location.href
      });

      recomputeAndRender();
      setStatus('');
    } catch (err) {
      setStatus(`Error: ${err.message}`, true);
    }
  }

  function init() {
    const { rapidViewId, sprintId, projectKey } = getParams();
    if (!rapidViewId || !sprintId) return;
    if (!els) els = buildPanel();
    loadAndRender(rapidViewId, sprintId, projectKey);
  }

  // Jira's report view is a single-page app: the sprint can change without a full
  // page reload, so poll the query string for changes.
  let lastSearch = location.search;
  setInterval(() => {
    if (location.search !== lastSearch) {
      lastSearch = location.search;
      init();
    }
  }, 1000);

  init();
})();
