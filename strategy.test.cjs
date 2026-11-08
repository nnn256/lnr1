const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('./strategy.js');

test('synthetic OHLCV fixture is deterministic and chronological', () => {
  const first = engine.generateSyntheticUniverse();
  const second = engine.generateSyntheticUniverse();
  assert.equal(first.length, 6);
  assert.equal(first[0].bars.length, second[0].bars.length);
  assert.deepEqual(first[0].bars.slice(0, 10), second[0].bars.slice(0, 10));
  assert.ok(first[0].bars.every((bar, index, bars) => !index || bar.date > bars[index - 1].date));
  assert.ok(first[0].bars.every(bar => bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close)));
});

test('position sizing respects per-trade budget, open-risk cap, and board lots', () => {
  const plan = engine.computeTradePlan({ entry: 100, atr: 2, structuralLow: 98 }, {
    accountEquity: 100000, riskPct: 1, maxOpenRiskPct: 3, maxPositionPct: 50,
    atrMultiple: 2, atrBuffer: 0.25, targetR: 2
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.shares % 100, 0);
  assert.ok(plan.plannedRisk <= 1000);
  assert.equal(plan.stop, 96);
  assert.equal(plan.target, 108);

  const capped = engine.computeTradePlan({ entry: 100, atr: 2, structuralLow: 98 }, {
    accountEquity: 100000, riskPct: 1, maxOpenRiskPct: 3, openRisk: 3000,
    maxPositionPct: 50, atrMultiple: 2, atrBuffer: 0.25
  });
  assert.equal(capped.valid, false);
});

test('A-share board limit assumptions distinguish main, growth, and Beijing boards', () => {
  assert.equal(engine.priceLimitRate('600519', '2025-01-02'), 0.1);
  assert.equal(engine.priceLimitRate('300750', '2019-01-02'), 0.1);
  assert.equal(engine.priceLimitRate('300750', '2025-01-02'), 0.2);
  assert.equal(engine.priceLimitRate('830001', '2025-01-02'), 0.3);
});

test('daily multi-period backtest produces reproducible, non-lookahead proxy trades', () => {
  const universe = engine.generateSyntheticUniverse();
  const results = ['2023-01-01', '2024-01-01'].map(startDate => engine.runBacktest(universe, {
    startDate, endDate: '2025-12-31', requireChan: true
  }));
  for (const result of results) {
    assert.ok(result.metrics.tradeCount > 0);
    assert.equal(result.metrics.startDate, result.equityCurve[0].date);
    assert.equal(result.metrics.endDate, '2025-12-31');
    assert.ok(result.trades.every(trade => trade.entryDate > trade.signal.available_at));
    assert.ok(result.trades.every(trade => trade.exitDate > trade.entryDate));
    assert.ok(result.signals.every(signal => signal.definition_mode === 'proxy_research'));
    assert.ok(result.signals.every(signal => signal.trade_level && signal.confirm_level && signal.trigger_level && signal.approximation_loss));
    assert.ok(result.metrics.maxDrawdown >= 0 && result.metrics.maxDrawdown < 1);
  }
  assert.notEqual(results[0].metrics.tradeCount, results[1].metrics.tradeCount);
});
