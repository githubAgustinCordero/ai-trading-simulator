const Portfolio = require('./portfolio');

(async () => {
  const p = new Portfolio(10000);
  await p.initialize();

  const trade = {
    type: 'BUY',
    amount: 0.01,
    price: 100000,
    usdAmount: 1000,
    fee: 1,
    confidence: 80,
    reasons: ['test-exec-long-open'],
    stopLoss: null,
    takeProfit: null,
    positionSide: 'long',
    action: 'open'
  };

  console.log('Before executeLongOpen - openPositions:', p.openPositions.length);
  const ok = await p.executeLongOpen(trade);
  console.log('executeLongOpen returned:', ok);
  console.log('After executeLongOpen - openPositions:', p.openPositions.map(p => ({ id: p.id, side: p.side, entryPrice: p.entryPrice })));

  const trades = await p.getTradeHistory(5);
  console.log('Last trades:', trades.slice(0,3).map(t => ({ id: t.id, position_side: t.position_side, position_id: t.position_id, action: t.action })));

  process.exit(0);
})();