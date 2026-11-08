const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./signal-review.js');
const C = require('./chanlun.js');
const fixture = require('./tests/fixtures/chanlun-real-daily.json');
const bar = (day, open = 10, high = 12, low = 9, close = 11) => ({ date: `2026-01-${String(day).padStart(2, '0')}`, open, high, low, close });
const buy = { side: 'buy', signal_class: 1, available_at: '2026-01-02', price: 9, invalidation: 9, strict_confirmed: false };
const sell = { side: 'sell', signal_class: 3, available_at: '2026-01-02', price: 12, invalidation: 12, strict_confirmed: false };

test('synthetic fixture confirms only a later closing break, never the publication bar', () => {
  const bars = [bar(1), bar(2), bar(3, 11, 13, 9.5, 12), bar(4, 12, 14, 10, 13)];
  const original = JSON.parse(JSON.stringify(bars));
  const waiting = R.reviewSignals(bars.slice(0, 3), [buy])[0];
  assert.equal(waiting.confirmation.state, 'waiting');
  assert.equal(waiting.confirmation.trigger_price, 12);
  assert.equal(waiting.confirmation.confirmed_at, null);
  const reviewed = R.reviewSignals(bars, [buy])[0];
  assert.equal(reviewed.confirmation.state, 'proxy_confirmed');
  assert.equal(reviewed.confirmation.confirmed_at, '2026-01-04');
  assert.equal(reviewed.confirmation.label, '日线规则已触发');
  assert.equal(reviewed.strict_confirmed, false);
  assert.equal(reviewed.actionable, false);
  assert.equal(reviewed.available_at, buy.available_at);
  assert.equal(reviewed.state_at, bars.at(-1).date);
  assert.deepEqual(bars, original);
});

test('same-bar invalidation wins over a closing trigger for buy and sell', () => {
  const b = R.reviewSignals([bar(1), bar(2), bar(3, 10, 14, 8, 13)], [buy])[0];
  assert.equal(b.confirmation.state, 'invalidated');
  assert.equal(b.confirmation.confirmed_at, null);
  assert.equal(b.confirmation.invalidated_at, '2026-01-03');
  const s = R.reviewSignals([bar(1), bar(2), bar(3, 10, 13, 7, 8)], [sell])[0];
  assert.equal(s.confirmation.state, 'invalidated');
  assert.equal(s.confirmation.confirmed_at, null);
});

test('confirmed candidate can later invalidate while retaining exact trigger time', () => {
  const bars = [bar(1), bar(2), bar(3, 11, 14, 10, 13), bar(4, 10, 11, 8, 9)];
  const result = R.reviewSignals(bars, [buy])[0].confirmation;
  assert.equal(result.state, 'invalidated');
  assert.equal(result.confirmed_at, '2026-01-03');
  assert.equal(result.invalidated_at, '2026-01-04');
  assert.equal(result.ever_proxy_confirmed, true);
  assert.equal(result.proxy_confirmed, false);
});

test('waiting candidate expires after the configured observed bars and cannot confirm later', () => {
  const bars = [bar(1), bar(2), bar(3), bar(4), bar(5, 11, 14, 10, 13)];
  const result = R.reviewSignals(bars, [buy], { expiresAfterBars: 2 })[0].confirmation;
  assert.equal(result.state, 'expired');
  assert.equal(result.expired_at, '2026-01-04');
  assert.equal(result.confirmed_at, null);
  const atDeadline = R.reviewSignals([bar(1), bar(2), bar(3), bar(4, 11, 14, 10, 13)], [buy], { expiresAfterBars: 2 })[0];
  assert.equal(atDeadline.confirmation.state, 'proxy_confirmed');
});

test('sell rule mirrors buy and the label uses the actual reviewed level', () => {
  const bars = [bar(1), bar(2), bar(3, 10, 11, 7, 8)];
  const signal = R.reviewSignals(bars, [sell], { levelLabel: '周线' })[0];
  assert.equal(signal.confirmation.state, 'proxy_confirmed');
  assert.equal(signal.confirmation.trigger_price, 9);
  assert.equal(signal.confirmation.label, '周线规则已触发');
  const counts = R.signalCounts([signal, R.reviewSignals(bars.slice(0, 2), [buy])[0]]);
  assert.deepEqual(counts.by_class, { buy1: 1, buy2: 0, buy3: 0, sell1: 0, sell2: 0, sell3: 1 });
  assert.equal(counts.proxy_confirmed, 1);
  assert.equal(counts.strict_confirmed, 0);
});

test('date prefixes omit unavailable candidates and never expose later state transitions', () => {
  const bars = [bar(1), bar(2), bar(3, 11, 14, 10, 13), bar(4, 10, 11, 8, 9)];
  assert.deepEqual(R.reviewSignals(bars.slice(0, 1), [buy]), []);
  const prefix = R.reviewSignals(bars.slice(0, 2), [buy])[0];
  assert.equal(prefix.confirmation.state, 'waiting');
  assert.equal(prefix.confirmation.confirmed_at, null);
  assert.equal(prefix.confirmation.invalidated_at, null);
  const later = R.reviewSignals(bars.slice(0, 3), [buy])[0];
  assert.equal(later.confirmation.confirmed_at, bars[2].date);
  assert.equal(later.confirmation.invalidated_at, null);
  assert.deepEqual(R.reviewSignals(bars.slice(0, 2), [buy])[0], prefix);
});

test('newer endpoint in the same episode supersedes only when available in the observed prefix', () => {
  const first = { ...buy, episode_id: 'buy|1|previous-down-leg', candidate_id: 'buy:1:old:9' };
  const next = { ...buy, available_at: '2026-01-04', episode_id: first.episode_id, candidate_id: 'buy:1:new:9.5', invalidation: 9.5 };
  const bars = [bar(1), bar(2), bar(3), bar(4, 11, 12.5, 10, 12), bar(5, 11, 14, 8, 13)];
  const prefix = R.reviewSignals(bars.slice(0, 3), [first, next]);
  assert.equal(prefix.length, 1);
  assert.equal(prefix[0].confirmation.state, 'waiting');
  assert.equal(prefix[0].confirmation.superseded_at, null);
  const beforeFutureInvalidation = R.reviewSignals(bars.slice(0, 4), [first, next]);
  assert.equal(beforeFutureInvalidation[0].confirmation.state, 'superseded');
  assert.equal(beforeFutureInvalidation[0].confirmation.label, '结构已更新');
  assert.equal(beforeFutureInvalidation[0].confirmation.superseded_at, '2026-01-04');
  assert.equal(beforeFutureInvalidation[0].confirmation.replacement_candidate_id, next.candidate_id);
  const extended = R.reviewSignals(bars, [first, next]);
  assert.equal(extended[0].confirmation.state, 'superseded');
  assert.equal(extended[0].confirmation.invalidated_at, null);
  assert.equal(extended[1].confirmation.state, 'invalidated');
  assert.equal(R.signalCounts(extended).by_state.superseded, 1);
});

test('invalidation wins on the replacement day; earlier expiry is preserved', () => {
  const first = { ...buy, episode_id: 'same-episode', candidate_id: 'old' };
  const next = { ...buy, episode_id: 'same-episode', candidate_id: 'new', available_at: '2026-01-04' };
  const invalidBars = [bar(1), bar(2), bar(3), bar(4, 10, 12, 8, 11)];
  const invalid = R.reviewSignals(invalidBars, [first, next])[0].confirmation;
  assert.equal(invalid.state, 'invalidated');
  assert.equal(invalid.superseded_at, null);
  const expired = R.reviewSignals([bar(1), bar(2), bar(3), bar(4)], [first, next], { expiresAfterBars: 1 })[0].confirmation;
  assert.equal(expired.state, 'expired');
  assert.equal(expired.expired_at, '2026-01-03');
  assert.equal(expired.superseded_at, null);
});

test('superseding a previously confirmed endpoint retains its original trigger time', () => {
  const first = { ...buy, episode_id: 'same-episode', candidate_id: 'old' };
  const next = { ...buy, episode_id: 'same-episode', candidate_id: 'new', available_at: '2026-01-04' };
  const bars = [bar(1), bar(2), bar(3, 11, 14, 10, 13), bar(4, 11, 13, 10, 12)];
  const result = R.reviewSignals(bars, [first, next])[0].confirmation;
  assert.equal(result.state, 'superseded');
  assert.equal(result.confirmed_at, '2026-01-03');
  assert.equal(result.superseded_at, '2026-01-04');
  assert.equal(result.ever_proxy_confirmed, true);
});

test('real historical candidates retain structural publication time and causal review evidence', () => {
  const bars = fixture.bars.slice(0, 400);
  const signals = C.replay(bars).signals;
  assert.ok(signals.length > 0);
  const reviewed = R.reviewSignals(bars, signals);
  for (let index = 0; index < reviewed.length; index++) {
    const signal = reviewed[index];
    assert.equal(signal.available_at, signals[index].available_at);
    assert.equal(signal.price, signals[index].price);
    assert.equal(signal.strict_confirmed, false);
    assert.equal(signal.confirmation.reviewed_at, bars.at(-1).date);
    for (const field of ['confirmed_at', 'invalidated_at', 'expired_at']) {
      if (signal.confirmation[field]) assert.ok(signal.confirmation[field] > signal.available_at && signal.confirmation[field] <= bars.at(-1).date);
    }
  }
});

test('malformed timelines, invalid bounds and future availability are handled explicitly', () => {
  assert.throws(() => R.reviewSignals([bar(2), bar(1)], [buy]), /chronological/);
  assert.throws(() => R.reviewSignals([bar(1), bar(1)], [buy]), /chronological/);
  assert.throws(() => R.reviewSignals([bar(1)], [], { expiresAfterBars: 0 }), /positive/);
  assert.throws(() => R.reviewSignals([bar(1), bar(2)], [{ ...buy, invalidation: NaN }]), /invalidation/);
  assert.deepEqual(R.reviewSignals([], [buy]), []);
  assert.throws(() => R.reviewSignals([{ ...bar(1), date: '2026-02-30' }], []), /calendar/);
});
