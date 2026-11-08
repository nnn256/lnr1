(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.QuantStrategy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SYMBOLS = [
    { code: '600519', name: '贵州茅台', sector: '食品饮料', start: 1800, drift: 0.00028, vol: 0.018, seed: 101 },
    { code: '300750', name: '宁德时代', sector: '电池', start: 68, drift: 0.00032, vol: 0.026, seed: 207 },
    { code: '601138', name: '工业富联', sector: '消费电子', start: 8, drift: 0.00038, vol: 0.024, seed: 319 },
    { code: '601899', name: '紫金矿业', sector: '有色金属', start: 4, drift: 0.0003, vol: 0.021, seed: 423 },
    { code: '300308', name: '中际旭创', sector: '通信设备', start: 12, drift: 0.0004, vol: 0.031, seed: 541 },
    { code: '600030', name: '中信证券', sector: '证券', start: 16, drift: 0.0002, vol: 0.022, seed: 653 }
  ];

  function mulberry32(seed) {
    return function () {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function tradingDates(start = '2016-01-04', end = '2025-12-31') {
    const dates = [];
    const cursor = new Date(`${start}T00:00:00Z`);
    const last = new Date(`${end}T00:00:00Z`);
    while (cursor <= last) {
      const day = cursor.getUTCDay();
      if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
  }

  function generateSyntheticUniverse() {
    const dates = tradingDates();
    return SYMBOLS.map((meta, symbolIndex) => {
      const random = mulberry32(meta.seed);
      let close = meta.start;
      const bars = dates.map((date, index) => {
        const regime = Math.sin(index / (104 + symbolIndex * 7)) * 0.0007 + Math.sin(index / 29 + symbolIndex) * 0.00045;
        const noise = (random() + random() + random() - 1.5) * meta.vol;
        const gap = (random() - 0.5) * meta.vol * 0.45;
        const open = Math.max(0.01, close * (1 + gap));
        close = Math.max(0.01, close * (1 + meta.drift + regime + noise));
        const high = Math.max(open, close) * (1 + random() * meta.vol * 0.55);
        const low = Math.max(0.01, Math.min(open, close) * (1 - random() * meta.vol * 0.55));
        const volume = Math.round((550000 + random() * 900000) * (1 + Math.max(-0.6, regime * 500)));
        return { date, open, high, low, close, volume, prevClose: index ? undefined : meta.start };
      });
      bars.forEach((bar, index) => { bar.prevClose = index ? bars[index - 1].close : meta.start; });
      return { ...meta, bars };
    });
  }

  function sma(values, period) {
    const out = Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function ema(values, period) {
    const out = Array(values.length).fill(null);
    const alpha = 2 / (period + 1);
    let current = null;
    values.forEach((value, index) => {
      current = current === null ? value : value * alpha + current * (1 - alpha);
      out[index] = current;
    });
    return out;
  }

  function buildIndicators(bars, params = {}) {
    const closes = bars.map(bar => bar.close);
    const highs = bars.map(bar => bar.high);
    const lows = bars.map(bar => bar.low);
    const volumes = bars.map(bar => bar.volume);
    const ma20 = sma(closes, params.maFast || 20);
    const ma60 = sma(closes, params.maSlow || 60);
    const volume20 = sma(volumes, params.volumePeriod || 20);
    const emaFast = ema(closes, params.macdFast || 12);
    const emaSlow = ema(closes, params.macdSlow || 26);
    const macd = closes.map((_, i) => emaFast[i] - emaSlow[i]);
    const signal = ema(macd, params.macdSignal || 9);
    const tr = bars.map((bar, i) => Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - (i ? bars[i - 1].close : bar.close)),
      Math.abs(bar.low - (i ? bars[i - 1].close : bar.close))
    ));
    const atr = sma(tr, params.atrPeriod || 14);
    const swings = [];
    const swingAt = Array(bars.length).fill(null);
    for (let i = 2; i < bars.length; i += 1) {
      const candidate = i - 1;
      const top = bars[candidate].high > bars[candidate - 1].high && bars[candidate].high >= bars[i].high
        && bars[candidate].low > bars[candidate - 1].low && bars[candidate].low >= bars[i].low;
      const bottom = bars[candidate].low < bars[candidate - 1].low && bars[candidate].low <= bars[i].low
        && bars[candidate].high < bars[candidate - 1].high && bars[candidate].high <= bars[i].high;
      if (!top && !bottom) continue;
      const point = { index: candidate, confirmedAt: i, type: top ? 'top' : 'bottom', price: top ? bars[candidate].high : bars[candidate].low };
      const prior = swings[swings.length - 1];
      if (prior && prior.type === point.type) {
        const moreExtreme = point.type === 'top' ? point.price > prior.price : point.price < prior.price;
        if (moreExtreme) swings[swings.length - 1] = point;
      } else {
        swings.push(point);
      }
      swingAt[i] = point;
    }
    return { ma20, ma60, volume20, macd, macdSignal: signal, atr, swings, swingAt };
  }

  function recentCenterProxy(swings, beforeIndex, minStrokeBars = 3) {
    const confirmed = swings.filter(point => point.confirmedAt < beforeIndex);
    if (confirmed.length < 4) return null;
    for (let end = confirmed.length - 1; end >= Math.max(3, confirmed.length - 8); end -= 1) {
      const points = confirmed.slice(end - 3, end + 1);
      const strokeLengths = points.slice(1).map((point, i) => point.index - points[i].index);
      if (strokeLengths.some(length => length < minStrokeBars)) continue;
      const ranges = points.slice(1).map((point, i) => ({
        high: Math.max(point.price, points[i].price),
        low: Math.min(point.price, points[i].price)
      }));
      const zg = Math.min(...ranges.map(range => range.high));
      const zd = Math.max(...ranges.map(range => range.low));
      if (zg > zd) return { zg, zd, strokeCount: ranges.length, from: points[0].index, to: points[3].index };
    }
    return null;
  }

  function chanThirdBuyProxy(bars, indicators, index, params = {}) {
    const center = recentCenterProxy(indicators.swings, index - 2, params.minStrokeBars || 3);
    if (!center) return null;
    const lookback = params.centerLookback || 30;
    const breakoutStart = Math.max(center.to + 1, index - lookback);
    let breakout = -1;
    for (let i = breakoutStart; i < index - 2; i += 1) {
      if (bars[i].close > center.zg && bars[i - 1].close <= center.zg) breakout = i;
    }
    if (breakout < 0) return null;
    const pullbackLow = Math.min(...bars.slice(breakout + 1, index).map(bar => bar.low));
    const heldAboveCenter = pullbackLow > center.zg;
    const recovery = bars[index].close > bars[index - 1].high && bars[index].close > bars[index].open;
    if (!heldAboveCenter || !recovery) return null;
    return { kind: 'third_buy_proxy', center, breakoutAt: bars[breakout].date, pullbackLow };
  }

  function scoreAt(bars, indicators, index, params = {}) {
    const bar = bars[index];
    const priorHighs = bars.slice(Math.max(0, index - (params.breakoutPeriod || 20)), index).map(item => item.high);
    const priorLow = bars.slice(Math.max(0, index - (params.swingLookback || 20)), index).reduce((low, item) => Math.min(low, item.low), Infinity);
    const breakout = priorHighs.length && bar.close > Math.max(...priorHighs);
    const pullback = bar.low <= indicators.ma20[index] * (1 + (params.pullbackPct || 0.012))
      && bar.close > indicators.ma20[index] && bar.close > bar.open;
    const volumeConfirmed = indicators.volume20[index] && bar.volume >= indicators.volume20[index] * (params.volumeRatio || 1.15);
    const trend = indicators.ma20[index] > indicators.ma60[index];
    const macdConfirmed = indicators.macd[index] > indicators.macdSignal[index] && indicators.macd[index] > 0;
    const chan = chanThirdBuyProxy(bars, indicators, index, params);
    const points = [trend, macdConfirmed, breakout || pullback, volumeConfirmed, Boolean(chan)].filter(Boolean).length;
    return {
      score: points * 20,
      trend,
      macdConfirmed,
      breakout: Boolean(breakout),
      pullback: Boolean(pullback),
      volumeConfirmed: Boolean(volumeConfirmed),
      chan,
      structuralLow: Number.isFinite(priorLow) ? priorLow : bar.low
    };
  }

  function roundPrice(value) { return Math.max(0.01, Math.round(value * 100) / 100); }

  function computeTradePlan(input, params = {}) {
    const equity = Number(params.accountEquity || 1000000);
    const riskPct = Number(params.riskPct || 0.75) / 100;
    const atr = Number(input.atr);
    const entry = Number(input.entry);
    const structuralLow = Number(input.structuralLow);
    const atrMultiple = Number(params.atrMultiple || 2.2);
    if (![equity, atr, entry, structuralLow].every(Number.isFinite) || equity <= 0 || atr <= 0 || entry <= 0) {
      return { valid: false, reason: '缺少有效的权益、入场价、ATR 或结构低点' };
    }
    const swingStop = structuralLow - atr * Number(params.atrBuffer || 0.25);
    const volatilityStop = entry - atr * atrMultiple;
    const stop = roundPrice(Math.min(swingStop, volatilityStop));
    const riskPerShare = entry - stop;
    if (riskPerShare <= 0) return { valid: false, reason: '止损必须低于入场价' };
    const maxOpenRiskPct = Number(params.maxOpenRiskPct || 3) / 100;
    const portfolioRoom = Math.max(0, equity * maxOpenRiskPct - Number(params.openRisk || 0));
    const budget = Math.min(equity * riskPct, portfolioRoom);
    const riskShares = Math.floor(budget / riskPerShare / 100) * 100;
    const exposureShares = Math.floor(equity * Number(params.maxPositionPct || 20) / 100 / entry / 100) * 100;
    const shares = Math.max(0, Math.min(riskShares, exposureShares));
    const target = roundPrice(entry + riskPerShare * Number(params.targetR || 2));
    return {
      valid: shares >= 100,
      reason: shares >= 100 ? '' : '风险预算或可用仓位不足一个 100 股交易单位',
      entry: roundPrice(entry), stop, target,
      riskPerShare: roundPrice(riskPerShare),
      riskBudget: roundPrice(budget),
      shares, lots: shares / 100,
      positionValue: roundPrice(shares * entry),
      plannedRisk: roundPrice(shares * riskPerShare),
      riskPct: shares * riskPerShare / equity * 100,
      rewardRisk: Number(params.targetR || 2)
    };
  }

  const DEFAULT_PARAMS = {
    maFast: 20, maSlow: 60, macdFast: 12, macdSlow: 26, macdSignal: 9,
    breakoutPeriod: 20, pullbackPct: 0.012, volumeRatio: 1.15,
    atrPeriod: 14, atrMultiple: 2.2, atrBuffer: 0.25, trailingAtr: 2.8,
    riskPct: 0.75, maxOpenRiskPct: 3, maxPositionPct: 20,
    accountEquity: 1000000, maxPositions: 4, maxConsecutiveLosses: 3,
    cooldownBars: 10, targetR: 2, commission: 0.0003, stampTax: 0.0005,
    slippage: 0.001, minCommission: 5, requireChan: true, startDate: '2023-01-01', endDate: '2025-12-31'
  };

  function commissionFor(value, params) {
    return Math.max(Number(params.minCommission || 0), value * Number(params.commission || 0));
  }

  function priceLimitRate(code, date) {
    if (/^(43|83|87|88|92)/.test(code)) return 0.3;
    if (/^(30|68)/.test(code)) return date >= '2020-08-24' ? 0.2 : 0.1;
    return 0.1;
  }

  function runBacktest(universe, overrides = {}) {
    const params = { ...DEFAULT_PARAMS, ...overrides };
    const startDate = params.startDate || '2016-01-01';
    const endDate = params.endDate || '2025-12-31';
    const symbols = universe.map(symbol => ({
      ...symbol,
      indicators: buildIndicators(symbol.bars, params)
    }));
    const dates = [...new Set(symbols.flatMap(symbol => symbol.bars
      .filter(bar => bar.date >= startDate && bar.date <= endDate)
      .map(bar => bar.date)))].sort();
    symbols.forEach(symbol => {
      symbol.dateIndexes = new Map(symbol.bars.map((bar, index) => [bar.date, index]));
    });
    let cash = Number(params.accountEquity);
    let realized = 0;
    let maxEquity = cash;
    let maxDrawdown = 0;
    let consecutiveLosses = 0;
    let cooldownUntil = -1;
    const positions = new Map();
    const trades = [];
    const equityCurve = [];
    const dailySignals = [];
    let activeRisk = 0;
    let skippedByRisk = 0;
    let skippedByCooldown = 0;
    let skippedByLimit = 0;

    function remainingRisk(position) {
      const mark = position.lastMark || position.entry;
      return Math.max(0, position.entry - Math.min(position.stop, mark)) * position.qty;
    }

    function closePosition(position, date, rawPrice, reason, final = true) {
      const fill = Math.max(0.01, rawPrice * (1 - Number(params.slippage)));
      const value = fill * position.qty;
      const fee = commissionFor(value, params) + value * Number(params.stampTax || 0);
      const gross = (fill - position.entry) * position.qty;
      const pnl = gross - fee;
      cash += value - fee;
      realized += pnl;
      position.pnl += pnl;
      position.exitDate = date;
      position.exitReason = reason;
      position.qty = 0;
      if (final) {
        const trade = {
          symbol: position.symbol,
          code: position.code,
          entryDate: position.entryDate,
          exitDate: date,
          entry: position.entry,
          exit: fill,
          shares: position.originalQty,
          pnl: position.pnl,
          returnPct: position.positionValue ? position.pnl / position.positionValue * 100 : 0,
          rMultiple: position.initialRisk * position.originalQty ? position.pnl / (position.initialRisk * position.originalQty) : 0,
          reason,
          signal: position.signal
        };
        trades.push(trade);
        consecutiveLosses = trade.pnl < 0 ? consecutiveLosses + 1 : 0;
        if (consecutiveLosses >= Number(params.maxConsecutiveLosses)) {
          cooldownUntil = dateIndex.get(date) + Number(params.cooldownBars);
        }
      }
      return pnl;
    }

    const dateIndex = new Map(dates.map((date, index) => [date, index]));
    for (const date of dates) {
      const globalIndex = dateIndex.get(date);
      activeRisk = 0;
      for (const [code, position] of [...positions]) {
        const symbol = symbols.find(item => item.code === code);
        const index = symbol.dateIndexes.get(date);
        if (!position.qty) continue;
        if (date < position.entryDate) {
          activeRisk += remainingRisk(position);
          continue;
        }
        if (index === undefined) {
          activeRisk += remainingRisk(position);
          continue;
        }
        const bar = symbol.bars[index];
        position.lastMark = bar.close;
        if (date === position.entryDate) {
          activeRisk += remainingRisk(position);
          continue;
        }
        const atr = symbol.indicators.atr[index] || position.entryAtr;
        const limitDownPrice = bar.prevClose * (1 - priceLimitRate(code, date));
        if (bar.close <= limitDownPrice * 1.002 && bar.high <= limitDownPrice * 1.002
          && (bar.open <= position.stop || bar.low <= position.stop)) {
          skippedByLimit += 1;
          activeRisk += remainingRisk(position);
          continue;
        }
        const openThroughStop = bar.open <= position.stop;
        if (openThroughStop || bar.low <= position.stop) {
          closePosition(position, date, openThroughStop ? bar.open : position.stop, '初始/移动止损');
          positions.delete(code);
          continue;
        }
        const oneR = position.entry + position.initialRisk;
        const twoR = position.entry + position.initialRisk * Number(params.targetR);
        if (!position.protected && bar.high >= oneR && bar.low <= position.entry) {
          closePosition(position, date, position.entry, '1R 后回撤保护');
          positions.delete(code);
          continue;
        }
        if (!position.protected && bar.high >= oneR) {
          position.stop = Math.max(position.stop, position.entry);
          position.protected = true;
        }
        if (!position.partialTaken && bar.high >= twoR) {
          const partialQty = Math.floor(position.qty / 2 / 100) * 100;
          if (partialQty >= 100) {
            const partial = { ...position, pnl: 0, qty: partialQty };
            const partialPnl = closePosition(partial, date, twoR, '2R 分批止盈', false);
            position.pnl += partialPnl;
            position.qty -= partialQty;
            position.partialTaken = true;
          } else {
            closePosition(position, date, twoR, '2R 止盈');
            positions.delete(code);
            continue;
          }
        }
        position.highest = Math.max(position.highest, bar.high);
        if (position.partialTaken) {
          position.stop = Math.max(position.stop, position.highest - atr * Number(params.trailingAtr));
        }
        activeRisk += remainingRisk(position);
        if (position.qty <= 0) positions.delete(code);
      }

      const equityAtSignal = cash + [...positions].reduce((sum, [code, position]) => {
        const symbol = symbols.find(item => item.code === code);
        if (date < position.entryDate) return sum + position.entry * position.qty + position.entryFee;
        const index = symbol.dateIndexes.get(date);
        const mark = index === undefined ? position.lastMark || position.entry : symbol.bars[index].close;
        return sum + mark * position.qty;
      }, 0);

      for (const symbol of symbols) {
        const index = symbol.dateIndexes.get(date);
        if (index === undefined || index < 61 || index >= symbol.bars.length - 1 || positions.has(symbol.code)) continue;
        const bar = symbol.bars[index];
        const nextBar = symbol.bars[index + 1];
        if (nextBar.date > endDate) continue;
        const previousClose = bar.prevClose;
        const limitUpPct = priceLimitRate(symbol.code, date);
        const signal = scoreAt(symbol.bars, symbol.indicators, index, params);
        const confirmed = signal.trend && signal.macdConfirmed && signal.volumeConfirmed
          && (signal.breakout || signal.pullback) && (!params.requireChan || Boolean(signal.chan));
        if (!confirmed) continue;
        if (bar.close >= previousClose * (1 + limitUpPct - 0.002)
          || nextBar.open >= bar.close * (1 + limitUpPct - 0.002)) { skippedByLimit += 1; continue; }
        dailySignals.push({
          code: symbol.code, name: symbol.name, date,
          trade_level: '1d', confirm_level: '1d', trigger_level: '1d',
          definition_mode: 'proxy_research',
          structure_completeness: '三根分型→交替摆动笔→三笔重叠类中枢→离开→回拉不入',
          approximation_loss: '未执行包含处理/线段递归/多级别区间套；类中枢为代理；日线确认不等于严格缠论',
          signal_type: signal.chan ? 'third_buy_candidate' : 'trend_entry_proxy',
          available_at: date, score: signal.score, close: bar.close
        });
        if (globalIndex <= cooldownUntil) { skippedByCooldown += 1; continue; }
        if (positions.size >= Number(params.maxPositions)) { skippedByRisk += 1; continue; }
        const entry = nextBar.open * (1 + Number(params.slippage));
        const atr = symbol.indicators.atr[index];
        if (!atr || !Number.isFinite(atr)) continue;
        const plan = computeTradePlan({ entry, atr, structuralLow: signal.structuralLow }, {
          ...params, openRisk: activeRisk, accountEquity: Math.max(1, equityAtSignal)
        });
        if (!plan.valid) { skippedByRisk += 1; continue; }
        const entryValue = plan.shares * entry;
        if (entryValue > cash) { skippedByRisk += 1; continue; }
        if (activeRisk + plan.plannedRisk > equityAtSignal * Number(params.maxOpenRiskPct) / 100) {
          skippedByRisk += 1;
          continue;
        }
        const entryFee = commissionFor(entryValue, params);
        cash -= entryValue + entryFee;
        positions.set(symbol.code, {
          symbol: symbol.name, code: symbol.code, entryDate: nextBar.date,
          entry: plan.entry, qty: plan.shares, originalQty: plan.shares,
          initialRisk: plan.riskPerShare, stop: plan.stop, entryAtr: atr,
          highest: plan.entry, protected: false, partialTaken: false,
          positionValue: entryValue, entryFee,
          pnl: -entryFee, signal: dailySignals[dailySignals.length - 1]
        });
        activeRisk += plan.plannedRisk;
      }

      let unrealized = 0;
      let exposure = 0;
      let pendingValue = 0;
      let pendingFees = 0;
      for (const [code, position] of positions) {
        const symbol = symbols.find(item => item.code === code);
        const index = symbol.dateIndexes.get(date);
        if (date < position.entryDate) {
          pendingValue += position.entry * position.qty;
          pendingFees += position.entryFee;
          continue;
        }
        if (index === undefined) {
          exposure += (position.lastMark || position.entry) * position.qty;
          continue;
        }
        const mark = symbol.bars[index].close;
        position.lastMark = mark;
        unrealized += (mark - position.entry) * position.qty;
        exposure += mark * position.qty;
      }
      const equity = cash + exposure + pendingValue + pendingFees;
      maxEquity = Math.max(maxEquity, equity);
      maxDrawdown = Math.max(maxDrawdown, (maxEquity - equity) / maxEquity);
      equityCurve.push({ date, equity, drawdown: (maxEquity - equity) / maxEquity, realized, unrealized, exposure });
    }

    if (dates.length) {
      const finalDate = dates[dates.length - 1];
      for (const [code, position] of [...positions]) {
        const symbol = symbols.find(item => item.code === code);
        const lastIndex = symbol.bars.findLastIndex(item => item.date <= finalDate);
        const bar = lastIndex >= 0 ? symbol.bars[lastIndex] : null;
        if (bar && position.qty && bar.date > position.entryDate) closePosition(position, bar.date, bar.close, '区间结束平仓');
      }
      const openPositions = [...positions.values()].filter(position => position.qty).map(position => ({
        code: position.code, symbol: position.symbol, entryDate: position.entryDate,
        entry: position.entry, shares: position.qty, mark: position.lastMark || position.entry,
        unrealized: ((position.lastMark || position.entry) - position.entry) * position.qty
      }));
      const finalEquity = cash + openPositions.reduce((sum, position) => sum + position.mark * position.shares, 0);
      if (equityCurve.length) {
        const lastPoint = equityCurve[equityCurve.length - 1];
        lastPoint.equity = finalEquity;
        lastPoint.drawdown = (maxEquity - finalEquity) / maxEquity;
        maxDrawdown = Math.max(maxDrawdown, lastPoint.drawdown);
      }
    }

    const wins = trades.filter(trade => trade.pnl > 0);
    const losses = trades.filter(trade => trade.pnl <= 0);
    const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
    const openPositions = [...positions.values()].filter(position => position.qty).map(position => ({
      code: position.code, symbol: position.symbol, entryDate: position.entryDate,
      entry: position.entry, shares: position.qty, mark: position.lastMark || position.entry,
      unrealized: ((position.lastMark || position.entry) - position.entry) * position.qty
    }));
    const endingEquity = cash + openPositions.reduce((sum, position) => sum + position.mark * position.shares, 0);
    const cagr = dates.length ? (endingEquity / Number(params.accountEquity)) ** (252 / dates.length) - 1 : 0;
    const returns = equityCurve.slice(1).map((point, index) => {
      const previous = equityCurve[index].equity;
      return previous ? point.equity / previous - 1 : 0;
    });
    const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
    const variance = returns.length ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length : 0;
    const sharpe = variance > 0 ? mean / Math.sqrt(variance) * Math.sqrt(252) : 0;
    return {
      params, trades, signals: dailySignals, equityCurve, openPositions,
      metrics: {
        startDate: dates[0] || '', endDate: dates[dates.length - 1] || '',
        startingEquity: Number(params.accountEquity), endingEquity,
        totalReturn: endingEquity / Number(params.accountEquity) - 1,
        cagr, maxDrawdown, winRate: trades.length ? wins.length / trades.length : 0,
        tradeCount: trades.length, wins: wins.length, losses: losses.length,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
        averageTrade: trades.length ? trades.reduce((sum, trade) => sum + trade.pnl, 0) / trades.length : 0,
        sharpe, exposurePct: equityCurve.length ? equityCurve.filter(point => point.exposure > 0).length / equityCurve.length : 0,
        skippedByRisk, skippedByCooldown, skippedByLimit
      },
      metadata: {
        definition_mode: 'proxy_research',
        approximation_loss: '分型/笔/类中枢与三买为可复核代理；无包含处理、线段递归、低级别确认、幸存者/停牌复原',
        execution: '信号收盘后次日开盘成交；T+1；100 股整手；涨跌停锁板无法成交；保守止损优先；手续费/印花税/滑点按参数扣除'
      }
    };
  }

  return {
    SYMBOLS, DEFAULT_PARAMS, tradingDates, generateSyntheticUniverse,
    sma, ema, buildIndicators, recentCenterProxy, chanThirdBuyProxy,
    scoreAt, computeTradePlan, runBacktest, priceLimitRate
  };
});
