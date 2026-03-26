'use strict';

// ── 설정 ──────────────────────────────────────────────────
const CONFIG = {
  startBalance:    100_000_000,   // 1억원
  defaultLeverage: 1,
  variables: { volatility: 55, luck: 50, momentum: 50 },
  ticksPerSecond:  4,
  gameDurationSec: 90,
  storeUrlAndroid: 'https://play.google.com/store/apps/details?id=com.vulda.rightnow',
  storeUrlIos:     'https://apps.apple.com/app/id6760212769',
};

// ── DOM ───────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const dom = {
  canvas:     $('chart'),
  pnlPct:     $('pnl-pct'),
  pnlVal:     $('pnl-val'),
  sideVal:    $('side-val'),
  evaluation: $('evaluation'),
  entryVal:   $('entry-val'),
  quantity:   $('quantity'),
  tpVal:      $('tp-val'),
  slVal:      $('sl-val'),
  balance:    $('balance'),
  priceText:  $('price-text'),
  speedLabel: $('speed-label'),
  qtyLabel:   $('qty-label'),
  qtyAmount:  $('qty-amount'),
  qtyMax:     $('qty-max'),
  qtySlider:  $('qty-slider'),
  buyBtn:     $('buy-btn'),
  sellBtn:    $('sell-btn'),
  closeBtn:   $('close-btn'),
  endScreen:  $('end-screen'),
  endAmount:  $('end-amount'),
  endSub:     $('end-sub'),
  ctaBtn:     $('cta-btn'),
  replayBtn:  $('replay-btn'),
};

// ── 상태 ──────────────────────────────────────────────────
let game      = null;
let renderer  = null;
let rafId     = null;
let lastTs    = 0;
let accumMs   = 0;
let gameOver  = false;
let startTime = 0;
let lastPrice = 0;

const TICK_MS = 1000 / CONFIG.ticksPerSecond;

// ── 초기화 ────────────────────────────────────────────────
function init() {
  game = new ChartGame(
    CONFIG.startBalance,
    CONFIG.defaultLeverage,
    { ...CONFIG.variables }
  );

  game.onOrderClosed = (reason, pnl) => {
    updateHUD();
  };

  game.onLiquidation = () => {
    updateHUD();
    setTimeout(() => showEndScreen(), 600);
  };

  renderer  = new ChartRenderer(dom.canvas);
  gameOver  = false;
  lastTs    = performance.now();
  accumMs   = 0;
  startTime = performance.now();
  lastPrice = game.getLastPrice();

  dom.endScreen.classList.remove('visible');
  dom.qtySlider.value = 1;

  updateHUD();
  renderFrame();
  startLoop();
}

// ── 게임 루프 ─────────────────────────────────────────────
function startLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}

function loop(now) {
  if (gameOver) return;

  const dt = now - lastTs;
  lastTs   = now;

  // 최대 dt 캡 (백그라운드 복귀 시 튀는 것 방지)
  const cappedDt = Math.min(dt, 500);

  accumMs += cappedDt;
  while (accumMs >= TICK_MS) {
    game.advance();
    accumMs -= TICK_MS;
  }

  renderFrame();
  updateHUD();

  // 시간 종료 체크 (포지션 없을 때만)
  const elapsed = (now - startTime) / 1000;
  if (elapsed >= CONFIG.gameDurationSec && !game.order && !gameOver) {
    endGame();
    return;
  }

  rafId = requestAnimationFrame(loop);
}

function renderFrame() {
  const candles = game.getVisibleCandles();
  renderer.draw(
    candles,
    game.order ? game.order.entryPrice : null,
    game.order ? game.order.side : null,
    game.getLastPrice()
  );
}

// ── HUD 업데이트 ──────────────────────────────────────────
function updateHUD() {
  const balance = game.balance;
  const order   = game.order;
  const price   = game.getLastPrice();
  const equity  = game.getTotalEquity();

  // 현재가 표시 (원본: "1215.6천 (▼ 0.2천)" 형식)
  const delta     = price - lastPrice;
  const arrow     = delta >= 0 ? '▲' : '▼';
  dom.priceText.textContent =
    `${fmtFull(price)} (${arrow} ${fmtFull(Math.abs(delta))})`;
  lastPrice = price;

  // 잔액 (포지션 없을 때)
  dom.balance.textContent = fmtWon(equity);

  if (order) {
    const pnl     = game.getUnrealizedPnl();
    const pct     = game.getPnlPercent();
    const sign    = pnl >= 0 ? '+' : '';
    const isProfit = pnl >= 0;

    dom.pnlPct.textContent     = `${sign}${pct.toFixed(1)} %`;
    dom.pnlPct.className       = isProfit ? 'green-text' : 'red-text';
    dom.pnlVal.textContent     = `${sign}${fmtWon(pnl)}`;
    dom.pnlVal.className       = isProfit ? 'green-text' : 'red-text';

    dom.sideVal.textContent    = order.side === 'buy' ? '롱 (매수)' : '숏 (매도)';
    dom.evaluation.textContent = fmtWon(price * order.quantity);
    dom.entryVal.textContent   = fmtVtc(order.entryPrice);
    dom.quantity.textContent   = fmtQty(order.quantity);
    dom.tpVal.textContent      = '-';
    dom.slVal.textContent      = '-';
  } else {
    dom.pnlPct.textContent     = '0.0 %';
    dom.pnlPct.className       = 'green-text';
    dom.pnlVal.textContent     = '0원';
    dom.pnlVal.className       = '';
    dom.sideVal.textContent    = '-';
    dom.evaluation.textContent = '0원';
    dom.entryVal.textContent   = '-';
    dom.quantity.textContent   = '-';
    dom.tpVal.textContent      = '-';
    dom.slVal.textContent      = '-';
  }

  // 주문 수량 레이블
  const sliderVal  = parseFloat(dom.qtySlider.value);
  const usable     = game.balance;
  const notional   = usable * sliderVal * game.leverage;
  dom.qtyAmount.textContent = fmtWon(notional);
  dom.qtyMax.textContent    = fmtWon(usable * game.leverage);

  // 잔액 0 → 종료
  if (equity <= 0 && !game.order) endGame();
}

// ── 버튼 이벤트 ───────────────────────────────────────────
function setupButtons() {
  dom.buyBtn.addEventListener('click', () => {
    if (gameOver) return;
    game.submitOrder('buy', parseFloat(dom.qtySlider.value));
    updateHUD();
  });

  dom.sellBtn.addEventListener('click', () => {
    if (gameOver) return;
    game.submitOrder('sell', parseFloat(dom.qtySlider.value));
    updateHUD();
  });

  dom.closeBtn.addEventListener('click', () => {
    endGame();
  });

  dom.qtySlider.addEventListener('input', updateHUD);

  dom.ctaBtn.addEventListener('click', () => {
    if (typeof ExitApi !== 'undefined') {
      ExitApi.exit();
    } else {
      const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
      window.open(isIos ? CONFIG.storeUrlIos : CONFIG.storeUrlAndroid, '_blank');
    }
  });

  dom.replayBtn.addEventListener('click', () => {
    dom.endScreen.classList.remove('visible');
    setTimeout(init, 50);
  });
}

// ── 게임 종료 ─────────────────────────────────────────────
function endGame() {
  if (gameOver) return;
  gameOver = true;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  renderFrame();
  setTimeout(showEndScreen, 200);
}

function showEndScreen() {
  const equity  = game.getTotalEquity();
  const delta   = equity - CONFIG.startBalance;
  const pct     = CONFIG.startBalance > 0 ? (delta / CONFIG.startBalance) * 100 : 0;
  const isProfit = delta >= 0;
  const sign    = delta >= 0 ? '+' : '';

  dom.endAmount.textContent = `${sign}${fmtWon(delta)}`;
  dom.endAmount.className   = isProfit ? 'green-text' : 'red-text';
  dom.endSub.textContent    =
    `수익률 ${sign}${pct.toFixed(1)}%\n최종 자산 ${fmtWon(equity)}`;

  dom.endScreen.classList.add('visible');
}

// ── 포맷 함수 (KoreanNumberFormatter 포팅) ────────────────

function _noTrailingZero(n) {
  const s = n.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** 잔액/PnL용: 억/만/원 단위 */
function fmtWon(v) {
  const sign = v < 0 ? '-' : '';
  const a    = Math.abs(v);
  if (a >= 1_0000_0000) return sign + _noTrailingZero(a / 1_0000_0000) + '억원';
  if (a >= 1_0000)      return sign + _noTrailingZero(a / 1_0000) + '만원';
  return sign + Math.round(a).toLocaleString('ko-KR') + '원';
}

/** 현재가 표시용: 1의 자리까지 전체 숫자 */
function fmtFull(p) {
  return Math.round(Math.abs(p)).toLocaleString('ko-KR') + '원';
}

/** VTC 가격용: 천/만/억 단위 */
function fmtVtc(p) {
  const a = Math.abs(p);
  if (a >= 1_0000_0000) return _noTrailingZero(a / 1_0000_0000) + '억';
  if (a >= 1_0000)      return _noTrailingZero(a / 1_0000) + '만';
  if (a >= 1_000)       return _noTrailingZero(a / 1_000) + '천';
  return a.toFixed(1) + '원';
}

/** 수량 포맷 */
function fmtQty(q) {
  if (q >= 1_0000) return (q / 1_0000).toFixed(2) + '만';
  if (q >= 1_000)  return (q / 1_000).toFixed(2) + '천';
  return q.toFixed(4);
}

// ── 시작 ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupButtons();
  init();
});
