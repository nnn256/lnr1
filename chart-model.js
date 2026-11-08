(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./chanlun.js') : root.Chanlun,
    typeof module === 'object' && module.exports ? require('./signal-review.js') : root.LiangceSignalReview);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LiangceChartModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Chanlun, Review) {
  'use strict';
  const PERIODS = { D: '1D', W: '1W', M: '1M' };
  const LOSS = '方向包含、固定间隔笔和三笔重叠类中枢代理；未完成严格线段、走势递归、同级背驰证明和低级别触发。';

  function day(value, field = 'date') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError(`${field} must be an ISO calendar day`);
    const timestamp = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw new RangeError(`${field} is not a valid calendar day`);
    return value;
  }

  function numeric(value, field, index) {
    if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value))) {
      throw new TypeError(`bar ${index}: ${field} must be finite`);
    }
    return Number(value);
  }

  /** Exact duplicate rows are deduplicated; conflicting same-day rows are rejected. */
  function normalizeBars(input) {
    if (!Array.isArray(input)) throw new TypeError('bars must be an array');
    const unique = new Map();
    for (let index = 0; index < input.length; index++) {
      const raw = input[index];
      if (!raw || typeof raw !== 'object') throw new TypeError(`bar ${index} must be an object`);
      const date = day(raw.date ?? raw.time, `bar ${index} date`);
      const values = Object.fromEntries(['open', 'high', 'low', 'close', 'volume'].map(key => [key, numeric(raw[key], key, index)]));
      if (Math.min(values.open, values.high, values.low, values.close) <= 0 || values.volume < 0) throw new RangeError(`bar ${index}: prices must be positive and volume nonnegative`);
      if (values.high + 1e-7 < Math.max(values.open, values.close) || values.low - 1e-7 > Math.min(values.open, values.close)) throw new RangeError(`bar ${index}: invalid OHLC envelope`);
      // Source decimal rounding can exceed an OHLC envelope by tiny machine error.
      values.high = Math.max(values.high, values.open, values.close);
      values.low = Math.min(values.low, values.open, values.close);
      const result = { date, time: date, ...values };
      if (unique.has(date)) {
        const previous = unique.get(date);
        if (Object.keys(values).some(key => previous[key] !== values[key])) throw new RangeError(`conflicting duplicate bar: ${date}`);
      } else unique.set(date, result);
    }
    const bars = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date));
    return bars.map((bar, index) => ({ ...bar, prevClose: index ? bars[index - 1].close : bar.close }));
  }

  function periodKey(date, period) {
    if (period === 'D') return date;
    if (period === 'M') return date.slice(0, 7);
    const utc = new Date(date + 'T00:00:00Z');
    utc.setUTCDate(utc.getUTCDate() - (utc.getUTCDay() + 6) % 7);
    return utc.toISOString().slice(0, 10);
  }

  function aggregateBars(input, period = 'D') {
    if (!Object.hasOwn(PERIODS, period)) throw new RangeError('period must be D, W or M');
    const source = normalizeBars(input);
    const groups = [];
    for (let index = 0; index < source.length; index++) {
      const bar = source[index], key = periodKey(bar.date, period);
      const previous = groups.at(-1);
      if (!previous || previous.period_key !== key) {
        groups.push({ ...bar, period_key: key, source_start: bar.date, source_end: bar.date,
          source_start_index: index, source_end_index: index, source_count: 1 });
      } else {
        previous.date = previous.time = previous.source_end = bar.date;
        previous.high = Math.max(previous.high, bar.high);
        previous.low = Math.min(previous.low, bar.low);
        previous.close = bar.close;
        previous.volume += bar.volume;
        previous.source_end_index = index;
        previous.source_count++;
      }
    }
    return groups.map((bar, index) => ({ ...bar, prevClose: index ? groups[index - 1].close : bar.close }));
  }

  function enrichAnalysis(analysis, bars) {
    const point = p => ({ ...p, time: bars[p.index]?.date ?? null, available_at: bars[p.available]?.date ?? null });
    const points = analysis.points.map(point);
    const moves = analysis.moves.map((move, index) => ({ ...move, a: point(move.a), b: point(move.b),
      id: `P${index}`, start_index: move.a.index, end_index: move.b.index,
      start_time: bars[move.a.index]?.date ?? null, end_time: bars[move.b.index]?.date ?? null,
      available_index: move.b.available, available_at: bars[move.b.available]?.date ?? null }));
    const centers = analysis.centers.map(center => {
      const lastMove = Number(/^C(\d+)$/.exec(center.id)?.[1]);
      const group = Number.isInteger(lastMove) ? moves.slice(lastMove - 2, lastMove + 1) : [];
      if (group.length !== 3) throw new Error('center has no matching three-stroke evidence');
      const first = group[0], last = group.at(-1);
      return { ...center, start_index: first.start_index, end_index: last.end_index,
        available_index: last.available_index, start_time: first.start_time, end_time: last.end_time,
        available_at: last.available_at, components: group.map(move => move.id) };
    });
    const signals = analysis.signals.map(signal => ({ ...signal, time: signal.available_at,
      point_time: bars[signal.point_index]?.date ?? null, strict_confirmed: false }));
    return { ...analysis, points, moves, centers, signals };
  }

  /** endIndex is inclusive in the aggregated sequence. endDate truncates source days first. */
  function buildSnapshot(history, options = {}) {
    if (!Chanlun?.replay) throw new Error('Chanlun engine must load before chart-model.js');
    const period = options.period ?? 'D';
    let source = normalizeBars(history?.bars ?? []);
    if (options.endDate != null) {
      const end = day(options.endDate, 'endDate');
      source = source.filter(bar => bar.date <= end);
    }
    let bars = aggregateBars(source, period);
    if (options.endIndex != null) {
      if (!Number.isInteger(options.endIndex) || options.endIndex < -1) throw new RangeError('endIndex must be an inclusive integer >= -1');
      bars = bars.slice(0, options.endIndex + 1);
    }
    const analysis = enrichAnalysis(Chanlun.replay(bars), bars);
    analysis.signals.forEach(signal => { signal.trade_level = PERIODS[period]; });
    analysis.signals = Review.reviewSignals(bars, analysis.signals, { levelLabel: { D: '日线', W: '周线', M: '月线' }[period] });
    const sourceBarCount = bars.reduce((sum, bar) => sum + bar.source_count, 0);
    return { bars, analysis, points: analysis.points, moves: analysis.moves, centers: analysis.centers,
      signals: analysis.signals, signal_counts: Review.signalCounts(analysis.signals), as_of: bars.at(-1)?.date ?? null, period,
      source_bar_count: sourceBarCount, code: history?.code ?? '',
      definition_mode: 'structure_proxy', trade_level: PERIODS[period], confirm_level: 'missing',
      trigger_level: 'missing', structure_completeness: 'inclusion/fractal/stroke/center_proxy_only',
      approximation_loss: LOSS, execution_allowed: false };
  }

  function tradingViewSymbol(value) {
    if (typeof value !== 'string') throw new TypeError('stock code must be a string to preserve leading zeroes');
    const text = value.trim().toUpperCase();
    const match = /^(?:(SH|SZ|BJ|SSE|SZSE):?)?(\d{6})(?:\.(SH|SZ|BJ))?$/.exec(text);
    if (!match) throw new RangeError('invalid six digit stock code');
    const [, prefix, code, suffix] = match;
    const family = /^(60|68)/.test(code) ? 'SH' : /^(00|30)/.test(code) ? 'SZ' : /^(4|8|92)/.test(code) ? 'BJ' : null;
    const normalize = exchange => exchange === 'SSE' ? 'SH' : exchange === 'SZSE' ? 'SZ' : exchange;
    if (!family || (prefix && normalize(prefix) !== family) || (suffix && suffix !== family)) throw new RangeError('stock market prefix conflicts with code');
    if (family === 'BJ') return null;
    return (family === 'SH' ? 'SSE:' : 'SZSE:') + code;
  }

  function unixDay(value) {
    return Date.parse(day(value) + 'T00:00:00Z') / 1000;
  }

  function buildDrawingPlan(snapshot, history, options = {}) {
    if (!snapshot || !Array.isArray(snapshot.bars)) throw new TypeError('snapshot is required');
    const symbol = tradingViewSymbol(String(history?.code ?? snapshot.code));
    const drawings = [];
    if (options.includeStrokes !== false) {
      for (const move of snapshot.moves) {
        if (!move.available_at || move.available_at > snapshot.as_of) continue;
        drawings.push({ type: 'trend_line', points: [
          { time: unixDay(move.start_time), price: move.a.price },
          { time: unixDay(move.end_time), price: move.b.price }
        ], available_at: move.available_at, evidence_id: move.id,
        overrides: { linecolor: '#087b68', linewidth: 2 } });
      }
    }
    if (options.includeCenters !== false) {
      for (const center of snapshot.centers) {
        if (!center.available_at || center.available_at > snapshot.as_of) continue;
        drawings.push({ type: 'rectangle', points: [
          { time: unixDay(center.start_time), price: center.zd },
          { time: unixDay(center.end_time), price: center.zg }
        ], available_at: center.available_at, evidence_id: center.id,
        overrides: { color: '#b87724', backgroundColor: '#b87724', transparency: 88, linewidth: 1 } });
      }
    }
    if (options.userDrawings != null) {
      if (!Array.isArray(options.userDrawings)) throw new TypeError('userDrawings must be an array');
      for (const drawing of options.userDrawings) {
        const count = drawing.type === 'horizontal_line' ? 1 : ['trend_line', 'rectangle'].includes(drawing.type) ? 2 : 0;
        if (!count || !Array.isArray(drawing.points) || drawing.points.length !== count) throw new TypeError('invalid user drawing type or point count');
        const points = drawing.points.map(point => {
          if (!Number.isSafeInteger(point.time) || !Number.isFinite(point.price) || point.price <= 0) throw new TypeError('user drawing needs Unix seconds and a positive finite price');
          const date = new Date(point.time * 1000).toISOString().slice(0, 10);
          if (!snapshot.as_of || date > snapshot.as_of) throw new RangeError('user drawing is beyond replay as_of');
          return { time: point.time, price: point.price };
        });
        drawings.push({ ...drawing, points, manual: true });
      }
    }
    return { schema: 'liangce.tradingview.drawings.v1', symbol,
      unsupported_reason: symbol ? null : '未验证北交所在 TradingView 的代码映射；请手动核对目标股票，禁止自动绘制到猜测代码。',
      interval: PERIODS[snapshot.period], as_of: snapshot.as_of, source: history?.source ?? '',
      source_adjustment: history?.adjustment==='provider_unspecified'?'provider_unspecified':history?.adjusted ? 'qfq_as_labeled' : 'unadjusted',
      definition_mode: snapshot.definition_mode, structure_completeness: snapshot.structure_completeness,
      approximation_loss: snapshot.approximation_loss,
      definitions: { trade_level: snapshot.trade_level, confirm_level: snapshot.confirm_level,
        trigger_level: snapshot.trigger_level, definition_mode: snapshot.definition_mode,
        structure_completeness: snapshot.structure_completeness, approximation_loss: snapshot.approximation_loss },
      execution_allowed: false, drawings };
  }

  return { normalizeBars, aggregateBars, buildSnapshot, buildDrawingPlan, tradingViewSymbol };
});
