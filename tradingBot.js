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
                // Sync position after close and wait until DB+memory confirm closure
                await this.syncCurrentPosition();
                await this.waitForPositionClosed('short', 5000, 200);
                // -- SIMPLE MODE: force in-memory balance to total_value so we can reinvest immediately
                try {
                    const fallbackTotal = Number(this.portfolio.getTotalValue(price)) || 0;
                    console.log(`⚠️ SIMPLE MODE: forzando balance en memoria a total_value=$${fallbackTotal.toFixed(2)} para reinversión inmediata`);
                    this.portfolio.balance = Number(fallbackTotal);
                } catch (e) {
                    console.warn('⚠️ No se pudo forzar balance en memoria:', e && e.message ? e.message : e);
                }
            }
        } catch (e) {
            console.error('Error intentando cerrar SHORT antes de abrir LONG:', e && e.message ? e.message : e);
            return false;
        }

    // Nuevo comportamiento simplificado: invertir TODO el valor total del portafolio
    // Leer estado DB y calcular totalValue (fuente de verdad)
    let balanceForSizing = Number(this.portfolio.balance || 0);
    let totalValue = null;
    try {
        // Force a fresh in-memory reload to avoid using stale cached state
        try {
            if (this.portfolio && typeof this.portfolio.loadFromDatabase === 'function') {
                await this.portfolio.loadFromDatabase();
            }
        } catch (e) {
            console.warn('⚠️ No se pudo recargar portfolio antes de sizing (no crítico):', e && e.message ? e.message : e);
        }

        if (this.portfolio && this.portfolio.db && typeof this.portfolio.db.getPortfolioState === 'function') {
            const dbState = await this.portfolio.db.getPortfolioState();
            if (dbState) {
                if (typeof dbState.balance === 'number') balanceForSizing = Number(dbState.balance);
                if (typeof dbState.total_value === 'number') totalValue = Number(dbState.total_value);
                const inMemoryTotal = (() => { try { return Number(this.portfolio.getTotalValue(price)); } catch(_) { return null; } })();
                console.log(`🛰️ Usando estado DB para sizing: db.balance=$${balanceForSizing.toFixed(2)}, db.total_value=${totalValue !== null ? '$'+totalValue.toFixed(2) : 'N/A'}, inMemoryTotal=${inMemoryTotal !== null ? '$'+inMemoryTotal.toFixed(2) : 'N/A'}`);
            }
        }
    } catch (err) {
        console.warn('⚠️ No se pudo leer estado desde DB para sizing, usando valores en memoria:', err && err.message ? err.message : err);
    }

    if (totalValue === null) {
        try {
            totalValue = Number(this.portfolio.getTotalValue(price)) || Number(this.portfolio.initialBalance || 0);
        } catch (err) {
            totalValue = Number(this.portfolio.initialBalance || 0);
        }
    }

    // Deseamos invertir TODO el totalValue (clamp parcial a cash si necesario)
    const openPositions = Array.isArray(this.portfolio.openPositions) ? this.portfolio.openPositions : [];
    const investedLongUsd = openPositions
        .filter(p => p.side === 'long')
        .reduce((s, p) => s + (Number(p.entryUsd || (p.amountBtc * (p.entryPrice || price))) || 0), 0);

    let tradeAmount = Number(totalValue || 0);
    // Clamp to available cash to avoid attempting to spend more than balance
    tradeAmount = Math.min(tradeAmount, balanceForSizing);
    if (closedOpposite) {
        try {
            // Ensure we reload DB state after the close to have canonical values
            try {
                if (this.portfolio && typeof this.portfolio.loadFromDatabase === 'function') await this.portfolio.loadFromDatabase();
            } catch (e) {
                console.warn('⚠️ No se pudo recargar portfolio tras cierre (no crítico):', e && e.message ? e.message : e);
            }
            const dbStateAfter = (this.portfolio && this.portfolio.db && typeof this.portfolio.db.getPortfolioState === 'function') ? await this.portfolio.db.getPortfolioState() : null;
            try { console.log('🛰️ DB raw state after close:', dbStateAfter); } catch (e) {}
            try {
                if (typeof this.portfolio.loadFromDatabase === 'function') {
                    await this.portfolio.loadFromDatabase();
                }
            } catch (e) {
                console.warn('⚠️ No se pudo recargar portfolio desde DB:', e && e.message ? e.message : e);
            }

            let totalValueAfterClose = null;
            if (dbStateAfter && typeof dbStateAfter.total_value === 'number') totalValueAfterClose = Number(dbStateAfter.total_value);
            else if (dbStateAfter && typeof dbStateAfter.totalValue === 'number') totalValueAfterClose = Number(dbStateAfter.totalValue);
            else {
                try {
                    totalValueAfterClose = Number(this.portfolio.getTotalValue(price)) || Number(this.portfolio.balance || 0);
                } catch (err) {
                    totalValueAfterClose = Number(this.portfolio.balance || 0);
                }
            }
                    // Debug: show both DB and in-memory total for diagnosis
                    let inMemoryTotalForDebug = null;
                    try { inMemoryTotalForDebug = Number(this.portfolio.getTotalValue(price)); } catch(e) { inMemoryTotalForDebug = null; }
                    try { console.log(`🛰️ totalValueAfterClose (db)=${totalValueAfterClose}, totalValueAfterClose(inMemory)=${inMemoryTotalForDebug !== null ? '$'+inMemoryTotalForDebug.toFixed(2) : 'N/A'}`); } catch(e){}

            // If DB reports zero/negative total_value (likely due to DB snapshot), prefer a healthy in-memory total when available
            if ((totalValueAfterClose === null || totalValueAfterClose <= 0) && inMemoryTotalForDebug && inMemoryTotalForDebug > 0) {
                console.log(`⚠️ DB total_value is ${totalValueAfterClose}; falling back to in-memory total_value $${inMemoryTotalForDebug.toFixed(2)} for sizing`);
                totalValueAfterClose = inMemoryTotalForDebug;
            }

            // invertir el totalValueAfterClose
            tradeAmount = Number(totalValueAfterClose || 0);

            // Si el cash disponible es menor, hacemos clamp al efectivo disponible para no fallar
            // SIMPLE MODE: ignore cash clamp and invest the full totalValueAfterClose (or in-memory fallback)
            console.log(`🔁 Closed opposite position (SIMPLE MODE) — usando total_value para sizing: totalValueAfterClose=$${(totalValueAfterClose||0).toFixed(2)}, investedLongAfter=${investedLongUsd.toFixed(2)}, tradeAmount=$${tradeAmount.toFixed(2)}`);
        } catch (e) {
            console.warn('⚠️ Error leyendo estado después de cerrar posición, usando sizing previo:', e && e.message ? e.message : e);
        }
    }

    const MIN_ORDER_USD = Number(process.env.MIN_ORDER_USD || 0); // configurable minimum order size (default 0 => always allow)
    if (tradeAmount < MIN_ORDER_USD) {
        console.log('ℹ️ No se abre LONG: monto calculado demasiado pequeño o objetivo ya alcanzado', { tradeAmount, investedLongUsd, MIN_ORDER_USD });
        return false;
    }
    console.log(`📐 Tamaño de orden calculado (LONG): totalValue=$${Number(totalValue||0).toFixed(2)}, investedLongUsd=$${investedLongUsd.toFixed(2)}, tradeAmount=$${tradeAmount.toFixed(2)} (usando cash=$${balanceForSizing.toFixed(2)})`);
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
        if (closedOpposite) trade.forceSimple = true;

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
                // Sync position after close and wait until DB+memory confirm closure
                await this.syncCurrentPosition();
                await this.waitForPositionClosed('long', 5000, 200);
                // -- SIMPLE MODE: force in-memory balance to total_value so we can reinvest immediately
                try {
                    const fallbackTotal = Number(this.portfolio.getTotalValue(price)) || 0;
                    console.log(`⚠️ SIMPLE MODE: forzando balance en memoria a total_value=$${fallbackTotal.toFixed(2)} para reinversión inmediata`);
                    this.portfolio.balance = Number(fallbackTotal);
                } catch (e) {
                    console.warn('⚠️ No se pudo forzar balance en memoria:', e && e.message ? e.message : e);
                }
            }
        } catch (e) {
            console.error('Error intentando cerrar LONG antes de abrir SHORT:', e && e.message ? e.message : e);
            return false;
        }

    // Nuevo comportamiento: invertir TODO el valor total del portafolio (SHORT)
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

    // Deseamos invertir TODO el totalValueShort
    let tradeAmount = Number(totalValueShort || 0);
    // Clamp to available cash to avoid attempting to spend more than balance
    tradeAmount = Math.min(tradeAmount, balanceForSizingShort);
    if (closedOppositeShort) {
        try {
            const dbStateAfter = (this.portfolio && this.portfolio.db && typeof this.portfolio.db.getPortfolioState === 'function') ? await this.portfolio.db.getPortfolioState() : null;
            try { console.log('🛰️ DB raw state after close (SHORT):', dbStateAfter); } catch (e) {}
            try {
                if (typeof this.portfolio.loadFromDatabase === 'function') {
                    await this.portfolio.loadFromDatabase();
                }
            } catch (e) {
                console.warn('⚠️ No se pudo recargar portfolio desde DB (SHORT):', e && e.message ? e.message : e);
            }

            let totalValueAfterCloseShort = null;
            if (dbStateAfter && typeof dbStateAfter.total_value === 'number') totalValueAfterCloseShort = Number(dbStateAfter.total_value);
            else if (dbStateAfter && typeof dbStateAfter.totalValue === 'number') totalValueAfterCloseShort = Number(dbStateAfter.totalValue);
            else {
                try { totalValueAfterCloseShort = Number(this.portfolio.getTotalValue(price)) || Number(this.portfolio.balance || 0); } catch (e) { totalValueAfterCloseShort = Number(this.portfolio.balance || 0); }
            }

            // Debug: show both DB and in-memory total for diagnosis
            let inMemoryTotalForDebugShort = null;
            try { inMemoryTotalForDebugShort = Number(this.portfolio.getTotalValue(price)); } catch(e) { inMemoryTotalForDebugShort = null; }
            try { console.log(`🛰️ totalValueAfterClose (db)=${totalValueAfterCloseShort}, totalValueAfterClose(inMemory)=${inMemoryTotalForDebugShort !== null ? '$'+inMemoryTotalForDebugShort.toFixed(2) : 'N/A'}`); } catch(e){}

            // If DB reports zero/negative total_value, prefer a healthy in-memory total when available
            if ((totalValueAfterCloseShort === null || totalValueAfterCloseShort <= 0) && inMemoryTotalForDebugShort && inMemoryTotalForDebugShort > 0) {
                console.log(`⚠️ DB total_value is ${totalValueAfterCloseShort}; falling back to in-memory total_value $${inMemoryTotalForDebugShort.toFixed(2)} for sizing (SHORT)`);
                totalValueAfterCloseShort = inMemoryTotalForDebugShort;
            }

            // invertir el totalValueAfterCloseShort
            tradeAmount = Number(totalValueAfterCloseShort || 0);

            // SIMPLE MODE: ignore cash clamp and invest the full totalValueAfterCloseShort (or in-memory fallback)
            console.log(`🔁 Closed opposite position (SIMPLE MODE) — usando total_value para sizing (SHORT): totalValueAfterClose=$${(totalValueAfterCloseShort||0).toFixed(2)}, investedShortAfter=${investedShortUsd.toFixed(2)}, tradeAmount=$${tradeAmount.toFixed(2)}`);
        } catch (e) {
            console.warn('⚠️ Error leyendo balance después de cerrar posición (SHORT), usando sizing previo:', e && e.message ? e.message : e);
        }
    }

    if (tradeAmount < 10) {
        const MIN_ORDER_USD = Number(process.env.MIN_ORDER_USD || 0);
        console.log('ℹ️ No se abre SHORT: monto calculado demasiado pequeño o objetivo ya alcanzado', { tradeAmount, investedShortUsd, MIN_ORDER_USD });
        return false;
    }
    console.log(`📐 Tamaño de orden calculado (SHORT): totalValue=$${Number(totalValueShort||0).toFixed(2)}, investedShortUsd=$${investedShortUsd.toFixed(2)}, tradeAmount=$${tradeAmount.toFixed(2)} (usando cash=$${balanceForSizingShort.toFixed(2)})`);
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

        if (closedOppositeShort) trade.forceSimple = true;
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

    // Wait until a given side position is fully closed (both in-memory and DB), with timeout
    async waitForPositionClosed(side, timeoutMs = 5000, pollMs = 200) {
        try {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                try {
                    if (this.portfolio && typeof this.portfolio.loadFromDatabase === 'function') {
                        await this.portfolio.loadFromDatabase();
                    }
                } catch (e) {
                    // non-fatal
                }
                await this.syncCurrentPosition();

                const inMemoryHas = this.currentPosition && this.currentPosition.side === side;
                const dbHas = Array.isArray(this.portfolio.openPositions) && this.portfolio.openPositions.some(p => p.side === side);
                if (!inMemoryHas && !dbHas) {
                    return true;
                }
                await new Promise(r => setTimeout(r, pollMs));
            }
            console.warn(`⚠️ waitForPositionClosed: timeout waiting for ${side} to close`);
            return false;
        } catch (e) {
            console.warn('⚠️ Error en waitForPositionClosed:', e && e.message ? e.message : e);
            return false;
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
                // Ensure DB and memory reflect the close before continuing
                await this.syncCurrentPosition();
                await this.waitForPositionClosed(opposite, 5000, 200);
                // SIMPLE MODE: force in-memory balance to total_value so we can reinvest immediately
                try {
                    const fallbackTotal = Number(this.portfolio.getTotalValue(price)) || 0;
                    console.log(`⚠️ SIMPLE MODE: forzando balance en memoria a total_value=$${fallbackTotal.toFixed(2)} para reinversión inmediata (switch)`);
                    this.portfolio.balance = Number(fallbackTotal);
                } catch (e) {
                    console.warn('⚠️ No se pudo forzar balance en memoria (switch):', e && e.message ? e.message : e);
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

            // Use full total value as the target exposure (invest all)
            const targetExposure = Number(totalValueAfterClose || 0);
            const investedAfter = Array.isArray(this.portfolio.openPositions) ? this.portfolio.openPositions.filter(p => p.side === targetSide).reduce((s, p) => s + (Number(p.entryUsd || (p.amountBtc * (p.entryPrice || price))) || 0), 0) : 0;
            const desiredUsd = Math.max(0, targetExposure - investedAfter);

            // SIMPLE MODE: invest the in-memory total value after close regardless of DB cash
            let finalUsd = 0;
            try {
                finalUsd = Number(this.portfolio.getTotalValue(price)) || Number(desiredUsd || 0);
            } catch (e) {
                finalUsd = Number(desiredUsd || 0);
            }
            // Clamp to 2 decimals
            finalUsd = Math.floor(finalUsd * 100) / 100;

            // Audit requested vs final (requested = desired to reach full total)
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

            // In SIMPLE MODE, allow immediate reinvestment after the close
            trade.forceSimple = true;

            console.log(`📐 switchPosition: totalAfter=$${Number(totalValueAfterClose||0).toFixed(2)}, targetExposure=$${Number(targetExposure||0).toFixed(2)}, investedAfter=$${investedAfter.toFixed(2)}, requested=${desiredUsd.toFixed(2)}, final=${finalUsd.toFixed(2)}`);

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
