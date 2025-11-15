 (async () => {
    const Portfolio = require('./portfolio');
    const TradingBot = require('./tradingBot');

    // Simulación alternada: SHORT, LONG, SHORT, LONG... 10 operaciones
    const simulatedState = {
        balance: 10000,
        btc_amount: 0,
        initial_balance: 10000,
        total_value: 10000
    };

    async function runSimulation(numOps = 10, price = 50000) {
        const portfolio = new Portfolio();
        await portfolio.initialize();

        // Monkeypatch DB state to use our simulated state dynamically
        portfolio.db.getPortfolioState = async () => ({
            balance: simulatedState.balance,
            btc_amount: simulatedState.btc_amount,
            initial_balance: simulatedState.initial_balance,
            total_value: simulatedState.total_value
        });

        // Stub saveToDatabase to avoid touching real DB; update total_value for logging
        portfolio.saveToDatabase = async () => {
            try {
                simulatedState.total_value = Number(simulatedState.balance) + Number(simulatedState.btc_amount) * Number(price);
            } catch (e) {}
            return true;
        };

        // Capture and apply the logical effect of each trade to simulatedState
        portfolio.executeTrade = async (trade) => {
            // Minimal stub that updates simulated balance and btc amount depending on trade
            const t = Object.assign({}, trade);
            const usd = Number(t.usdAmount || t.usd_amount || 0) || 0;
            const amt = Number(t.amount || 0) || 0;
            const fee = Number(t.fee || 0) || 0;

            console.log('\n[SIM] Intentando ejecutar:', { side: t.positionSide || t.position_side, action: t.action, usdAmount: usd, amount: amt, price: t.price });

            if (t.action === 'open') {
                // Opening consumes cash
                const totalCost = usd + fee;
                if (simulatedState.balance + 0.000001 < totalCost) {
                    console.log('[SIM] Balance insuficiente para abrir. Abortando.');
                    return false;
                }
                simulatedState.balance = Number(simulatedState.balance) - totalCost;
                if ((t.positionSide || t.position_side) === 'long') {
                    simulatedState.btc_amount = Number(simulatedState.btc_amount) + amt;
                }
                // shorts do not change btc_amount (shorts recorded as openPositions in real code)
            } else if (t.action === 'close') {
                // Closing returns cash (for long: sell BTC; for short: buy back)
                if ((t.positionSide || t.position_side) === 'long') {
                    // Sell BTC: add usd (minus fee)
                    simulatedState.btc_amount = Math.max(0, Number(simulatedState.btc_amount) - amt);
                    simulatedState.balance = Number(simulatedState.balance) + (usd - fee);
                } else if ((t.positionSide || t.position_side) === 'short') {
                    // Close short: consume cash to buy back => reduce balance
                    simulatedState.balance = Number(simulatedState.balance) - (usd + fee);
                }
            }

            // Recompute total_value (simple snapshot)
            simulatedState.total_value = Number(simulatedState.balance) + Number(simulatedState.btc_amount) * Number(price);

            // Print resulting simulated state
            console.log('[SIM] Resultado simulado -> balance:', simulatedState.balance.toFixed(2), 'btc:', simulatedState.btc_amount.toFixed(8), 'total_value:', simulatedState.total_value.toFixed(2));

            // Return true to indicate success (no DB writes performed)
            return true;
        };

        const marketDataMock = {
            getCurrentPrice: async () => ({ price }),
            getMarketSignals: () => ({ signal: 'SIM', confidence: 80, indicators: {} })
        };

        const bot = new TradingBot(portfolio, marketDataMock);

        console.log('\n--- Iniciando simulación alternada de', numOps, 'operaciones ---');
        for (let i = 0; i < numOps; i++) {
            const side = (i % 2 === 0) ? 'short' : 'long'; // empieza con corto (short)
            console.log(`\n[SIM] Operación ${i + 1}/${numOps} -> ${side.toUpperCase()}`);
            if (side === 'long') {
                await bot.openLong(price, 80, ['SIM_ALTERNATING']);
            } else {
                await bot.openShort(price, 80, ['SIM_ALTERNATING']);
            }
            // small pause to mimic async timing
            await new Promise(r => setTimeout(r, 50));
        }

        console.log('\n--- Simulación finalizada ---');
        console.log('Estado final simulado:', simulatedState);

        try { await portfolio.close(); } catch(e){}
    }

    await runSimulation(10, 50000);
    process.exit(0);
})();
