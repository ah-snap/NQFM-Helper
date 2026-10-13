(function () {
  const NQFM = window.NQFM;

  const els = {
    cost: document.getElementById('cost-input'),
    moscowTableBody: document.querySelector('#moscow-table tbody'),
    addMoscowRow: document.getElementById('add-moscow-row'),
    altDone: document.getElementById('alt-done-input'),
    ovrcKeyword: document.getElementById('ovrc-keyword-input'),
    defaultRapidView: document.getElementById('default-rapidview-input'),
    sprintHistory: document.getElementById('sprint-history-input'),
    saveBtn: document.getElementById('save-btn'),
    saveStatus: document.getElementById('save-status')
  };

  function addMoscowRow(label, modifier) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" class="moscow-label" value="${label ?? ''}" /></td>
      <td><input type="number" class="moscow-modifier" value="${modifier ?? ''}" step="0.5" /></td>
      <td><button type="button" class="nqfm-secondary remove-row">Remove</button></td>
    `;
    tr.querySelector('.remove-row').addEventListener('click', () => tr.remove());
    els.moscowTableBody.appendChild(tr);
  }

  function readMoscowModifiers() {
    const result = {};
    els.moscowTableBody.querySelectorAll('tr').forEach((tr) => {
      const label = tr.querySelector('.moscow-label').value.trim();
      const modifier = Number(tr.querySelector('.moscow-modifier').value);
      if (label) result[label] = isNaN(modifier) ? 1 : modifier;
    });
    return result;
  }

  async function load() {
    const settings = await NQFM.storage.getSettings();
    els.cost.value = settings.cost;
    els.altDone.value = (settings.alternateDoneStatuses || []).join(', ');
    els.ovrcKeyword.value = settings.ovrcTitleKeyword;
    els.defaultRapidView.value = settings.defaultRapidViewId;
    els.sprintHistory.value = settings.sprintHistoryCount;

    els.moscowTableBody.innerHTML = '';
    Object.entries(settings.moscowModifiers || {}).forEach(([label, modifier]) => addMoscowRow(label, modifier));
  }

  async function save() {
    const settings = {
      cost: Number(els.cost.value) || 0,
      moscowModifiers: readMoscowModifiers(),
      alternateDoneStatuses: els.altDone.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      ovrcTitleKeyword: els.ovrcKeyword.value.trim(),
      defaultRapidViewId: els.defaultRapidView.value.trim(),
      sprintHistoryCount: Number(els.sprintHistory.value) || 26
    };
    await NQFM.storage.saveSettings(settings);
    els.saveStatus.textContent = 'Saved.';
    setTimeout(() => (els.saveStatus.textContent = ''), 2000);
  }

  els.addMoscowRow.addEventListener('click', () => addMoscowRow('', 1));
  els.saveBtn.addEventListener('click', save);

  load();
})();
