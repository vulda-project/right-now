'use strict';

// ─────────────────────────────────────────────
//  PriceGenerator  (port of PriceGenerator.cs)
// ─────────────────────────────────────────────
class PriceGenerator {
  static STREAK_THRESHOLD         = 3;
  static STREAK_PRESSURE_PER_CANDLE = 15;
  static MAX_STREAK_PRESSURE      = 90;
  static HEADWIND_MIN_INTERVAL    = 3;
  static HEADWIND_MAX_INTERVAL    = 7;
  static HEADWIND_BIAS            = 20;
  static HEADWIND_TREND_MIN       = 3;
  static R_CONST                  = 0.005;

  constructor(startPrice = 1200, s = 0.05, k = 40, nPerCandle = 20) {
    this.currentPrice = Math.max(0.01, startPrice);
    this.k            = Math.max(1, k);
    this.s            = Math.max(1e-6, s);
    this.nPerCandle   = Math.max(1, nPerCandle);

    this.recentReturns = new Float64Array(this.k);
    this.returnCount   = 0;
    this.returnIndex   = 0;

    this.candleOpen            = this.currentPrice;
    this.ticksInCurrentCandle  = 0;
    this.consecutiveCandles    = 0;

    this.headwindActive   = 0;
    this.headwindCooldown = this._sampleHeadwindInterval();
  }

  /** Advance one tick and return new price. context = { order, volatility, luck, momentum, eventDirectionBias } */
  nextPrice(context) {
    const prev = this.currentPrice;

    // 1) return stats
    const { pk, nk, avgUpAbs, avgDownAbs } = this._computeReturnStats();

    // 2) order flags
    const oLong  = (context.order && context.order.side === 'buy')  ? 1 : 0;
    const oShort = (context.order && context.order.side === 'sell') ? 1 : 0;

    // 3) clamp 0-100
    const Cl = Math.min(100, Math.max(0, context.luck       || 0));
    const Cm = Math.min(100, Math.max(0, context.momentum   || 0));
    const Cv = Math.min(100, Math.max(0, context.volatility || 0));

    // 4) V(C)
    const V = this._computeV(Cv);

    // 5) N
    const dPN = pk + nk;
    const Np  = dPN > 0 ? (pk / dPN) * 100 : 0;
    const Nn  = dPN > 0 ? (nk / dPN) * 100 : 0;

    // 6) L — zeroed during headwind
    let Lp = this.headwindActive > 0 ? 0 : oLong  * Cl;
    let Ln = this.headwindActive > 0 ? 0 : oShort * Cl;

    // 7) M
    const Mp = avgUpAbs > avgDownAbs ? Cm : 0;
    const Mn = avgUpAbs < avgDownAbs ? Cm : 0;

    // 8) Q base
    let Qp = 100 + Lp + Mp - Np;
    let Qn = 100 + Ln + Mn - Nn;

    // headwind directional bias
    if (this.headwindActive > 0) {
      if (this.consecutiveCandles > 0) Qn += PriceGenerator.HEADWIND_BIAS;
      else if (this.consecutiveCandles < 0) Qp += PriceGenerator.HEADWIND_BIAS;
    }

    // event bias
    const eb = context.eventDirectionBias || 0;
    if (eb > 0) Qp += eb;
    else if (eb < 0) Qn += (-eb);

    // streak pressure
    const sAbs = Math.abs(this.consecutiveCandles);
    const sp   = Math.min(
      PriceGenerator.MAX_STREAK_PRESSURE,
      Math.max(0, sAbs - PriceGenerator.STREAK_THRESHOLD) * PriceGenerator.STREAK_PRESSURE_PER_CANDLE
    );
    if (this.consecutiveCandles > 0) Qn += sp;
    else if (this.consecutiveCandles < 0) Qp += sp;

    // 9-11) sample direction + normal + R
    const S = this._sampleDirection(Qp, Qn);
    const Z = this._sampleStandardNormal();
    const R = PriceGenerator.R_CONST * Math.abs(Z) * V * S;

    // 12) next price
    let next = prev * (1 + R);
    if (!isFinite(next) || isNaN(next)) next = prev;
    next = Math.max(0.01, next);

    // 13) push return history
    const ret = (next - prev) / Math.max(1e-6, prev);
    this._pushReturn(ret);
    this.currentPrice = next;

    // 14) candle boundary tracking
    if (this.ticksInCurrentCandle === 0) this.candleOpen = prev;
    this.ticksInCurrentCandle++;

    if (this.ticksInCurrentCandle >= this.nPerCandle) {
      const isUp = next >= this.candleOpen;
      this.consecutiveCandles = isUp
        ? (this.consecutiveCandles > 0 ? this.consecutiveCandles + 1 : 1)
        : (this.consecutiveCandles < 0 ? this.consecutiveCandles - 1 : -1);
      this.ticksInCurrentCandle = 0;

      // headwind update
      if (this.headwindActive > 0) {
        this.headwindActive--;
      } else {
        this.headwindCooldown--;
        if (this.headwindCooldown <= 0) {
          if (Math.abs(this.consecutiveCandles) >= PriceGenerator.HEADWIND_TREND_MIN) {
            this.headwindActive = Math.random() < 0.5 ? 1 : 2;
          }
          this.headwindCooldown = this._sampleHeadwindInterval();
        }
      }
    }

    return this.currentPrice;
  }

  // ── private helpers ──────────────────────────────────────

  _computeV(Cv) {
    const denom = 1 - Math.exp(-100 * this.s);
    const safe  = Math.abs(denom) < 1e-8 ? 1e-8 : denom;
    const ratio = (1 - Math.exp(-this.s * Cv)) / safe;
    return Math.min(1, Math.max(1e-6, 0.1 + 0.9 * ratio));
  }

  _sampleDirection(Qp, Qn) {
    const sum = Qp + Qn;
    const pUp = (isFinite(sum) && sum > 1e-6) ? Math.min(1, Math.max(0, Qp / sum)) : 0.5;
    return Math.random() < pUp ? 1 : -1;
  }

  _pushReturn(r) {
    this.recentReturns[this.returnIndex] = r;
    this.returnIndex  = (this.returnIndex + 1) % this.k;
    this.returnCount  = Math.min(this.returnCount + 1, this.k);
  }

  _computeReturnStats() {
    let pk = 0, nk = 0, sumUp = 0, sumDown = 0;
    for (let i = 0; i < this.returnCount; i++) {
      const r = this.recentReturns[i];
      if (r > 0) { pk++; sumUp   += Math.abs(r); }
      else if (r < 0) { nk++; sumDown += Math.abs(r); }
    }
    return {
      pk, nk,
      avgUpAbs:   pk > 0 ? sumUp   / pk : 0,
      avgDownAbs: nk > 0 ? sumDown / nk : 0,
    };
  }

  _sampleStandardNormal() {
    // Box-Muller transform
    const u1 = Math.max(Number.EPSILON, 1 - Math.random());
    const u2 = 1 - Math.random();
    const z  = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
    return isFinite(z) ? z : 0;
  }

  _sampleHeadwindInterval() {
    const range = PriceGenerator.HEADWIND_MAX_INTERVAL - PriceGenerator.HEADWIND_MIN_INTERVAL + 1;
    return PriceGenerator.HEADWIND_MIN_INTERVAL + Math.floor(Math.random() * range);
  }
}


// ─────────────────────────────────────────────
//  ChartGame  (simplified for HTML5 ad)
// ─────────────────────────────────────────────
class ChartGame {
  static N_PER_CANDLE    = 20;
  static VISIBLE_CANDLES = 10;  // 원본과 유사한 캔들 수 (원본 초기표시 4~8개)

  constructor(balance, leverage, variables) {
    this.balance   = balance;
    this.leverage  = leverage;
    this.variables = { eventDirectionBias: 0, ...variables };
    this.order     = null;

    this.generator = new PriceGenerator(1200, 0.05, 40, ChartGame.N_PER_CANDLE);

    // ── 캔들 안정성: 완성 캔들과 진행 중 캔들을 분리 유지 ──
    // 완성된 캔들은 이후 절대로 변경되지 않음
    this._completedCandles = [];  // { open, high, low, close }
    this._currentTicks     = [];  // 현재 캔들에 쌓이는 가격들
    this._prevClose        = null; // 직전 완성 캔들의 종가

    this.onOrderClosed = null;
    this.onLiquidation = null;

    // 초기 히스토리 생성 (15캔들 분량)
    for (let i = 0; i < ChartGame.N_PER_CANDLE * 15; i++) {
      this._addTick(this.generator.nextPrice(this._ctx()));
    }
  }

  // ── public API ───────────────────────────────────────────

  advance() {
    const price = this.generator.nextPrice(this._ctx());
    this._addTick(price);
    if (this.order) this._checkConditions(price);
    return price;
  }

  getLastPrice() {
    if (this._currentTicks.length > 0)
      return this._currentTicks[this._currentTicks.length - 1];
    if (this._completedCandles.length > 0)
      return this._completedCandles[this._completedCandles.length - 1].close;
    return 1200;
  }

  submitOrder(side, balanceUsagePct = 1.0) {
    if (this.order) {
      if (this.order.side !== side) this._closeOrder(this.getLastPrice(), 'manual');
      return false;
    }
    const price    = this.getLastPrice();
    const pct      = Math.min(1, Math.max(0.01, balanceUsagePct));
    const margin   = this.balance * pct;
    const notional = margin * this.leverage;
    if (notional <= 0 || price <= 0) return false;
    this.balance -= margin;
    this.order    = { side, entryPrice: price, quantity: notional / price, margin };
    return true;
  }

  closeOrder() {
    if (this.order) this._closeOrder(this.getLastPrice(), 'manual');
  }

  getUnrealizedPnl() {
    return this.order ? this._calcPnl(this.getLastPrice()) : 0;
  }

  getTotalEquity() {
    return this.order
      ? this.balance + this.order.margin + this.getUnrealizedPnl()
      : this.balance;
  }

  getPnlPercent() {
    if (!this.order || this.order.margin <= 0) return 0;
    return (this.getUnrealizedPnl() / this.order.margin) * 100;
  }

  /** 렌더러에 전달할 캔들 배열. 완성 캔들은 변경되지 않음. */
  getVisibleCandles() {
    const vis       = ChartGame.VISIBLE_CANDLES;
    const completed = this._completedCandles.slice(-(vis - 1));
    const result    = [...completed];

    if (this._currentTicks.length > 0) {
      const ticks = this._currentTicks;
      const open  = this._prevClose ?? ticks[0];
      let high = ticks[0], low = ticks[0];
      for (const p of ticks) {
        if (p > high) high = p;
        if (p < low)  low  = p;
      }
      result.push({ open, high, low, close: ticks[ticks.length - 1], incomplete: true });
    }
    return result;
  }

  // ── private ──────────────────────────────────────────────

  /** 틱 추가. N_PER_CANDLE 도달 시 완성 캔들로 확정 → 이후 불변. */
  _addTick(price) {
    this._currentTicks.push(price);
    if (this._currentTicks.length >= ChartGame.N_PER_CANDLE) {
      const ticks = this._currentTicks;
      const open  = this._prevClose ?? ticks[0];
      const close = ticks[ticks.length - 1];
      let high = ticks[0], low = ticks[0];
      for (const p of ticks) {
        if (p > high) high = p;
        if (p < low)  low  = p;
      }
      this._completedCandles.push({ open, high, low, close });
      if (this._completedCandles.length > 200) this._completedCandles.shift();
      this._prevClose    = close;
      this._currentTicks = [];
    }
  }

  _ctx() {
    return {
      order:              this.order,
      volatility:         this.variables.volatility,
      luck:               this.variables.luck,
      momentum:           this.variables.momentum,
      eventDirectionBias: this.variables.eventDirectionBias,
    };
  }

  _calcPnl(price) {
    if (!this.order) return 0;
    const ne = this.order.entryPrice * this.order.quantity;
    const nn = price                 * this.order.quantity;
    return this.order.side === 'buy' ? nn - ne : ne - nn;
  }

  _checkConditions(price) {
    if (this.balance + this.order.margin + this._calcPnl(price) <= 0)
      this._closeOrder(price, 'liquidation');
  }

  _closeOrder(price, reason) {
    if (!this.order) return;
    const pnl     = this._calcPnl(price);
    this.balance  = Math.max(0, this.balance + this.order.margin + pnl);
    this.order    = null;
    if (reason === 'liquidation' && this.onLiquidation) this.onLiquidation();
    else if (this.onOrderClosed) this.onOrderClosed(reason, pnl);
  }
}
