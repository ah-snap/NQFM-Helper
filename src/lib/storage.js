// chrome.storage wrappers: sync'd settings, per-sprint per-ticket overrides, and the
// last-visited board (used by the popup when the user isn't on a report page).
(function (global) {
  const NQFM = (global.NQFM = global.NQFM || {});

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get({ nqfmSettings: NQFM.DEFAULT_SETTINGS }, (res) => {
        // Merge with defaults so newly-added settings keys don't come back undefined
        // for users who saved settings before those keys existed.
        resolve(Object.assign({}, NQFM.DEFAULT_SETTINGS, res.nqfmSettings));
      });
    });
  }

  function saveSettings(settings) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ nqfmSettings: settings }, resolve);
    });
  }

  function overridesKey(rapidViewId, sprintId) {
    return `nqfm.overrides.${rapidViewId}.${sprintId}`;
  }

  function getOverrides(rapidViewId, sprintId) {
    const key = overridesKey(rapidViewId, sprintId);
    return new Promise((resolve) => {
      chrome.storage.local.get({ [key]: {} }, (res) => resolve(res[key]));
    });
  }

  function saveOverrides(rapidViewId, sprintId, overrides) {
    const key = overridesKey(rapidViewId, sprintId);
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: overrides }, resolve);
    });
  }

  function getLastBoard() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ 'nqfm.lastBoard': null }, (res) => resolve(res['nqfm.lastBoard']));
    });
  }

  function saveLastBoard(board) {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        { 'nqfm.lastBoard': Object.assign({ savedAt: Date.now() }, board) },
        resolve
      );
    });
  }

  function getPanelState() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ 'nqfm.panelState': { collapsed: false, maximized: false } }, (res) =>
        resolve(res['nqfm.panelState'])
      );
    });
  }

  function savePanelState(panelState) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ 'nqfm.panelState': panelState }, resolve);
    });
  }

  NQFM.storage = {
    getSettings,
    saveSettings,
    getOverrides,
    saveOverrides,
    getLastBoard,
    saveLastBoard,
    getPanelState,
    savePanelState
  };
})(typeof window !== 'undefined' ? window : globalThis);
