#!/usr/bin/env node
(async () => {
    const path = require('path');
    const Portfolio = require(path.join(__dirname, '..', 'portfolio'));
    const TradingBot = require(path.join(__dirname, '..', 'tradingBot'));

    // Minimal marketData mock
    class MockMarket {
        constructor(price) { this.price = price; }
        async getCurrentPrice() { return { price: this.price }; }
        getMarketSignals() { return { signal: 'HOLD', confidence: 0, indicators: {} }; }
        setPrice(p) { this.price = p; }
    }

    const p = new Portfolio();
    await p.initialize();
    // reset trades for a clean run
    // Note: using same DB; for isolated tests set TEST_DB_PATH env var if needed

    const market = new MockMarket(10000);
    const bot = new TradingBot(p, market);

    console.log('\n--- Bot start scenario: start with balance=', p.balance, 'initialBalance=', p.initialBalance, 'btc=', p.btcAmount);

    // Open SHORT with bot: it will compute sizing based on totalValue (50%)
    console.log('\n--- Bot: openShort at price 10000');
    await bot.openShort(10000, 60, ['Test open short']);
    console.log('After openShort: balance=', p.balance.toFixed(2), 'btc=', p.btcAmount.toFixed(8));

    // Market flips bullish and price moves up (simulate loss on short)
    market.setPrice(10200);
    console.log('\n--- Market flips bullish, price=10200. Bot will attempt openLong (should close short first)');
    await bot.openLong(10200, 60, ['Test open long after close short']);

    console.log('\nFinal portfolio state:');
    console.log(' balance=', p.balance.toFixed(2));
    console.log(' btcAmount=', p.btcAmount.toFixed(8));
    console.log(' openPositions=', p.openPositions);

    // List last 5 trades
    console.log('\nLast trades:');
    const trades = p.trades.slice(0, 10);
    for (const t of trades) console.log(t.action || t.type, t.position_side || t.positionSide, 'usd:', (t.usdAmount || t.usd_amount || 0), 'price:', t.price || t.entry_price || t.exit_price);

    process.exit(0);
})();
