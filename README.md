# NQFM Helper

Chrome extension that calculates NQFM sprint quality metrics (Reliability,
Predictability, Quality, Throughput, Score — standard and "Alternate"/OvrC
variants) straight from Jira's sprint report data, instead of hand-copying
into the spreadsheet.

## Load it

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder.
2. Open a sprint report: `https://jira.snapone.com/secure/RapidBoard.jspa?...&chart=sprintRetrospective&sprint=...`
3. A floating "NQFM Helper" panel appears (bottom-right) with the summary metrics
   table, an editable ticket table, and two copy buttons.
4. Click the extension icon from anywhere for the popup (pick a sprint, or
   blend by month).
5. Right-click the icon → Options to configure Cost, MoSCoW modifiers,
   Alternate "Done" statuses, the OvrC keyword, and the default board.

## How metrics are computed

Columns match the spreadsheet: `Completed` (G), `Unplanned` (H), `Story Value` (J),
`Is Alternate Done` (L), `Credit Already Taken` (M). Each sum ranges over all tickets
in the sprint, with the subscript naming the filter applied before summing `J`
(e.g. $\sum_{G=\text{true}} J$ is the total Story Value of completed tickets).

$$\text{Story Value} = \text{Story Points} \times \text{MoSCoW Modifier}$$

(MoSCoW Modifier is configurable; defaults Must/Should/Could/Would Have = 5/3/2/1.)

**Standard**

$$\text{Reliability} = \frac{\sum_{G=\text{true}} J}{\sum J}$$

$$\text{Predictability} = 1 - \frac{\sum_{H=\text{true}} J}{\sum_{G=\text{true}} J}$$

$$\text{Quality} = \text{Reliability} \times \text{Predictability}$$

$$\text{Throughput} = \sum_{G=\text{true}} J$$

$$\text{Score} = \frac{\text{Quality} \times \text{Throughput}}{\text{Cost}}$$

**Alternate (OvrC)** — same Quality/Score shape as Standard, with:

$$\text{Reliability}_{\text{alt}} = \frac{\sum_{L=\text{true},\ M=\text{false}} J}{\sum_{M=\text{false}} J}$$

$$\text{Predictability}_{\text{alt}} = 1 - \frac{\sum_{H=\text{true}} J}{\sum_{L=\text{true},\ M=\text{false}} J}$$

$$\text{Throughput}_{\text{alt}} = \sum_{L=\text{true}} J$$

## Known assumptions (please validate against a live payload)

- The `/rest/greenhopper/1.0/rapid/charts/sprintreport` response shape (completed /
  not-completed / punted / completed-elsewhere issue buckets, `estimateStatistic`
  for story points, `issueKeysAddedDuringSprint` for Unplanned) is based on the
  well-known legacy Greenhopper schema, not a payload I could inspect directly.
  If a column looks wrong, the single place to fix it is `src/lib/sprintReportParser.js`.
- That endpoint doesn't appear to return **priority** or **labels** per issue, so:
  - Priority falls back to `"Not Set"` (matches what your existing plugin showed).
  - MoSCoW has no source signal — defaults to "Must Have", editable per ticket.
  - "Is OvrC" auto-detects only via a title keyword (Options page), not labels yet.
    Label-based detection is possible as a follow-up but needs an extra per-issue
    API call.
- The sprint report page's own DOM wasn't available to inspect, so the panel is a
  self-contained floating overlay rather than being inlined into a specific "status
  report" section. Tell me where you'd like it docked once you see it live.
- Popup/background fetches run by silently opening (and closing) a background
  `jira.snapone.com` tab and executing the request inside it, because a direct
  fetch from the popup's own origin would likely drop the session cookie
  (SameSite). If you keep a Jira tab open already, that existing tab is reused
  instead of opening a new one.
- Month-blend weighting: each overlapping sprint is weighted by
  `(days overlapping the month) / (total overlap days across all contributing sprints)`.
  Reliability/Predictability are weighted averages; Throughput is a weighted sum;
  Score is recomputed from the blended Quality/Throughput rather than blended directly.

## Not yet built (flagged by you as later work)

- Automatic row-shifting/insertion when pasting into the existing spreadsheet.
- Label-based "Is OvrC" detection.
- Multi-board support beyond "last visited" / one configured default.
