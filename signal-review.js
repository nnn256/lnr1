(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LiangceSignalReview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RULE_ID = 'availability_bar_extreme_then_later_close_v1';
  const STATES = ['waiting', 'proxy_confirmed', 'invalidated', 'expired', 'superseded'];

  function calendarDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError('review requires ISO calendar dates');
    const timestamp = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw new RangeError('invalid review calendar day');
    return value;
  }

  function compare(a, b) {
    const tolerance = 64 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
    return a > b + tolerance ? 1 : a < b - tolerance ? -1 : 0;
  }

  function validateBars(bars) {
    if (!Array.isArray(bars)) throw new TypeError('bars must be an array');
    let previous = '';
    return bars.map((raw, index) => {
      const date = calendarDay(raw?.date ?? raw?.time);
      if (date <= previous) throw new RangeError('review bars must be strictly chronological and unique');
      previous = date;
      const values = Object.fromEntries(['open', 'high', 'low', 'close'].map(key => {
        const value = raw[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new RangeError(`bar ${index} ${key} must be a positive finite number`);
        return [key, value];
      }));
      if (compare(values.high, Math.max(values.open, values.close)) < 0 || compare(values.low, Math.min(values.open, values.close)) > 0) throw new RangeError(`bar ${index} has invalid OHLC envelope`);
      return { ...values, date };
    });
  }

  /**
   * Review a published structural candidate using a separate, explicit close-break rule.
   * This does not provide strict Chan confirmation or any order authorization.
   * Input bars are the complete history known at the requested as-of date, in order.
   * Candidates not yet available in that prefix are omitted, rather than backdated.
   */
  function reviewSignals(inputBars, signals, options = {}) {
    const bars = validateBars(inputBars);
    if (!Array.isArray(signals)) throw new TypeError('signals must be an array');
    const expiresAfterBars = options.expiresAfterBars ?? 20;
    if (!Number.isInteger(expiresAfterBars) || expiresAfterBars < 1) throw new RangeError('expiresAfterBars must be a positive integer');
    const levelLabel = options.levelLabel ?? '日线';
    if (typeof levelLabel !== 'string' || levelLabel.length > 20) throw new TypeError('levelLabel must be a short string');
    const indexes = new Map(bars.map((bar, index) => [bar.date, index]));
    const asOf = bars.at(-1)?.date ?? null;
    return signals.flatMap(signal => {
      if (!signal || !['buy', 'sell'].includes(signal.side)) throw new TypeError('signal.side must be buy or sell');
      const availableAt = calendarDay(signal.available_at);
      const availableIndex = indexes.get(availableAt);
      if (availableIndex == null) return [];
      const invalidation = signal.invalidation;
      if (!Number.isFinite(invalidation) || invalidation <= 0) throw new RangeError('signal.invalidation must be a positive finite price');
      const buy = signal.side === 'buy';
      const triggerPrice = bars[availableIndex][buy ? 'high' : 'low'];
      const replacement = signal.episode_id ? signals.filter(next => next !== signal && next.episode_id === signal.episode_id
        && indexes.has(next.available_at) && indexes.get(next.available_at) > availableIndex)
        .sort((a, b) => indexes.get(a.available_at) - indexes.get(b.available_at))[0] : null;
      const replacementIndex = replacement ? indexes.get(replacement.available_at) : null;
      let state = 'waiting', changedAt = availableAt, confirmedAt = null, invalidatedAt = null, expiredAt = null, supersededAt = null;
      let confirmationIndex = null, invalidationIndex = null;
      let reason = `${levelLabel}结构候选已可用；等待后续收盘${buy ? '突破' : '跌破'}候选可用当根${buy ? '最高' : '最低'}价`;
      for (let index = availableIndex + 1; index < bars.length; index++) {
        const bar = bars[index];
        // Intraday ordering is unknowable from OHLC. Losing the structural boundary
        // wins whenever the same candle also satisfies the close-break trigger.
        const invalid = buy ? compare(bar.low, invalidation) < 0 : compare(bar.high, invalidation) > 0;
        if (invalid) {
          state = 'invalidated'; changedAt = invalidatedAt = bar.date; invalidationIndex = index;
          reason = `${levelLabel}后续${buy ? '最低价跌破' : '最高价突破'}结构失效边界；同根若同时触发则保守判为失效`;
          break;
        }
        if (index === replacementIndex) {
          state = 'superseded'; changedAt = supersededAt = bar.date;
          reason = '同一结构过程出现更新后的候选端点，原候选结束观察；保留先前触发证据，不回写历史';
          break;
        }
        if (state === 'waiting') {
          const triggered = buy ? compare(bar.close, triggerPrice) > 0 : compare(bar.close, triggerPrice) < 0;
          if (triggered) {
            state = 'proxy_confirmed'; changedAt = confirmedAt = bar.date; confirmationIndex = index;
            reason = `${levelLabel}后续收盘已${buy ? '突破' : '跌破'}候选可用当根${buy ? '最高' : '最低'}价；仅确认该代理触发条件`;
          } else if (index - availableIndex >= expiresAfterBars) {
            state = 'expired'; changedAt = expiredAt = bar.date;
            reason = `${expiresAfterBars} 根后续 K 线内未满足收盘触发，结束观察；以后不补记为确认`;
            break;
          }
        }
      }
      const label = { waiting: '待触发', proxy_confirmed: `${levelLabel}规则已触发`, invalidated: '已失效', expired: '已过观察期', superseded: '结构已更新' }[state];
      return [{ ...signal, strict_confirmed: false, actionable: false, state_at: asOf,
        confirmation: {
          state, label, rule_id: RULE_ID, rule_scope: 'explicit_close_break_proxy_not_strict_chan',
          available_at: availableAt, trigger_price: triggerPrice, invalidation,
          confirmed_at: confirmedAt, invalidated_at: invalidatedAt, expired_at: expiredAt, superseded_at: supersededAt,
          replacement_candidate_id: supersededAt ? replacement.candidate_id ?? null : null,
          superseded_reason: supersededAt ? 'same_episode_newer_endpoint' : null,
          confirmed_index: confirmationIndex, invalidated_index: invalidationIndex,
          state_changed_at: changedAt, reviewed_at: asOf,
          bars_since_available: bars.length - 1 - availableIndex,
          expires_after_bars: expiresAfterBars, strict_confirmed: false,
          proxy_confirmed: state === 'proxy_confirmed', ever_proxy_confirmed: confirmedAt != null,
          reason
        }
      }];
    });
  }

  function signalCounts(signals) {
    if (!Array.isArray(signals)) throw new TypeError('signals must be an array');
    const counts = { total: signals.length, by_side: { buy: 0, sell: 0 },
      by_class: { buy1: 0, buy2: 0, buy3: 0, sell1: 0, sell2: 0, sell3: 0 },
      by_state: Object.fromEntries(STATES.map(state => [state, 0])), strict_confirmed: 0, proxy_confirmed: 0 };
    for (const signal of signals) {
      if (signal.side in counts.by_side) counts.by_side[signal.side]++;
      const key = signal.side + signal.signal_class;
      if (key in counts.by_class) counts.by_class[key]++;
      const state = signal.confirmation?.state;
      if (state in counts.by_state) counts.by_state[state]++;
      if (state === 'proxy_confirmed') counts.proxy_confirmed++;
      // This module deliberately never promotes strict confirmation.
    }
    return counts;
  }

  return { reviewSignals, signalCounts, RULE_ID };
});
