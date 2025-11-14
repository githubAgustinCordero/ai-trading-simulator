(async () => {
    const Portfolio = require('./portfolio');
    const TradingBot = require('./tradingBot');

    // Small helper to run a sizing simulation
    async function simulate(balanceToUse, side = 'long') {
        const portfolio = new Portfolio();
        await portfolio.initialize();

        // Monkeypatch db.getPortfolioState to return desired balance
        portfolio.db.getPortfolioState = async () => ({ balance: balanceToUse, btc_amount: 0, initial_balance: 10000 });

        // Stub executeTrade to capture the trade object without persisting
        let capturedTrade = null;
        portfolio.executeTrade = async (trade) => {
            capturedTrade = trade;
            console.log('[SIM] executeTrade stub called. trade.usdAmount=', trade.usdAmount);
            return true;
        };

        const marketDataMock = {
            getCurrentPrice: async () => ({ price: 50000 }),
            getMarketSignals: () => ({ signal: 'BUY', confidence: 80, indicators: {} })
        };

        const bot = new TradingBot(portfolio, marketDataMock);

        // Call relevant open
        if (side === 'long') {
            await bot.openLong(50000, 80, ['Sim test']);
        } else {
            await bot.openShort(50000, 80, ['Sim test']);
        }

        // Expected
        const expected = Number(balanceToUse) * 0.5;

        console.log('Balance provided:', balanceToUse);
        console.log('Expected 50%:', expected.toFixed(8));
        if (capturedTrade) {
            console.log('Captured trade.usdAmount:', Number(capturedTrade.usdAmount).toFixed(8));
            const pass = Math.abs(Number(capturedTrade.usdAmount) - expected) < 0.0005;
            console.log('PASS:', pass);
        } else {
            console.log('No trade captured (maybe blocked by duplicate check)');
        }

        // Close DB connection
        try { await portfolio.close(); } catch(e){}
    }

    console.log('\n--- Running sizing simulation tests ---\n');
    await simulate(1000, 'long');
    console.log('\n--- Next test ---\n');
    await simulate(1766.463023710962, 'long');

    console.log('\n--- All tests finished ---\n');
    process.exit(0);
})();
