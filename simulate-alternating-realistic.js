 (async () => {
    const Portfolio = require('./portfolio');
    const TradingBot = require('./tradingBot');

    // Simulación alternada realista: mantiene openPositions y evita balances negativos
    const simulatedState = {
        balance: 10000,
        btc_amount: 0,
        initial_balance: 10000,
        total_value: 10000,
        openPositions: [] // { id, side, amountBtc, entryPrice, entryUsd }
    };

    function computeTotalValue(price) {
        // total = cash + spot BTC value + unrealized from shorts (entryUsd - (amt*price))
        const spot = Number(simulatedState.btc_amount || 0) * Number(price);
        const shortUnrealized = simulatedState.openPositions.filter(p => p.side === 'short').reduce((s, p) => {
            const entryUsd = Number(p.entryUsd || 0);
            const buyBackCost = Number(p.amountBtc || 0) * Number(price);
            return s + (entryUsd - buyBackCost);
        }, 0);
        return Number(simulatedState.balance || 0) + Number(spot) + Number(shortUnrealized || 0);
    }

    async function runSimulation(numOps = 10, price = 50000) {
        const portfolio = new Portfolio();
        await portfolio.initialize();

        // Monkeypatch DB state to reflect simulatedState
        portfolio.db.getPortfolioState = async () => ({
            balance: simulatedState.balance,
            btc_amount: simulatedState.btc_amount,
            initial_balance: simulatedState.initial_balance,
            total_value: computeTotalValue(price)
        });

        // Override saveToDatabase so it updates simulated total_value but doesn't touch real DB
        portfolio.saveToDatabase = async () => {
            simulatedState.total_value = computeTotalValue(price);
            return true;
        };

        // Realistic executeTrade stub that mirror portfolio logic and tracks opens/closes
        portfolio.executeTrade = async (trade) => {
            const t = Object.assign({}, trade);
            const usd = Number(t.usdAmount || t.usd_amount || 0) || 0;
            const amt = Number(t.amount || 0) || 0;
            const fee = Number(t.fee || 0) || 0;
            const side = (t.positionSide || t.position_side || (t.type === 'SELL' && t.action === 'open' ? 'short' : 'long')) || null;

            console.log('\n[REAL-SIM] Ejecutando:', { side, action: t.action, requestedUsd: usd, amount: amt, price: t.price });

            // OPEN
            if (t.action === 'open') {
                // SIMPLE MODE: if forceSimple, do not debit balance on open; otherwise enforce funds
                const totalCost = usd + fee;
                if (!t.forceSimple) {
                    if (simulatedState.balance + 1e-9 < totalCost) {
                        console.log('[REAL-SIM] Balance insuficiente para apertura, abortando.');
                        return false;
                    }
                    // Debit balance by usd+fee
                    simulatedState.balance = Number(simulatedState.balance) - totalCost;
                    if (side === 'long') simulatedState.btc_amount = Number(simulatedState.btc_amount) + amt;
                } else {
                    // forceSimple: do not change cash on open, just record position
                    if (side === 'long') simulatedState.btc_amount = Number(simulatedState.btc_amount) + amt;
                }

                // Record position for both long and short to keep consistent accounting
                const posId = t.positionId || `${side}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
                simulatedState.openPositions.push({ id: posId, side, amountBtc: amt, entryPrice: t.price, entryUsd: usd });

                simulatedState.total_value = computeTotalValue(price);
                console.log('[REAL-SIM] OPEN executed. New state -> balance:', simulatedState.balance.toFixed(2), 'btc:', simulatedState.btc_amount.toFixed(8), 'total_value:', simulatedState.total_value.toFixed(2));
                return true;
            }

            // CLOSE
            if (t.action === 'close') {
                // Find a matching open position
                const idx = simulatedState.openPositions.findIndex(p => p.side === side);
                if (idx === -1) {
                    console.log('[REAL-SIM] No hay posición abierta para cerrar. Abortando.');
                    return false;
                }
                const pos = simulatedState.openPositions[idx];

                if (!t.forceSimple) {
                    if (side === 'long') {
                        // Sell spot BTC: increase cash by usd - fee, reduce btc_amount
                        simulatedState.btc_amount = Math.max(0, Number(simulatedState.btc_amount) - amt);
                        simulatedState.balance = Number(simulatedState.balance) + (usd - fee);
                    } else if (side === 'short') {
                        // Closing short: buy back BTC using available cash + entryUsd reserved
                        const entryUsd = Number(pos.entryUsd || 0);
                        const buyBackCost = Number(amt || pos.amountBtc || 0) * Number(t.price);
                        const availableForClose = Number(simulatedState.balance) + entryUsd;
                        const totalNeeded = buyBackCost + fee;
                        if (availableForClose + 1e-9 < totalNeeded) {
                            console.log('[REAL-SIM] Fondos insuficientes para cerrar SHORT. Abortando.');
                            return false;
                        }

                        // Apply: return entryUsd to balance, then subtract buyBackCost+fee
                        simulatedState.balance = Number(simulatedState.balance) + entryUsd - buyBackCost - fee;
                        // shorts do not affect btc_amount (we're not modeling spot increase here)
                    }
                } else {
                    // forceSimple: on close set balance to total_value (simple reinvest model)
                    simulatedState.total_value = computeTotalValue(price);
                    simulatedState.balance = Number(simulatedState.total_value || 0);
                    // adjust btc_amount for long close
                    if (side === 'long') simulatedState.btc_amount = Math.max(0, Number(simulatedState.btc_amount) - amt);
                }

                // Remove position
                simulatedState.openPositions.splice(idx, 1);
                simulatedState.total_value = computeTotalValue(price);
                console.log('[REAL-SIM] CLOSE executed. New state -> balance:', simulatedState.balance.toFixed(2), 'btc:', simulatedState.btc_amount.toFixed(8), 'total_value:', simulatedState.total_value.toFixed(2));
                return true;
            }

            console.log('[REAL-SIM] Acción no reconocida en stub:', t.action);
            return false;
        };

        const marketDataMock = {
            getCurrentPrice: async () => ({ price }),
            getMarketSignals: () => ({ signal: 'SIM', confidence: 80, indicators: {} })
        };

        const bot = new TradingBot(portfolio, marketDataMock);

        console.log('\n--- Iniciando simulación alternada realista de', numOps, 'operaciones ---');
        for (let i = 0; i < numOps; i++) {
            const side = (i % 2 === 0) ? 'short' : 'long'; // empieza con SHORT
            console.log(`\n[REAL-SIM] Operación ${i + 1}/${numOps} -> ${side.toUpperCase()}`);
            if (side === 'long') {
                await bot.openLong(price, 80, ['SIM_REALISTIC']);
            } else {
                await bot.openShort(price, 80, ['SIM_REALISTIC']);
            }
            await new Promise(r => setTimeout(r, 50));
        }

        console.log('\n--- Simulación realista finalizada ---');
        console.log('Estado final simulado:', simulatedState);

        try { await portfolio.close(); } catch (e) {}
    }

    await runSimulation(10, 50000);
    process.exit(0);
})();
