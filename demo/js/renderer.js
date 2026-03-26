'use strict';

// ─────────────────────────────────────────────
//  ChartRenderer  — Canvas 2D candlestick chart
//  색상값은 GameConstants.cs / CandlesGraphic.cs 원본과 동일
// ─────────────────────────────────────────────
class ChartRenderer {
  // CandlesGraphic.cs: upColor = Color(0.2f, 0.9f, 0.4f) = #33E666
  //                    downColor = Color(0.9f, 0.2f, 0.3f) = #E6334D
  static UP_COLOR   = '#33E666';
  static DOWN_COLOR = '#E6334D';

  // GameConstants.cs: CurrentPrice = #FFCC57
  // 스크린샷에서는 회색에 가까운 선이므로 회색 사용
  static PRICE_LINE_COLOR = 'rgba(180, 195, 215, 0.75)';

  // GameConstants.cs: LongOrder = #119000, ShortOrder = #902E2E
  static LONG_LINE_COLOR  = '#119000';
  static SHORT_LINE_COLOR = '#902E2E';

  // GameConstants.cs: TakeProfit = #2CD46E, StopLoss = #E85555
  static TP_COLOR = '#2CD46E';
  static SL_COLOR = '#E85555';

  static BG_COLOR      = '#3a4d61';   // chart panel 배경과 동일
  static V_PAD_RATIO   = 0.12;        // 상하 여백 비율
  static CANDLE_GAP    = 0.25;        // 캔들 간격 비율

  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this._dpr   = window.devicePixelRatio || 1;
    this._w = 0;
    this._h = 0;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const dpr = this._dpr;
    const w   = this.canvas.clientWidth;
    const h   = this.canvas.clientHeight;
    if (w === this._w && h === this._h) return;
    this.canvas.width  = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = w;
    this._h = h;
  }

  /**
   * @param {Array<{open,high,low,close,incomplete}>} candles
   * @param {number|null}     entryPrice
   * @param {'buy'|'sell'|null} side
   * @param {number}          currentPrice
   */
  draw(candles, entryPrice, side, currentPrice) {
    this._resize();
    const ctx = this.ctx;
    const W   = this._w;
    const H   = this._h;

    // 배경
    ctx.fillStyle = ChartRenderer.BG_COLOR;
    ctx.fillRect(0, 0, W, H);

    if (!candles || candles.length === 0) return;

    // ── 가격 범위 ───────────────────────────────
    let pMin = Infinity, pMax = -Infinity;
    for (const c of candles) {
      if (c.low  < pMin) pMin = c.low;
      if (c.high > pMax) pMax = c.high;
    }
    if (entryPrice != null) {
      if (entryPrice < pMin) pMin = entryPrice;
      if (entryPrice > pMax) pMax = entryPrice;
    }
    if (currentPrice < pMin) pMin = currentPrice;
    if (currentPrice > pMax) pMax = currentPrice;

    const range = pMax - pMin || 1;
    const pad   = range * ChartRenderer.V_PAD_RATIO;
    const lo    = pMin - pad;
    const hi    = pMax + pad;
    const span  = hi - lo;

    const toY = (p) => H - ((p - lo) / span) * H;

    // ── 수평 그리드 (매우 흐리게) ───────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth   = 1;
    for (let i = 1; i < 4; i++) {
      const y = (H / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // ── 캔들 ───────────────────────────────────
    const n         = candles.length;
    const stepW     = W / n;
    const gapW      = stepW * ChartRenderer.CANDLE_GAP;
    const bodyW     = Math.max(2, stepW - gapW);
    const wickW     = Math.max(1, Math.round(bodyW * 0.12));

    for (let i = 0; i < n; i++) {
      const c    = candles[i];
      const isUp = c.close >= c.open;
      const cx   = i * stepW + stepW / 2;
      const color = isUp ? ChartRenderer.UP_COLOR : ChartRenderer.DOWN_COLOR;

      // 심지
      ctx.strokeStyle = color;
      ctx.lineWidth   = wickW;
      ctx.beginPath();
      ctx.moveTo(cx, toY(c.high));
      ctx.lineTo(cx, toY(c.low));
      ctx.stroke();

      // 바디
      const bTop = toY(Math.max(c.open, c.close));
      const bBot = toY(Math.min(c.open, c.close));
      const bH   = Math.max(1, bBot - bTop);

      ctx.globalAlpha = c.incomplete ? 0.55 : 1;
      ctx.fillStyle   = color;
      ctx.fillRect(cx - bodyW / 2, bTop, bodyW, bH);
      ctx.globalAlpha = 1;
    }

    // ── TP / SL 라인 (포지션 있을 때) ──────────
    // (HTML5 버전에서는 TP/SL 직접 설정 UI 없으므로 생략)

    // ── 진입가 라인 ─────────────────────────────
    if (entryPrice != null && side) {
      const col = side === 'buy' ? ChartRenderer.LONG_LINE_COLOR : ChartRenderer.SHORT_LINE_COLOR;
      this._dashedLine(toY(entryPrice), col, 1.5, [8, 5]);
      this._priceTag(entryPrice, toY(entryPrice), col);
    }

    // ── 현재가 라인 ─────────────────────────────
    this._dashedLine(toY(currentPrice), ChartRenderer.PRICE_LINE_COLOR, 1, [5, 4]);
  }

  // ── 유틸 ─────────────────────────────────────

  _dashedLine(y, color, lw, dash) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = lw;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(this._w, y);
    ctx.stroke();
    ctx.restore();
  }

  _priceTag(price, y, color) {
    const ctx  = this.ctx;
    const W    = this._w;
    const text = this._fmt(price);
    const fh   = 11;
    const pad  = 4;

    ctx.save();
    ctx.font         = `${fh}px 'Galmuri9', monospace`;
    const tw  = ctx.measureText(text).width;
    const bw  = tw + pad * 2;
    const bh  = fh + pad * 2;
    const bx  = W - bw - 2;
    const by  = y - bh / 2;

    ctx.fillStyle = color;
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle    = '#000';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(text, bx + pad, by + pad + 1);
    ctx.restore();
  }

  _fmt(p) {
    if (p >= 100_000_000) return (p / 100_000_000).toFixed(1) + '억';
    if (p >= 10_000)      return (p / 10_000).toFixed(1) + '만';
    if (p >= 1_000)       return (p / 1_000).toFixed(1) + '천';
    return p.toFixed(1);
  }
}
