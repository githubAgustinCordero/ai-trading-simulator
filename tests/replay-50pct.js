(async () => {
  // Use an isolated DB for the test
  process.env.TEST_DB_PATH = `/tmp/trading_sim_test_${Date.now()}.db`;

  const Portfolio = require('../portfolio');

  const priceOpen = 10000; // price for open short
  const shortUsd = 5000;
  const closePrice = 10200; // close higher to get profit (you can change to simulate loss)

  const p = new Portfolio(10000);
  await p.initialize();

  console.log('\n--- Initial state ---');
  console.log('balance=', p.balance, 'btcAmount=', p.btcAmount);

  // Open SHORT of $5000
  const shortBtc = shortUsd / priceOpen;
  const openShortTrade = {
    type: 'SELL',
    amount: shortBtc,
    price: priceOpen,
    usdAmount: shortUsd,
    fee: 0,
    timestamp: new Date(),
    confidence: 100,
    reasons: ['Replay test: open short 50% desired'],
    positionSide: 'short',
    action: 'open'
  };

  console.log('\n--- Executing open short ---');
  const okOpen = await p.executeTrade(openShortTrade);
  console.log('openShort ok=', okOpen);
  console.log('after open: balance=', p.balance.toFixed(2), 'btcAmount=', p.btcAmount.toFixed(8));

  // Now close the SHORT at closePrice
  const closeUsd = shortBtc * closePrice;
  const closeShortTrade = {
    type: 'BUY',
    amount: shortBtc,
    price: closePrice,
    usdAmount: closeUsd,
    fee: 0,
    timestamp: new Date(),
    confidence: 100,
    reasons: ['Replay test: close short'],
    positionSide: 'short',
    action: 'close'
  };

  console.log('\n--- Executing close short ---');
  const okClose = await p.executeTrade(closeShortTrade);
  console.log('closeShort ok=', okClose);
  console.log('after close: balance=', p.balance.toFixed(2), 'btcAmount=', p.btcAmount.toFixed(8));

  // According to your rule: sum result to remaining cash (balance already reflects it)
  const newCash = Number(p.balance || 0);
  const openNextUsd = Math.floor((newCash * 0.5) * 100) / 100; // 50% of new cash, rounded to cents
  console.log('\n--- After close, newCash=', newCash.toFixed(2), ', will use 50%=', openNextUsd.toFixed(2));

  // Open LONG with 50% of new cash
  const longPrice = closePrice; // assume same market price for opening
  const longBtc = openNextUsd / longPrice;
  const openLongTrade = {
    type: 'BUY',
    amount: longBtc,
    price: longPrice,
    usdAmount: openNextUsd,
    fee: 0,
    timestamp: new Date(),
    confidence: 100,
    reasons: ['Replay test: open long after short close (50% of new cash)'],
    positionSide: 'long',
    action: 'open'
  };

  console.log('\n--- Executing open long ---');
  const okOpenLong = await p.executeTrade(openLongTrade);
  console.log('openLong ok=', okOpenLong);
  console.log('final state: balance=', p.balance.toFixed(2), 'btcAmount=', p.btcAmount.toFixed(8));

  // Print trades for audit
  const trades = await p.getTradeHistory(20);
  console.log('\n--- Last trades ---');
  trades.slice(0,10).forEach(t => {
    console.log(t.type, t.position_side || t.positionSide, t.action, 'usd:', t.usdAmount || t.usd_amount, 'price:', t.price);
  });

  process.exit(0);
})();
