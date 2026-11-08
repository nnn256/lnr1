const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./chart-model.js');
const C = require('./chanlun.js');
const fixture = require('./tests/fixtures/chanlun-real-daily.json');
const bar = (date, open, high, low, close, volume = 100) => ({ date, open, high, low, close, volume });

test('normalization sorts exact duplicate daily bars without mutating source', () => {
  const first = bar('2026-11-02', 10, 12, 9, 11), second = bar('2026-11-03', 11, 14, 10, 13);
  const raw = [second, first, { ...first }];
  const result = M.normalizeBars(raw);
  assert.deepEqual(result.map(row => row.date), ['2026-11-02', '2026-11-03']);
  assert.equal(result[1].prevClose, 11);
  assert.equal(raw[0], second);
  assert.equal(raw.length, 3);
});

test('corrupt calendars, prices, volumes and conflicting daily duplicates fail loudly', () => {
  for (const raw of [bar('2026-02-30', 10, 12, 9, 11), bar('2026-11-02', 10, 9, 8, 11),
    bar('2026-11-02', 10, 12, 9, NaN), bar('2026-11-02', 10, 12, 9, 11, -1)]) {
    assert.throws(() => M.normalizeBars([raw]));
  }
  assert.throws(() => M.normalizeBars([bar('2026-11-02', 10, 12, 9, 11), bar('2026-11-02', 10, 13, 9, 11)]), /conflicting duplicate/);
  assert.equal(M.normalizeBars([bar('2026-11-02', 12.00000001, 12, 9, 11)])[0].high, 12.00000001);
});

test('week and month aggregation uses true source endpoints across calendar boundaries', () => {
  const raw = [bar('2026-10-30', 10, 12, 9, 11, 10), bar('2026-11-02', 12, 14, 11, 13, 20),
    bar('2026-11-03', 13, 16, 10, 15, 30), bar('2026-11-09', 15, 17, 14, 16, 40)];
  const weekly = M.aggregateBars(raw, 'W');
  assert.equal(weekly.length, 3);
  assert.deepEqual([weekly[1].date, weekly[1].open, weekly[1].high, weekly[1].low, weekly[1].close, weekly[1].volume], ['2026-11-03', 12, 16, 10, 15, 50]);
  assert.equal(weekly[1].source_start, '2026-11-02');
  assert.equal(weekly[1].source_end_index, 2);
  const monthly = M.aggregateBars(raw, 'M');
  assert.equal(monthly.length, 2);
  assert.equal(monthly[1].time, '2026-11-09');
  assert.equal(monthly[1].volume, 90);
  assert.throws(() => M.aggregateBars(raw, '60m'), /period/);
});

test('snapshot date and inclusive aggregate cursor never consume future daily data', () => {
  const end = fixture.bars[350].date;
  const snapshot = M.buildSnapshot(fixture, { endDate: end });
  const expected = C.replay(fixture.bars.slice(0, 351));
  assert.equal(snapshot.as_of, end);
  assert.equal(snapshot.source_bar_count, 351);
  assert.deepEqual(snapshot.signals.map(signal => [signal.side, signal.price, signal.available_at]), expected.signals.map(signal => [signal.side, signal.price, signal.available_at]));
  for (const signal of snapshot.signals) {
    assert.equal(signal.time, signal.available_at);
    assert.ok(signal.point_time < signal.available_at);
    assert.ok(signal.available_at <= end);
    assert.equal(signal.strict_confirmed, false);
  }
  const weeks = M.aggregateBars(fixture.bars, 'W');
  const weekly = M.buildSnapshot(fixture, { period: 'W', endIndex: 10 });
  assert.equal(weekly.bars.length, 11);
  assert.equal(weekly.as_of, weeks[10].date);
  assert.ok(weekly.signals.every(signal => signal.trade_level === '1W'));
  assert.ok(weekly.points.every(point => point.available_at <= weekly.as_of));
  const cutDate = fixture.bars[352].date;
  const partial = M.buildSnapshot(fixture, { period: 'W', endDate: cutDate });
  assert.equal(partial.as_of, cutDate);
  assert.equal(partial.bars.at(-1).close, fixture.bars[352].close);
  assert.deepEqual(M.buildSnapshot(fixture, { endIndex: -1 }).bars, []);
});

test('center and stroke exports retain original source ranges and known-at evidence', () => {
  const history = { ...fixture, code: 'sh600519', source: 'local fixture' };
  const snapshot = M.buildSnapshot(history);
  const plan = M.buildDrawingPlan(snapshot, history);
  assert.equal(plan.symbol, 'SSE:600519');
  assert.equal(plan.interval, '1D');
  assert.equal(plan.execution_allowed, false);
  assert.ok(plan.drawings.some(drawing => drawing.type === 'rectangle'));
  assert.ok(plan.drawings.some(drawing => drawing.type === 'trend_line'));
  for (const center of snapshot.centers) {
    assert.equal(center.components.length, 3);
    assert.equal(center.start_time, snapshot.bars[center.start_index].date);
    assert.equal(center.available_at, snapshot.bars[center.available_index].date);
    assert.ok(center.available_index > center.end_index);
  }
  for (const drawing of plan.drawings) {
    assert.ok(drawing.available_at <= plan.as_of);
    assert.equal(drawing.points.length, 2);
    for (const point of drawing.points) {
      assert.ok(Number.isSafeInteger(point.time));
      assert.ok(Number.isFinite(point.price));
      assert.equal(new Date(point.time * 1000).getUTCHours(), 0);
    }
  }
  assert.equal(M.buildDrawingPlan(snapshot, history, { includeStrokes: false, includeCenters: false }).drawings.length, 0);
  assert.equal(plan.structure_completeness, snapshot.structure_completeness);
  const manual = { type: 'horizontal_line', points: [{ time: Date.parse(snapshot.as_of + 'T00:00:00Z') / 1000, price: 10 }] };
  const appended = M.buildDrawingPlan(snapshot, history, { userDrawings: [manual] });
  assert.equal(appended.drawings.at(-1).manual, true);
  assert.throws(() => M.buildDrawingPlan(snapshot, history, { userDrawings: [{ ...manual, points: [{ time: Date.parse('2099-01-01T00:00:00Z') / 1000, price: 10 }] }] }), /beyond/);
});

test('stock mapping preserves zeroes and rejects a conflicting or unverified market', () => {
  assert.equal(M.tradingViewSymbol('000001'), 'SZSE:000001');
  assert.equal(M.tradingViewSymbol('300750.SZ'), 'SZSE:300750');
  assert.equal(M.tradingViewSymbol('SSE:688012'), 'SSE:688012');
  assert.equal(M.tradingViewSymbol('bj920564'), null);
  assert.throws(() => M.tradingViewSymbol('sz600519'), /conflicts/);
  assert.throws(() => M.tradingViewSymbol(1), /string/);
  assert.throws(() => M.tradingViewSymbol('005'), /six digit/);
  assert.throws(() => M.tradingViewSymbol('699999'), /conflicts/);
});
