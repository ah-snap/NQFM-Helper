// Popup: lets the user pick a sprint (or a month, blending every sprint that overlaps
// it) from outside the sprint report page. Data is fetched via the background service
// worker, which runs the actual request inside a Jira tab so the session cookie applies.
(function () {
  const NQFM = window.NQFM;

  let settings = null;
  let board = null; // { rapidViewId, projectKey, sprintName, ... }
  let sprintList = []; // raw sprintquery entries

  const els = {
    boardInfo: document.getElementById('board-info'),
    sprintSelect: document.getElementById('sprint-select'),
    sprintField: document.getElementById('sprint-field'),
    monthField: document.getElementById('month-field'),
    monthInput: document.getElementById('month-input'),
    calculateBtn: document.getElementById('calculate-btn'),
    refreshBtn: document.getElementById('refresh-sprints-btn'),
    copySprintListBtn: document.getElementById('copy-sprintlist-btn'),
    status: document.getElementById('status'),
    results: document.getElementById('results')
  };

  function setStatus(message, isError) {
    els.status.textContent = message || '';
    els.status.className = isError ? 'nqfm-status nqfm-error' : 'nqfm-status';
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.ok) {
          reject(new Error((response && response.error) || 'Unknown error'));
          return;
        }
        resolve(response.data);
      });
    });
  }

  // If the current tab is itself a sprint report, read the board straight from its
  // URL. This covers tabs that were already open before the extension's content
  // script could run in them, where chrome.storage would have nothing saved yet.
  function parseBoardFromUrl(url) {
    try {
      const u = new URL(url);
      if (!/\/secure\/RapidBoard\.jspa/i.test(u.pathname)) return null;
      const rapidViewId = u.searchParams.get('rapidView');
      if (!rapidViewId) return null;
      return {
        rapidViewId,
        sprintId: u.searchParams.get('sprint'),
        projectKey: u.searchParams.get('projectKey')
      };
    } catch (err) {
      return null;
    }
  }

  function queryActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
    });
  }

  async function resolveBoard() {
    const activeTab = await queryActiveTab();
    const fromActiveTab = activeTab && activeTab.url ? parseBoardFromUrl(activeTab.url) : null;
    if (fromActiveTab) return fromActiveTab;

    const lastBoard = await NQFM.storage.getLastBoard();
    if (lastBoard && lastBoard.rapidViewId) return lastBoard;
    if (settings.defaultRapidViewId) {
      return { rapidViewId: settings.defaultRapidViewId, projectKey: '', sprintName: '' };
    }
    return null;
  }

  function renderBoardInfo() {
    if (!board) {
      els.boardInfo.innerHTML =
        'No board detected yet. Visit a sprint report page once, or set a default board in <a href="#" id="open-options">Options</a>.';
      document.getElementById('open-options').addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
      });
      return;
    }
    els.boardInfo.textContent = `Board: rapidView ${board.rapidViewId}${board.projectKey ? ' (' + board.projectKey + ')' : ''}`;
  }

  // Sorts by actual sprint date, not Jira's "sequence" (board position), since teams can
  // freely reorder sprints in the backlog without it reflecting chronological order.
  function sprintSortValue(s) {
    const date = NQFM.dateUtils.parseJiraDate(s.endDate || s.completeDate || s.startDate);
    if (date) return date.getTime();
    return Number(s.sequence ?? s.id ?? 0);
  }

  function populateSprintDropdown() {
    const sorted = [...sprintList].sort((a, b) => sprintSortValue(b) - sprintSortValue(a));
    const limited = sorted.slice(0, settings.sprintHistoryCount || 26);
    els.sprintSelect.innerHTML = limited
      .map((s) => `<option value="${s.id}">${s.name}${s.state ? ' — ' + s.state : ''}</option>`)
      .join('');
    if (board && board.sprintId && limited.some((s) => String(s.id) === String(board.sprintId))) {
      els.sprintSelect.value = board.sprintId;
    }
  }

  // Shows the loaded sprint count and the date span it covers, so a "missing month" report
  // can be diagnosed from the popup directly instead of guessing at the API response shape.
  function describeSprintListRange() {
    const dates = sprintList
      .map((s) => NQFM.dateUtils.parseJiraDate(s.endDate || s.completeDate || s.startDate))
      .filter(Boolean);
    if (dates.length === 0) return `Loaded ${sprintList.length} sprint(s) — no parseable dates found.`;
    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    const fmt = (d) => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    return `Loaded ${sprintList.length} sprint(s), spanning ${fmt(min)} – ${fmt(max)}.`;
  }

  async function loadSprintList() {
    if (!board) return;
    setStatus('Loading sprint list…');
    try {
      const data = await sendMessage({ type: 'FETCH_SPRINT_LIST', rapidViewId: board.rapidViewId });
      sprintList = data.sprints || [];
      populateSprintDropdown();
      setStatus(describeSprintListRange());
    } catch (err) {
      setStatus('Error loading sprints: ' + err.message, true);
    }
  }

  async function computeMetricsForSprint(sprintId) {
    const { report, referenceMaps, labelsByKey } = await sendMessage({
      type: 'FETCH_SPRINT_REPORT',
      rapidViewId: board.rapidViewId,
      sprintId
    });
    const parsed = NQFM.sprintReportParser.parse(report);
    NQFM.sprintReportParser.applyFieldEnrichment(parsed.tickets, referenceMaps, labelsByKey);
    const overrides = await NQFM.storage.getOverrides(board.rapidViewId, sprintId);
    const derived = parsed.tickets.map((t) => NQFM.metrics.computeTicketDerivedFields(t, settings, overrides[t.key]));
    const metrics = NQFM.metrics.computeSummaryMetrics(derived, settings.cost);
    return { sprint: parsed.sprint, metrics };
  }

  function renderMetrics(metrics, label) {
    const row = (name, m) => `
      <tr>
        <td>${name}</td>
        <td>${NQFM.format.pct(m.reliability)}</td>
        <td>${NQFM.format.pct(m.predictability)}</td>
        <td>${NQFM.format.pct(m.quality)}</td>
        <td>${NQFM.format.round2(m.throughput)}</td>
        <td>${m.cost}</td>
        <td>${NQFM.format.round2(m.score)}</td>
      </tr>`;

    els.results.innerHTML = `
      <div class="nqfm-section-title">${label}</div>
      <table>
        <thead><tr><th>Set</th><th>Reliability</th><th>Predictability</th><th>Quality</th><th>Throughput</th><th>Cost</th><th>Score</th></tr></thead>
        <tbody>${row('Standard', metrics.standard)}${row('Alternate', metrics.alternate)}</tbody>
      </table>
      <button id="copy-results-btn">Copy</button>
    `;
    document.getElementById('copy-results-btn').addEventListener('click', async () => {
      const ok = await NQFM.format.copyToClipboard(NQFM.format.summaryToTsv(metrics, label));
      setStatus(ok ? 'Copied to clipboard.' : 'Copy failed — select manually.');
    });
  }

  async function calculateSingleSprint() {
    const sprintId = els.sprintSelect.value;
    const sprint = sprintList.find((s) => String(s.id) === String(sprintId));
    setStatus('Calculating…');
    const { metrics } = await computeMetricsForSprint(sprintId);
    renderMetrics(metrics, sprint ? sprint.name : `Sprint ${sprintId}`);
    setStatus('');
  }

  // Blends every sprint (within the fetched history) that overlaps the chosen month,
  // weighting each sprint's contribution by how many of its days fall in that month.
  // ASSUMPTION: Reliability/Predictability/Quality are weighted averages; Throughput is
  // a weighted sum (prorated contribution to that month); Score is recomputed from the
  // blended Quality/Throughput/Cost rather than blended directly.
  async function calculateMonthBlend() {
    const monthValue = els.monthInput.value;
    const parsedMonth = NQFM.dateUtils.parseMonthInputValue(monthValue);
    if (!parsedMonth) {
      setStatus('Pick a month first.', true);
      return;
    }

    setStatus('Finding overlapping sprints…');
    // Unlike the single-sprint dropdown, this checks every loaded sprint for a month-overlap
    // match rather than truncating to sprintHistoryCount first — that cap exists to keep the
    // dropdown short, not to limit which sprints are eligible for a month blend.
    const overlapping = sprintList
      .map((s) => {
        const start = NQFM.dateUtils.parseJiraDate(s.startDate);
        const end = NQFM.dateUtils.parseJiraDate(s.endDate || s.completeDate);
        const overlapDays = NQFM.dateUtils.daysOverlapWithMonth(start, end, parsedMonth.year, parsedMonth.monthIndex);
        return { sprint: s, overlapDays };
      })
      .filter((x) => x.overlapDays > 0);

    if (overlapping.length === 0) {
      setStatus('No sprints in the loaded history overlap that month. ' + describeSprintListRange(), true);
      els.results.innerHTML = '';
      return;
    }

    setStatus(`Calculating ${overlapping.length} sprint(s)…`);
    const totalOverlapDays = overlapping.reduce((sum, x) => sum + x.overlapDays, 0);

    const perSprint = [];
    for (const x of overlapping) {
      const { metrics } = await computeMetricsForSprint(x.sprint.id);
      perSprint.push({ weight: x.overlapDays / totalOverlapDays, metrics });
    }

    function blendSet(setName) {
      let reliability = 0;
      let predictability = 0;
      let throughput = 0;
      for (const p of perSprint) {
        const m = p.metrics[setName];
        reliability += m.reliability * p.weight;
        predictability += m.predictability * p.weight;
        throughput += m.throughput * p.weight;
      }
      const quality = reliability * predictability;
      const score = settings.cost > 0 ? (quality * throughput) / settings.cost : 0;
      return { reliability, predictability, quality, throughput, cost: settings.cost, score };
    }

    const blended = { standard: blendSet('standard'), alternate: blendSet('alternate') };
    renderMetrics(blended, `${monthValue} blend (${overlapping.length} sprints)`);
    setStatus('');
  }

  function wireModeToggle() {
    document.querySelectorAll('input[name="mode"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        const mode = document.querySelector('input[name="mode"]:checked').value;
        els.sprintField.style.display = mode === 'sprint' ? 'flex' : 'none';
        els.monthField.style.display = mode === 'month' ? 'flex' : 'none';
      });
    });
  }

  async function init() {
    settings = await NQFM.storage.getSettings();
    board = await resolveBoard();
    renderBoardInfo();
    wireModeToggle();

    if (board) await loadSprintList();

    els.refreshBtn.addEventListener('click', loadSprintList);
    els.copySprintListBtn.addEventListener('click', async () => {
      const ok = await NQFM.format.copyToClipboard(JSON.stringify(sprintList, null, 2));
      setStatus(ok ? 'Sprint list JSON copied to clipboard.' : 'Copy failed — select manually.');
    });
    els.calculateBtn.addEventListener('click', async () => {
      try {
        const mode = document.querySelector('input[name="mode"]:checked').value;
        if (mode === 'sprint') await calculateSingleSprint();
        else await calculateMonthBlend();
      } catch (err) {
        setStatus('Error: ' + err.message, true);
      }
    });
  }

  init();
})();
