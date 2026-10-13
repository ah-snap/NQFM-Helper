// Service worker: proxies Jira REST calls for the popup. The popup page itself runs on
// the extension's own origin, so a plain fetch() from there would likely drop Jira's
// session cookie (SameSite). Instead, we find (or briefly open) a jira.snapone.com tab
// and execute the fetch *inside* that page's context, where the cookie is first-party.

const JIRA_ORIGIN_PATTERN = 'https://jira.snapone.com/*';
const JIRA_HOME_URL = 'https://jira.snapone.com/secure/Dashboard.jspa';

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function findOrCreateJiraTab() {
  const tabs = await chrome.tabs.query({ url: JIRA_ORIGIN_PATTERN });
  if (tabs.length > 0) return { tab: tabs[0], created: false };
  const tab = await chrome.tabs.create({ url: JIRA_HOME_URL, active: false });
  await waitForTabComplete(tab.id);
  return { tab, created: true };
}

async function execInTab(tabId, func, args) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return result;
}

async function withJiraTab(work) {
  const { tab, created } = await findOrCreateJiraTab();
  try {
    return await work(tab);
  } finally {
    if (created) chrome.tabs.remove(tab.id);
  }
}

function fetchSprintListInPage(rapidViewId) {
  // The legacy /rest/greenhopper/1.0/sprintquery/{id} endpoint doesn't return sprint
  // dates at all, and (at least on this instance) ignores the rapidViewId and returns
  // sprints from every board. The Agile REST API's board/sprint endpoint is properly
  // scoped to one board and returns real startDate/endDate/completeDate, so use that
  // instead (paginating since a long-lived board can have 100+ sprints).
  async function run() {
    const sprints = [];
    let startAt = 0;
    while (true) {
      const res = await fetch(
        `/rest/agile/1.0/board/${rapidViewId}/sprint?startAt=${startAt}&maxResults=50&state=active,closed`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const page = await res.json();
      const values = page.values || [];
      for (const v of values) {
        sprints.push({
          id: v.id,
          name: v.name,
          state: v.state,
          startDate: v.startDate,
          endDate: v.endDate,
          completeDate: v.completeDate,
          goal: v.goal,
          rapidViewId: v.originBoardId
        });
      }
      if (page.isLast || values.length === 0) break;
      startAt += values.length;
    }
    return { sprints };
  }
  return run();
}


function fetchSprintReportInPage(rapidViewId, sprintId) {
  // Self-contained on purpose: chrome.scripting.executeScript serializes this function and
  // runs it inside the Jira tab, so it can't reference anything outside its own body.
  async function run() {
    const reportRes = await fetch(
      `/rest/greenhopper/1.0/rapid/charts/sprintreport?rapidViewId=${rapidViewId}&sprintId=${sprintId}&_=${Date.now()}`,
      { credentials: 'include' }
    );
    if (!reportRes.ok) throw new Error('HTTP ' + reportRes.status);
    const report = await reportRes.json();

    // The sprintreport endpoint only returns statusId/priorityId/typeId — a point-in-time
    // snapshot — so names are resolved via Jira's global (time-stable) reference lists
    // rather than each ticket's current live status, which can drift after the sprint ends.
    // Labels aren't in the payload at all and still need a per-issue lookup.
    const toIdNameMap = (list) => {
      const map = {};
      (list || []).forEach((item) => {
        map[item.id] = item.name;
      });
      return map;
    };

    const [statusRes, priorityRes, typeRes] = await Promise.all([
      fetch('/rest/api/2/status', { credentials: 'include' }),
      fetch('/rest/api/2/priority', { credentials: 'include' }),
      fetch('/rest/api/2/issuetype', { credentials: 'include' })
    ]);
    const referenceMaps = {
      statusById: statusRes.ok ? toIdNameMap(await statusRes.json()) : {},
      priorityById: priorityRes.ok ? toIdNameMap(await priorityRes.json()) : {},
      issueTypeById: typeRes.ok ? toIdNameMap(await typeRes.json()) : {}
    };

    const contents = report.contents || {};
    const keys = [];
    ['completedIssues', 'issuesCompletedInAnotherSprint', 'issuesNotCompletedInCurrentSprint', 'puntedIssues'].forEach(
      (bucketName) => {
        (contents[bucketName] || []).forEach((issue) => {
          if (issue && issue.key) keys.push(issue.key);
        });
      }
    );

    const labelsByKey = {};
    if (keys.length > 0) {
      const jql = `key in (${keys.join(',')})`;
      const labelsRes = await fetch(
        `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=labels&maxResults=${keys.length}`,
        { credentials: 'include' }
      );
      if (labelsRes.ok) {
        const labelsData = await labelsRes.json();
        (labelsData.issues || []).forEach((issue) => {
          labelsByKey[issue.key] = (issue.fields && issue.fields.labels) || [];
        });
      }
    }

    return { report, referenceMaps, labelsByKey };
  }
  return run();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'FETCH_SPRINT_LIST') {
        const data = await withJiraTab((tab) => execInTab(tab.id, fetchSprintListInPage, [message.rapidViewId]));
        sendResponse({ ok: true, data });
      } else if (message.type === 'FETCH_SPRINT_REPORT') {
        const data = await withJiraTab((tab) =>
          execInTab(tab.id, fetchSprintReportInPage, [message.rapidViewId, message.sprintId])
        );
        sendResponse({ ok: true, data });
      } else {
        sendResponse({ ok: false, error: 'Unknown message type: ' + message.type });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  })();
  return true; // keep the message channel open for the async response
});
