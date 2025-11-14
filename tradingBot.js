class TradingBot {
    constructor(portfolio, marketData) {
        this.portfolio = portfolio;
        this.marketData = marketData;
        this.isActive = false;
        // Only MAXI1 is supported
        this.strategy = 'maxi1';
        this.lastTradeTime = 0;
        this.settings = {
            cooldownPeriod: 300000, // not used by MAXI1 but left for compatibility
            minConfidence: 40
        };
        this.currentPosition = null; // { side, amountBtc, entryPrice }
        this.isStopping = false;
    }

    async start() {
        this.isActive = true;
        this.isStopping = false;
        console.log('🤖 AI Trading Bot iniciado (MAXI1)');

        // Sync and ensure at least one position exists
        try {
            await this.syncCurrentPosition();
            if (!this.currentPosition) {
                await this.openInitialPosition();
            }
        } catch (err) {
            console.error('Error during start sync:', err && err.message ? err.message : err);
        }

        this.tradingInterval = setInterval(async () => {
            if (this.isActive && !this.isStopping) {
                try {
                    await this.executeStrategy();
                } catch (e) {
                    console.error('Error in trading loop:', e && e.message ? e.message : e);
                }
            }
        }, 30000);

        return true;
    }

    stop() {
        this.isActive = false;
        this.isStopping = true;
        if (this.tradingInterval) {
            clearInterval(this.tradingInterval);
            this.tradingInterval = null;
        }
        console.log('🛑 AI Trading Bot detenido');
        return true;
    }

    setStrategy(strategy) {
        if (strategy === 'maxi1') {
            this.strategy = 'maxi1';
            console.log('🎯 Estrategia fijada a: maxi1');
            return true;
        }
        console.warn('Intento de cambiar a una estrategia no soportada:', strategy);
        return false;
    }

    getStrategy() {
        return this.strategy;
    }

    async executeStrategy() {
        if (!this.isActive || this.isStopping) return;

        const marketData = await this.marketData.getCurrentPrice();
        if (!marketData) return;

        let signals = null;
        try {
            signals = this.marketData.getMarketSignals();
        } catch (err) {
            console.error('Error obtaining market signals:', err && err.message ? err.message : err);
            signals = null;
        }

        if (!signals || typeof signals !== 'object') {
            console.warn('⚠️ Market signals undefined or invalid — using HOLD fallback');
            signals = { signal: 'HOLD', confidence: 0, indicators: {} };
        }

        // Delegate decision making to the MAXI1 strategy module (protected)
        try {
            const maxi1 = require('./strategies/maxi1');
            if (!maxi1 || typeof maxi1.processSignals !== 'function') {
                console.error('MAXI1 strategy module missing or invalid');
            } else {
                try {
                    await maxi1.processSignals(this, signals, marketData);
                } catch (strategyErr) {
                    console.error('Error running MAXI1 strategy (caught):', strategyErr && strategyErr.message ? strategyErr.message : strategyErr);
                }
            }
        } catch (e) {
            console.error('Error loading MAXI1 strategy module:', e && e.message ? e.message : e);
        }

        // Post-check for SL/TP or consistency (MAXI1 doesn't use SL/TP but keep hook)
        await this.checkPositions(marketData.price);
    }

    // openInitialPosition: use stoch heuristic (delegated) or call portfolio rebuild
    async openInitialPosition() {
        try {
            const market = await this.marketData.getCurrentPrice();
            const signals = this.marketData.getMarketSignals() || {};
            if (!market) return;

            // Prefer explicit signals from market data
            const { safeNum } = require('./lib/utils');
            const signal = signals.signal || 'HOLD';
            const confidence = safeNum(signals.confidence, 80);

            if (signal === 'BUY') {
                await this.openLong(market.price, confidence, ['Posición inicial: BUY signal'], signals);
                return;
            }
            if (signal === 'SELL') {
                await this.openShort(market.price, confidence, ['Posición inicial: SELL signal'], signals);
                return;
            }

            // Heuristic: use stoch 15m k < 50 -> LONG else SHORT
            const st15 = signals.indicators?.stoch?.['15m'] || {};
            if (typeof st15.k === 'number' && st15.k < 50) {
                await this.openLong(market.price, confidence, ['Posición inicial: heurística estocástico K<50'], signals);
            } else {
                await this.openShort(market.price, confidence, ['Posición inicial: heurística estocástico K>=50'], signals);
            }
        } catch (e) {
            console.error('Error opening initial position:', e && e.message ? e.message : e);
        }
    }

    // OPEN / CLOSE helpers delegating to portfolio
    async openLong(price, confidence, reasons = [], signals = {}) {
        // If there's an opposite position (short), try to close it first to ensure a single position at a time
        let closedOpposite = false;
        try {
            if (this.currentPosition && this.currentPosition.side === 'short') {
                console.log('⚠️ Existe SHORT abierto — intentando cerrar antes de abrir LONG');
                const closed = await this.closeShort(price, confidence, ['Auto cierre SHORT antes de apertura LONG']);
                if (!closed) {
                    console.log('❌ No se pudo cerrar SHORT — abortando apertura LONG');
                    return false;
                }
                closedOpposite = true;
                // Sync position after close
                await this.syncCurrentPosition();
            }
        } catch (e) {
            console.error('Error intentando cerrar SHORT antes de abrir LONG:', e && e.message ? e.message : e);
            return false;
        }

    // Nuevo comportamiento: calcular objetivo como 50% del VALOR TOTAL del portafolio
    // y abrir hasta la cantidad necesaria para alcanzar esa exposición, usando efectivo disponible.
    let balanceForSizing = Number(this.portfolio.balance || 0);
    let totalValue = null;
    try {
        if (this.portfolio && this.portfolio.db && typeof this.portfolio.db.getPortfolioState === 'function') {
            const dbState = await this.portfolio.db.getPortfolioState();
            if (dbState) {
                if (typeof dbState.balance === 'number') balanceForSizing = Number(dbState.balance);
                if (typeof dbState.total_value === 'number') totalValue = Number(dbState.total_value);
                console.log(`🛰️ Usando estado DB para sizing: balance=$${balanceForSizing.toFixed(2)}, totalValue=${totalValue !== null ? '$'+totalValue.toFixed(2) : 'N/A'}`);
            }
        }
    } catch (err) {
        console.warn('⚠️ No se pudo leer estado desde DB para sizing, usando valores en memoria:', err && err.message ? err.message : err);
    }

    // Fallback: si no hay totalValue en DB, calcular desde el objeto portfolio (requiere precio)
    if (totalValue === null) {
        try {
            totalValue = Number(this.portfolio.getTotalValue(price)) || Number(this.portfolio.initialBalance || 0);
        } catch (err) {
            totalValue = Number(this.portfolio.initialBalance || 0);
        }
    }

    // Calcular exposición ya invertida en longs
    const openPositions = Array.isArray(this.portfolio.openPositions) ? this.portfolio.openPositions : [];
    const investedLongUsd = openPositions
        .filter(p => p.side === 'long')
        .reduce((s, p) => s + (Number(p.entryUsd || (p.amountBtc * (p.entryPrice || price))) || 0), 0);

    const targetExposure = totalValue * 0.5; // objetivo: 50% del valor total
    let additionalNeeded = Math.max(0, targetExposure - investedLongUsd);

    // If we just closed the opposite position, use the updated cash balance and open with 50% of that cash
    let tradeAmount = Math.min(additionalNeeded, balanceForSizing);
            if (closedOpposite) {
                try {
                    // Prefer reading the updated total_value from DB after the close
                    const dbStateAfter = (this.portfolio && this.portfolio.db && typeof this.portfolio.db.getPortfolioState === 'function') ? await this.portfolio.db.getPortfolioState() : null;
                    // Debug: mostrar estado crudo leído desde la BDD justo después del cierre
                    try { console.log('🛰️ DB raw state after close:', dbStateAfter); } catch (e) {}

                    // Ensure in-memory portfolio reloads trades/state from DB so exposures are accurate
                    try {
                        if (typeof this.portfolio.loadFromDatabase === 'function') {
                            await this.portfolio.loadFromDatabase();
                        }
                    } catch (e) {
                        console.warn('⚠️ No se pudo recargar portfolio desde DB:', e && e.message ? e.message : e);
                    }

                    let totalValueAfterClose = null;
                    if (dbStateAfter && typeof dbStateAfter.total_value === 'number') {
                        totalValueAfterClose = Number(dbStateAfter.total_value);
                    } else if (dbStateAfter && typeof dbStateAfter.totalValue === 'number') {
                        totalValueAfterClose = Number(dbStateAfter.totalValue);
                    } else {
                        // Fallback: compute from in-memory portfolio
                        try {
                            totalValueAfterClose = Number(this.portfolio.getTotalValue(price)) || Number(this.portfolio.balance || 0);
                        } catch (err) {
                            totalValueAfterClose = Number(this.portfolio.balance || 0);
                        }
                    }

                    // Recompute exposures from freshly loaded in-memory positions
                    const investedLongAfter = Array.isArray(this.portfolio.openPositions) ? this.portfolio.openPositions.filter(p => p.side === 'long').reduce((s, p) => s + (Number(p.entryUsd || (p.amountBtc * (p.entryPrice || price))) || 0), 0) : 0;
                    const targetExposureAfter = totalValueAfterClose * 0.5;
                    const additionalNeededAfter = Math.max(0, targetExposureAfter - investedLongAfter);

                    // Desired trade amount is the additional needed to reach 50% of updated total
                    tradeAmount = additionalNeededAfter;

                    // If cash is insufficient, clamp to available balance but log the condition
                    const availableCash = dbStateAfter && typeof dbStateAfter.balance === 'number' ? Number(dbStateAfter.balance) : Number(this.portfolio.balance || 0);
                    if (tradeAmount > availableCash) {
                        console.log(`⚠️ Cash insufficient to reach targetExposure: desired=$${tradeAmount.toFixed(2)}, available=$${availableCash.toFixed(2)} — will clamp to available`);
                        tradeAmount = Math.floor(availableCash * 100) / 100;
                    }

                    console.log(`🔁 Closed opposite position — recalculando sizing desde totalValue: totalValueAfterClose=$${totalValueAfterClose.toFixed(2)}, targetExposure=$${targetExposureAfter.toFixed(2)}, investedLongAfter=$${investedLongAfter.toFixed(2)}, tradeAmount=$${tradeAmount.toFixed(2)}`);
                } catch (e) {
                    console.warn('⚠️ Error leyendo estado después de cerrar posición, usando sizing previo:', e && e.message ? e.message : e);
                }
            }

    if (tradeAmount < 10) {
        console.log('ℹ️ No se abre LONG: monto calculado demasiado pequeño o objetivo ya alcanzado', { tradeAmount, additionalNeeded, investedLongUsd, targetExposure });
        return false;
    }
    console.log(`📐 Tamaño de orden calculado (LONG): totalValue=$${totalValue.toFixed(2)}, investedLongUsd=$${investedLongUsd.toFixed(2)}, targetExposure=$${targetExposure.toFixed(2)}, tradeAmount=$${tradeAmount.toFixed(2)} (usando cash=$${balanceForSizing.toFixed(2)})`);
    const btcAmount = tradeAmount / price;
        // Fee removed for simulation/testing per request
        const fee = 0;

        const trade = {
            type: 'BUY',
            amount: btcAmount,
            price: price,
            usdAmount: tradeAmount,
            fee: fee,
            timestamp: new Date(),
            confidence: confidence,
            reasons: reasons,
            stopLoss: null,
            takeProfit: null,
            positionSide: 'long',
            action: 'open'
        };

        const ok = await this.portfolio.executeTrade(trade);
        if (ok) {
            this.lastTradeTime = Date.now();
            this.currentPosition = { side: 'long', amountBtc: btcAmount, entryPrice: price };
            console.log(`✅ LONG ABIERTO: ${btcAmount.toFixed(8)} BTC a $${price.toFixed(2)}`);
        }
        return ok;
    }

    async closeLong(price, confidence, reasons = []) {
        if (!this.currentPosition || this.currentPosition.side !== 'long') return false;
        // Prepare trade to sell equal to the current position amount (portfolio handles matching)
        const btcAmount = this.currentPosition.amountBtc;
        const usdAmount = btcAmount * price;
    // Fee removed for simulation/testing per request
    const fee = 0;

        const trade = {
            type: 'SELL',
            amount: btcAmount,
            price: price,
            usdAmount: usdAmount,
            fee: fee,
            timestamp: new Date(),
            confidence: confidence,
            reasons: reasons,
            positionSide: 'long',
            action: 'close'
        };

        const ok = await this.portfolio.executeTrade(trade);
        if (ok) {
            this.lastTradeTime = Date.now();
            this.currentPosition = null;
            console.log(`✅ LONG CERRADO: ${btcAmount.toFixed(8)} BTC a $${price.toFixed(2)}`);
        }
        return ok;
    }

    async openShort(price, confidence, reasons = [], signals = {}) {
        // If there's an opposite position (long), try to close it first to ensure a single position at a time
        let closedOppositeShort = false;
        try {
            if (this.currentPosition && this.currentPosition.side === 'long') {
                console.log('⚠️ Existe LONG abierto — intentando cerrar antes de abrir SHORT');
                const closed = await this.closeLong(price, confidence, ['Auto cierre LONG antes de apertura SHORT']);
                if (!closed) {
                    console.log('❌ No se pudo cerrar LONG — abortando apertura SHORT');
                    return false;
                }
                closedOppositeShort = true;
                // Sync position after close
                await this.syncCurrentPosition();
            }
        } catch (e) {
            console.error('Error intentando cerrar LONG antes de abrir SHORT:', e && e.message ? e.message : e);
            return false;
        }

    // Nuevo comportamiento: calcular objetivo como 50% del VALOR TOTAL del portafolio (SHORT)
    let balanceForSizingShort = Number(this.portfolio.balance || 0);
    let totalValueShort = null;
    try {
        if (this.portfolio && this.portfolio.db && typeof this.portfolio.db.getPortfolioState === 'function') {
            const dbState = await this.portfolio.db.getPortfolioState();
            if (dbState) {
                if (typeof dbState.balance === 'number') balanceForSizingShort = Number(dbState.balance);
                if (typeof dbState.total_value === 'number') totalValueShort = Number(dbState.total_value);
                console.log(`🛰️ Usando estado DB para sizing (SHORT): balance=$${balanceForSizingShort.toFixed(2)}, totalValue=${totalValueShort !== null ? '$'+totalValueShort.toFixed(2) : 'N/A'}`);
            }
        }
    } catch (err) {
        console.warn('⚠️ No se pudo leer estado desde DB para sizing (SHORT), usando valores en memoria:', err && err.message ? err.message : err);
    }

    if (totalValueShort === null) {
        try {
            totalValueShort = Number(this.portfolio.getTotalValue(price)) || Number(this.portfolio.initialBalance || 0);
        } catch (err) {
            totalValueShort = Number(this.portfolio.initialBalance || 0);
        }
    }

    const openPositionsShort = Array.isArray(this.portfolio.openPositions) ? this.portfolio.openPositions : [];
    const investedShortUsd = openPositionsShort
        .filter(p => p.side === 'short')
        .reduce((s, p) => s + (Number(p.entryUsd || (p.amountBtc * (p.entryPrice || price))) || 0), 0);

    const targetExposureShort = totalValueShort * 0.5;
    let additionalNeededShort = Math.max(0, targetExposureShort - investedShortUsd);

    let tradeAmount = Math.min(additionalNeededShort, balanceForSizingShort);
    if (closedOppositeShort) {
        try {
            const dbStateAfter = (this.portfolio && this.portfolio.db && typeof this.portfolio.db.getPortfolioState === 'function') ? await this.portfolio.db.getPortfolioState() : null;
            // Debug: mostrar estado crudo leído desde la BDD justo después del cierre (SHORT)
            try { console.log('🛰️ DB raw state after close (SHORT):', dbStateAfter); } catch (e) {}
            // Ensure in-memory portfolio reloads trades/state from DB so exposures are accurate
            try {
                if (typeof this.portfolio.loadFromDatabase === 'function') {
                    await this.portfolio.loadFromDatabase();
                }
            } catch (e) {
                console.warn('⚠️ No se pudo recargar portfolio desde DB (SHORT):', e && e.message ? e.message : e);
            }

            // Compute using updated totalValue and exposures
            let totalValueAfterCloseShort = null;
            if (dbStateAfter && typeof dbStateAfter.total_value === 'number') totalValueAfterCloseShort = Number(dbStateAfter.total_value);
            else if (dbStateAfter && typeof dbStateAfter.totalValue === 'number') totalValueAfterCloseShort = Number(dbStateAfter.totalValue);
            else {
                try { totalValueAfterCloseShort = Number(this.portfolio.getTotalValue(price)) || Number(this.portfolio.balance || 0); } catch (e) { totalValueAfterCloseShort = Number(this.portfolio.balance || 0); }
            }

            const investedShortAfter = Array.isArray(this.portfolio.openPositions) ? this.portfolio.openPositions.filter(p => p.side === 'short').reduce((s, p) => s + (Number(p.entryUsd || (p.amountBtc * (p.entryPrice || price))) || 0), 0) : 0;
            const targetExposureShortAfter = totalValueAfterCloseShort * 0.5;
            const additionalNeededShortAfter = Math.max(0, targetExposureShortAfter - investedShortAfter);
            tradeAmount = additionalNeededShortAfter;

            const availableCashShort = dbStateAfter && typeof dbStateAfter.balance === 'number' ? Number(dbStateAfter.balance) : Number(this.portfolio.balance || 0);
            if (tradeAmount > availableCashShort) {
                console.log(`⚠️ Cash insufficient to reach targetExposure (SHORT): desired=$${tradeAmount.toFixed(2)}, available=$${availableCashShort.toFixed(2)} — will clamp to available`);
                tradeAmount = Math.floor(availableCashShort * 100) / 100;
            }
            console.log(`🔁 Closed opposite position — recalculando sizing (SHORT) desde totalValue: totalValueAfterClose=$${totalValueAfterCloseShort.toFixed(2)}, targetExposure=$${targetExposureShortAfter.toFixed(2)}, investedShortAfter=$${investedShortAfter.toFixed(2)}, tradeAmount=$${tradeAmount.toFixed(2)}`);
        } catch (e) {
            console.warn('⚠️ Error leyendo balance después de cerrar posición (SHORT), usando sizing previo:', e && e.message ? e.message : e);
        }
    }

    if (tradeAmount < 10) {
        console.log('ℹ️ No se abre SHORT: monto calculado demasiado pequeño o objetivo ya alcanzado', { tradeAmount, additionalNeededShort, investedShortUsd, targetExposureShort });
        return false;
    }
    console.log(`📐 Tamaño de orden calculado (SHORT): totalValue=$${totalValueShort.toFixed(2)}, investedShortUsd=$${investedShortUsd.toFixed(2)}, targetExposure=$${targetExposureShort.toFixed(2)}, tradeAmount=$${tradeAmount.toFixed(2)} (usando cash=$${balanceForSizingShort.toFixed(2)})`);
    const btcAmount = tradeAmount / price;
        // Fee removed for simulation/testing per request
        const fee = 0;

        const trade = {
            type: 'SELL',
            amount: btcAmount,
            price: price,
            usdAmount: tradeAmount,
            fee: fee,
            timestamp: new Date(),
            confidence: confidence,
            reasons: reasons,
            stopLoss: null,
            takeProfit: null,
            positionSide: 'short',
            action: 'open'
        };

        const ok = await this.portfolio.executeTrade(trade);
        if (ok) {
            this.lastTradeTime = Date.now();
            this.currentPosition = { side: 'short', amountBtc: btcAmount, entryPrice: price };
            console.log(`✅ SHORT ABIERTO: ${btcAmount.toFixed(8)} BTC a $${price.toFixed(2)}`);
        }
        return ok;
    }

    async closeShort(price, confidence, reasons = []) {
        if (!this.currentPosition || this.currentPosition.side !== 'short') return false;
        const btcAmount = this.currentPosition.amountBtc;
        const usdAmount = btcAmount * price;
    // Fee removed for simulation/testing per request
    const fee = 0;

        const trade = {
            type: 'BUY',
            amount: btcAmount,
            price: price,
            usdAmount: usdAmount,
            fee: fee,
            timestamp: new Date(),
            confidence: confidence,
            reasons: reasons,
            positionSide: 'short',
            action: 'close'
        };

        const ok = await this.portfolio.executeTrade(trade);
        if (ok) {
            this.lastTradeTime = Date.now();
            this.currentPosition = null;
            console.log(`✅ SHORT CERRADO: ${btcAmount.toFixed(8)} BTC a $${price.toFixed(2)}`);
        }
        return ok;
    }

    // Basic position checks - MAXI1 doesn't use SL/TP but keep a simple logger
    async checkPositions(currentPrice) {
        if (!this.currentPosition) return;
        console.log(`🔍 [CHECK] Manteniendo ${this.currentPosition.side} - entry ${this.currentPosition.entryPrice}`);
    }

    // Synchronize currentPosition from portfolio.openPositions
    async syncCurrentPosition() {
        try {
            const openPositions = this.portfolio.openPositions || [];
            const filtered = openPositions.filter(p => p.side === 'long' || p.side === 'short');
            if (filtered.length > 0) {
                const latest = filtered.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
                this.currentPosition = { side: latest.side, amountBtc: latest.amountBtc, entryPrice: latest.entryPrice };
            } else {
                this.currentPosition = null;
            }
            return this.currentPosition;
        } catch (e) {
            console.error('Error sincronizando posición actual:', e && e.message ? e.message : e);
            this.currentPosition = null;
            return null;
        }
    }

    // Atomic switch: cierra la posición opuesta, espera el estado DB, recalcula sizing y abre la nueva posición.
    // targetSide: 'long' | 'short'
    async switchPosition(targetSide, price, confidence = 80, reasons = [], signals = {}) {
        try {
            const opposite = targetSide === 'long' ? 'short' : 'long';

            // If opposite is open, close it first
            if (this.currentPosition && this.currentPosition.side === opposite) {
                console.log(`⚠️ Existe ${opposite.toUpperCase()} abierto — cerrando atómicamente antes de abrir ${targetSide.toUpperCase()}`);
                const closed = opposite === 'long' ? await this.closeLong(price, confidence, ['SWITCH_ATOMIC: auto-close']) : await this.closeShort(price, confidence, ['SWITCH_ATOMIC: auto-close']);
                if (!closed) {
                    console.log(`❌ No se pudo cerrar ${opposite} — abortando switch a ${targetSide}`);
                    return false;
                }
            }

            // Read canonical state from DB after close
            let dbStateAfter = null;
            try {
                if (this.portfolio && this.portfolio.db && typeof this.portfolio.db.getPortfolioState === 'function') {
                    dbStateAfter = await this.portfolio.db.getPortfolioState();
                }
            } catch (e) {
                console.warn('⚠️ Error leyendo estado DB tras cierre en switchPosition:', e && e.message ? e.message : e);
            }

            // Reload in-memory portfolio to ensure accurate exposures
            try {
                if (this.portfolio && typeof this.portfolio.loadFromDatabase === 'function') {
                    await this.portfolio.loadFromDatabase();
                }
            } catch (e) {
                console.warn('⚠️ No se pudo recargar portfolio desde DB en switchPosition:', e && e.message ? e.message : e);
            }

            const totalValueAfterClose = dbStateAfter && typeof dbStateAfter.total_value === 'number' ? Number(dbStateAfter.total_value) : (this.portfolio ? Number(this.portfolio.getTotalValue(price) || 0) : 0);
            const balanceAfterClose = dbStateAfter && typeof dbStateAfter.balance === 'number' ? Number(dbStateAfter.balance) : (this.portfolio ? Number(this.portfolio.balance || 0) : 0);

            const targetExposure = totalValueAfterClose * 0.5;
            const investedAfter = Array.isArray(this.portfolio.openPositions) ? this.portfolio.openPositions.filter(p => p.side === targetSide).reduce((s, p) => s + (Number(p.entryUsd || (p.amountBtc * (p.entryPrice || price))) || 0), 0) : 0;
            const desiredUsd = Math.max(0, targetExposure - investedAfter);

            let finalUsd = Math.min(desiredUsd, balanceAfterClose);
            // Clamp to 2 decimals
            finalUsd = Math.floor(finalUsd * 100) / 100;

            // Audit requested vs final
            try {
                if (this.portfolio && this.portfolio.db && typeof this.portfolio.db.addTradeAudit === 'function') {
                    await this.portfolio.db.addTradeAudit({ tradeId: null, requestedUsd: desiredUsd, finalUsd: finalUsd, balanceSnapshot: balanceAfterClose, note: `SWITCH_ATOMIC to ${targetSide}` });
                }
            } catch (e) {
                console.warn('⚠️ Error registrando audit en switchPosition:', e && e.message ? e.message : e);
            }

            if (finalUsd < 10) {
                console.log('ℹ️ Switch aborted: monto final demasiado pequeño o cash insuficiente', { desiredUsd, finalUsd, balanceAfterClose });
                return false;
            }

            // Build trade and execute directly on portfolio to guarantee exact usd amount
            const trade = {
                type: targetSide === 'long' ? 'BUY' : 'SELL',
                amount: finalUsd / price,
                price: price,
                usdAmount: finalUsd,
                fee: 0,
                timestamp: new Date(),
                confidence: confidence,
                reasons: (reasons || []).concat([`SWITCH_ATOMIC to ${targetSide}`]),
                positionSide: targetSide,
                action: 'open'
            };

            console.log(`📐 switchPosition: totalAfter=$${totalValueAfterClose.toFixed(2)}, targetExposure=$${targetExposure.toFixed(2)}, investedAfter=$${investedAfter.toFixed(2)}, requested=${desiredUsd.toFixed(2)}, final=${finalUsd.toFixed(2)}`);

            const ok = await this.portfolio.executeTrade(trade);
            if (ok) {
                console.log(`✅ SWITCH_ATOMIC: abierto ${targetSide.toUpperCase()} por $${finalUsd.toFixed(2)} (${(finalUsd/price).toFixed(8)} BTC)`);
                await this.syncCurrentPosition();
            } else {
                console.log('❌ SWITCH_ATOMIC: fallo en apertura de la nueva posición');
            }
            return ok;
        } catch (e) {
            console.error('Error en switchPosition:', e && e.message ? e.message : e);
            return false;
        }
    }

    logRiskAnalysis(trade) {
        try {
            const portfolioValue = this.portfolio.getTotalValue();
            const riskAmount = trade.usdAmount || 0;
            const riskPercent = portfolioValue ? (riskAmount / portfolioValue) * 100 : 0;
            console.log(`📈 Riesgo por operación: $${riskAmount.toFixed(2)} (${riskPercent.toFixed(2)}%)`);
        } catch (e) {}
    }

    async getStats() {
        return {
            isActive: this.isActive,
            strategy: this.strategy,
            lastTradeTime: this.lastTradeTime
        };
    }

    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        console.log('⚙️ Configuración actualizada:', this.settings);
        return true;
    }
}

module.exports = TradingBot
