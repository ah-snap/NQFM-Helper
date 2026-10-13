// NQFM metric calculations.
//
// Column references in comments match the original spreadsheet: G=Completed, H=Unplanned,
// J=Story Value, L=Is Alternate Done, M=Credit Already Taken.
(function (global) {
  const NQFM = (global.NQFM = global.NQFM || {});

  function defaultIsOvrC(ticket, settings) {
    const keyword = (settings.ovrcTitleKeyword || '').toLowerCase().trim();
    if (!keyword) return false;
    const titleMatch = (ticket.summary || '').toLowerCase().includes(keyword);
    const labelMatch = (ticket.labels || []).some((label) => (label || '').toLowerCase().includes(keyword));
    return titleMatch || labelMatch;
  }

  // Applies per-ticket overrides (persisted per sprint) on top of computed defaults,
  // producing every derived column the ticket table and copy formats need.
  function computeTicketDerivedFields(ticket, settings, override) {
    override = override || {};

    const moscow = override.moscow || ticket.moscow || 'Must Have';
    const isOvrC = typeof override.isOvrC === 'boolean' ? override.isOvrC : defaultIsOvrC(ticket, settings);

    // Matches the source spreadsheet: M = AND(G, K) — credit was already taken if this
    // ticket is both OvrC and completed (so a later sprint doesn't double-count it).
    const defaultCreditAlreadyTaken = isOvrC && ticket.completed;
    const creditAlreadyTaken =
      typeof override.creditAlreadyTaken === 'boolean' ? override.creditAlreadyTaken : defaultCreditAlreadyTaken;

    // Matches the source spreadsheet: L = IF(M, FALSE, OR(AND(K, status in list), G)).
    // A ticket already credited never counts again; otherwise it's alternate-done if it's
    // plain-completed OR it's an OvrC ticket that reached one of these configurable statuses.
    const alternateDoneStatuses = (settings.alternateDoneStatuses || []).map((s) => s.toLowerCase());
    const statusMatchesAlternateDone = isOvrC && alternateDoneStatuses.includes((ticket.status || '').toLowerCase());
    const defaultIsAlternateDone = creditAlreadyTaken ? false : ticket.completed || statusMatchesAlternateDone;
    const isAlternateDone =
      typeof override.isAlternateDone === 'boolean' ? override.isAlternateDone : defaultIsAlternateDone;

    const modifier = (settings.moscowModifiers || {})[moscow];
    const storyValue = (Number(ticket.storyPoints) || 0) * (typeof modifier === 'number' ? modifier : 1);

    return Object.assign({}, ticket, { moscow, isOvrC, isAlternateDone, creditAlreadyTaken, storyValue });
  }

  function sumWhere(tickets, predicate) {
    return tickets.reduce((sum, t) => (predicate(t) ? sum + (Number(t.storyValue) || 0) : sum), 0);
  }

  function safeDivide(numerator, denominator) {
    return denominator > 0 ? numerator / denominator : 0;
  }

  // `tickets` must already have derived fields (see computeTicketDerivedFields).
  function computeSummaryMetrics(tickets, cost) {
    const totalStoryValue = sumWhere(tickets, () => true);
    const completedStoryValue = sumWhere(tickets, (t) => t.completed); // G
    const unplannedStoryValue = sumWhere(tickets, (t) => t.unplanned); // H

    const reliability = safeDivide(completedStoryValue, totalStoryValue);
    const predictability = completedStoryValue > 0 ? 1 - safeDivide(unplannedStoryValue, completedStoryValue) : 0;
    const quality = reliability * predictability;
    const throughput = completedStoryValue;
    const score = safeDivide(quality * throughput, cost);

    // Alternate: effective "done" is Is Alternate Done (L); Credit Already Taken (M)
    // tickets are excluded from the reliability numerator/denominator.
    const notCreditedStoryValue = sumWhere(tickets, (t) => !t.creditAlreadyTaken); // M = FALSE
    const altDoneNotCreditedStoryValue = sumWhere(tickets, (t) => t.isAlternateDone && !t.creditAlreadyTaken); // L=TRUE, M=FALSE
    const altDoneStoryValue = sumWhere(tickets, (t) => t.isAlternateDone); // L = TRUE

    const altReliability = safeDivide(altDoneNotCreditedStoryValue, notCreditedStoryValue);
    const altPredictability =
      altDoneNotCreditedStoryValue > 0 ? 1 - safeDivide(unplannedStoryValue, altDoneNotCreditedStoryValue) : 0;
    const altQuality = altReliability * altPredictability;
    const altThroughput = altDoneStoryValue;
    const altScore = safeDivide(altQuality * altThroughput, cost);

    return {
      standard: { reliability, predictability, quality, throughput, cost, score },
      alternate: {
        reliability: altReliability,
        predictability: altPredictability,
        quality: altQuality,
        throughput: altThroughput,
        cost,
        score: altScore
      }
    };
  }

  NQFM.metrics = { computeTicketDerivedFields, computeSummaryMetrics, defaultIsOvrC };
})(typeof window !== 'undefined' ? window : globalThis);
