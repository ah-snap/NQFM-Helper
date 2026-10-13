// Normalizes the raw `/rest/greenhopper/1.0/rapid/charts/sprintreport` response into
// the flat ticket shape the rest of the extension works with.
//
// CONFIRMED against a live payload: this endpoint's issue objects only carry
// `statusId` / `priorityId` / `typeId` (no `.name` anywhere). These IDs are the sprint
// report's own point-in-time snapshot, so they're kept on the ticket and resolved to names
// via `applyFieldEnrichment()` using Jira's global id->name reference lists (see
// jiraApi.js / background.js) — NOT via a live per-issue lookup, which would return each
// ticket's CURRENT status/priority instead of what the report captured.
(function (global) {
  const NQFM = (global.NQFM = global.NQFM || {});

  function parseSprintReport(raw) {
    const contents = raw.contents || {};
    const sprint = raw.sprint || {};
    const addedDuringSprint = contents.issueKeysAddedDuringSprint || {};

    // Order matters only for de-duping; an issue completed in another sprint should still
    // count as completed here.
    const buckets = [
      { list: contents.completedIssues || [], completed: true },
      { list: contents.issuesCompletedInAnotherSprint || [], completed: true },
      { list: contents.issuesNotCompletedInCurrentSprint || [], completed: false },
      { list: contents.puntedIssues || [], completed: false }
    ];

    const seen = new Set();
    const tickets = [];
    for (const bucket of buckets) {
      for (const issue of bucket.list) {
        if (!issue || !issue.key || seen.has(issue.key)) continue;
        seen.add(issue.key);

        const storyPoints = issue.estimateStatistic && issue.estimateStatistic.statFieldValue
          ? issue.estimateStatistic.statFieldValue.value
          : undefined;

        tickets.push({
          key: issue.key,
          summary: issue.summary || '',
          issueType: '', // filled in by applyFieldEnrichment, from typeId below
          priority: 'Not Set', // filled in by applyFieldEnrichment, from priorityId below
          status: '', // filled in by applyFieldEnrichment, from statusId below
          statusId: issue.statusId,
          priorityId: issue.priorityId,
          issueTypeId: issue.typeId,
          labels: [], // filled in by applyFieldEnrichment
          storyPoints: typeof storyPoints === 'number' ? storyPoints : 0,
          // Bucket membership (not the per-issue `done` flag) is the source of truth for
          // "completed in this sprint" — `done` reflects the issue's current status, which
          // can be true even for tickets the sprint report itself bucketed as not completed.
          completed: bucket.completed,
          unplanned: Boolean(addedDuringSprint[issue.key]),
          // No MoSCoW signal is available from this endpoint; default and let the user adjust.
          moscow: 'Must Have'
        });
      }
    }

    return {
      sprint: {
        id: sprint.id,
        name: sprint.name,
        state: sprint.state,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        completeDate: sprint.completeDate
      },
      tickets
    };
  }

  // Resolves each ticket's statusId/priorityId/issueTypeId against Jira's global reference
  // maps, and merges in labels from a per-issue lookup (see jiraApi.js / background.js).
  function applyFieldEnrichment(tickets, referenceMaps, labelsByKey) {
    const { statusById, priorityById, issueTypeById } = referenceMaps || {};
    for (const ticket of tickets) {
      if (statusById && statusById[ticket.statusId]) ticket.status = statusById[ticket.statusId];
      if (priorityById && priorityById[ticket.priorityId]) ticket.priority = priorityById[ticket.priorityId];
      if (issueTypeById && issueTypeById[ticket.issueTypeId]) ticket.issueType = issueTypeById[ticket.issueTypeId];
      const labels = labelsByKey && labelsByKey[ticket.key];
      if (Array.isArray(labels)) ticket.labels = labels;
    }
    return tickets;
  }

  NQFM.sprintReportParser = { parse: parseSprintReport, applyFieldEnrichment };
})(typeof window !== 'undefined' ? window : globalThis);
