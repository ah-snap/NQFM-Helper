// Same-origin helper for resolving what the sprintreport endpoint omits:
// - status/priority/issue-type NAMES for the statusId/priorityId/typeId it does give us.
//   These are resolved via Jira's global reference lists (id -> name is stable over time),
//   NOT via a per-issue lookup — a per-issue lookup returns each ticket's CURRENT live
//   status, which can differ from the statusId the sprint report captured historically
//   (e.g. a punted ticket resolved weeks after the sprint ended).
// - labels, which aren't in the sprintreport payload at all and must come from a live
//   per-issue lookup (labels aren't ID-coded, so there's no stable-over-time concern here).
// Used directly by the content script; background.js keeps its own self-contained copy
// of this logic since functions injected via chrome.scripting.executeScript can't
// reference outside modules.
(function (global) {
  const NQFM = (global.NQFM = global.NQFM || {});

  function toIdNameMap(list) {
    const map = {};
    for (const item of list || []) map[item.id] = item.name;
    return map;
  }

  async function fetchReferenceMaps() {
    const [statusRes, priorityRes, typeRes] = await Promise.all([
      fetch('/rest/api/2/status', { credentials: 'include' }),
      fetch('/rest/api/2/priority', { credentials: 'include' }),
      fetch('/rest/api/2/issuetype', { credentials: 'include' })
    ]);
    if (!statusRes.ok || !priorityRes.ok || !typeRes.ok) {
      throw new Error('Failed to load status/priority/issue-type reference data');
    }
    const [statuses, priorities, types] = await Promise.all([statusRes.json(), priorityRes.json(), typeRes.json()]);
    return {
      statusById: toIdNameMap(statuses),
      priorityById: toIdNameMap(priorities),
      issueTypeById: toIdNameMap(types)
    };
  }

  async function fetchLabelsByKey(keys) {
    if (!keys || keys.length === 0) return {};
    const jql = `key in (${keys.join(',')})`;
    const url = `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=labels&maxResults=${keys.length}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to load issue labels (HTTP ${res.status})`);
    const data = await res.json();
    const map = {};
    for (const issue of data.issues || []) {
      map[issue.key] = (issue.fields && issue.fields.labels) || [];
    }
    return map;
  }

  NQFM.jiraApi = { fetchReferenceMaps, fetchLabelsByKey };
})(typeof window !== 'undefined' ? window : globalThis);
