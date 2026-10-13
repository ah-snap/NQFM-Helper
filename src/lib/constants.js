// Shared constants/defaults used by content script, popup, and options pages.
(function (global) {
  const DEFAULT_SETTINGS = {
    moscowModifiers: { 'Must Have': 5, 'Should Have': 3, 'Could Have': 2, 'Would Have': 1 },
    // Matches the source spreadsheet's L-column formula: OvrC tickets in one of these
    // statuses count as alternate-done even if not plain-completed (G).
    alternateDoneStatuses: ['Ready for Testing - Dev', 'Waiting for Test', 'Verified on Dev', 'Verified on Stage'],
    ovrcTitleKeyword: 'ovrc',
    cost: 4,
    defaultRapidViewId: '',
    sprintHistoryCount: 26
  };

  const TICKET_COLUMNS = [
    { key: 'key', label: 'Key' },
    { key: 'summary', label: 'Summary' },
    { key: 'issueType', label: 'Issue Type' },
    { key: 'priority', label: 'Priority' },
    { key: 'status', label: 'Status' },
    { key: 'storyPoints', label: 'Story Points' },
    { key: 'completed', label: 'Completed' },
    { key: 'unplanned', label: 'Unplanned' },
    { key: 'moscow', label: 'MoSCoW' },
    { key: 'storyValue', label: 'Story Value' },
    { key: 'isOvrC', label: 'Is OvrC' },
    { key: 'isAlternateDone', label: 'Is Alternate Done' },
    { key: 'creditAlreadyTaken', label: 'Credit Already Taken' }
  ];

  const SUMMARY_METRIC_ORDER = ['reliability', 'predictability', 'quality', 'throughput', 'cost', 'score'];

  global.NQFM = global.NQFM || {};
  global.NQFM.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  global.NQFM.TICKET_COLUMNS = TICKET_COLUMNS;
  global.NQFM.SUMMARY_METRIC_ORDER = SUMMARY_METRIC_ORDER;
})(typeof window !== 'undefined' ? window : globalThis);
