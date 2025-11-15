const DatabaseManager = require('./database');

(async () => {
  const db = new DatabaseManager();
  await db.initialize();

  const fakeTrade = {
    id: `test_trade_${Date.now()}`,
    type: 'BUY',
    amount: 0.01,
    price: 100000,
    usdAmount: 1000,
    fee: 0,
    confidence: 50,
    reasons: ['unit-test'],
    action: 'open',
    position_side: 'long'
    // Intentionally no position_id / positionId
  };

  console.log('Saving fake trade (no position_id)...');
  await db.saveTrade(fakeTrade);
  console.log('Saved. Loading last trade(s)...');
  const trades = await db.getTrades(5);
  const found = trades.find(t => t.id === fakeTrade.id);
  if (!found) {
    console.error('Test trade not found');
    process.exit(2);
  }
  console.log('Found saved trade:', {
    id: found.id,
    position_side: found.position_side,
    position_id: found.position_id,
    action: found.action
  });
  process.exit(0);
})();
