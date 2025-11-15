const DatabaseManager = require('./database');

class Portfolio {
    constructor(initialBalance = 10000) {
        this.db = new DatabaseManager();
        this.initialBalance = initialBalance;
        
        // Estado actual (se carga desde BD)
        this.balance = initialBalance;
        this.btcAmount = 0;
        this.trades = [];
        this.startDate = new Date();
        // Posiciones abiertas
        this.openPositions = []; // { id, side: 'long'|'short', amountBtc, entryPrice, stopLoss, takeProfit, timestamp }
        
        this.isInitialized = false;
        // Lightweight mutex to serialize trade executions and avoid race conditions
        this._tradeLock = false;

        // SIMPLE MODE: cuando está activado, el portfolio permite bypass de comprobaciones
        // de fondos para facilitar simulaciones donde "se reinvierte TODO" sin restricciones.
        this.simpleMode = (process.env.BOT_SIMPLE_MODE === '1' || process.env.BOT_SIMPLE_MODE === 'true' || process.env.BOT_SIMPLE_MODE === 'on');
        if (this.simpleMode) {
            console.warn('⚠️ Portfolio iniciado en SIMPLE MODE — se permitirán operaciones aun sin fondos reales (modo simulación).');
        }
    }

    // Internal helper to run a function with a simple mutex
    async _withTradeLock(fn) {
        // Wait until lock is free
        while (this._tradeLock) {
            await new Promise(r => setTimeout(r, 20));
        }
        this._tradeLock = true;
        try {
            return await fn();
        } finally {
            this._tradeLock = false;
        }
    }

    // Inicializar conexión a base de datos
    async initialize() {
        try {
            const success = await this.db.initialize();
            if (!success) {
                console.error('❌ Error inicializando base de datos');
                return false;
            }

            // Cargar estado actual desde BD
            await this.loadFromDatabase();
            this.isInitialized = true;
            
            console.log('✅ Portfolio inicializado con base de datos');
            return true;
        } catch (error) {
            console.error('Error inicializando portfolio:', error);
            return false;
        }
    }

    // Cargar datos desde la base de datos
    async loadFromDatabase() {
        try {
            const portfolioState = await this.db.getPortfolioState();
            if (portfolioState) {
                // Use safe numeric conversion to preserve zero values from DB.
                const safeNum = (v) => {
                    const n = Number(v);
                    return (typeof n === 'number' && !Number.isNaN(n) && Number.isFinite(n)) ? n : 0;
                };

                this.balance = safeNum(portfolioState.balance);
                this.btcAmount = safeNum(portfolioState.btc_amount);
                this.initialBalance = safeNum(portfolioState.initial_balance) || this.initialBalance;
                this.startDate = new Date(portfolioState.start_date || new Date());
                console.log(`📊 Estado cargado - Balance: $${this.balance.toFixed(2)}, BTC: ${this.btcAmount.toFixed(8)}`);
            } else {
                // Si no hay estado, inicializar con valores por defecto
                this.balance = this.initialBalance;
                this.btcAmount = 0;
                console.log(`📊 Estado inicial - Balance: $${this.balance.toFixed(2)}, BTC: ${this.btcAmount.toFixed(8)}`);
            }

            // Cargar operaciones recientes
            this.trades = await this.db.getTrades(50);
            console.log(`📈 ${this.trades.length} operaciones cargadas`);
            if (this.trades.length > 0) {
                console.log(`📈 Última trade cargada:`, {
                    id: this.trades[0].id,
                    position_side: this.trades[0].position_side,
                    action: this.trades[0].action
                });
            }

            // Reconstruir posiciones abiertas (long: si hay BTC > 0; short: a partir de trades con position_side='short' abiertos)
            this.rebuildOpenPositionsFromTrades();
        } catch (error) {
            console.error('Error cargando desde base de datos:', error);
        }
    }

    rebuildOpenPositionsFromTrades() {
        console.log(`🔄 [REBUILD] Reconstruyendo posiciones abiertas desde ${this.trades.length} trades`);
        // Reconstrucción determinista: normalizar campos y construir mapa de opens/closeds
        this.openPositions = [];

        const normalizeId = (t) => t.position_id || t.positionId || t.trade_id || t.id || null;

        // Agrupar opens y closes por side
        const opensBySide = { long: [], short: [] };
        const closesBySide = { long: new Set(), short: new Set() };

        for (const t of this.trades) {
            const side = (t.position_side || t.positionSide || (t.type === 'SELL' && t.action === 'open' ? 'short' : 'long')) || null;
            const action = (t.action || '').toLowerCase();
            const pid = normalizeId(t);

            if (!side || !action) continue;

            if (action === 'open') {
                opensBySide[side] = opensBySide[side] || [];
                opensBySide[side].push(Object.assign({}, t, { _norm_id: pid }));
            } else if (action === 'close') {
                if (pid) closesBySide[side].add(pid);
            }
        }

        // Construir posiciones abiertas a partir de opens que no tienen close correspondiente
        for (const side of ['short', 'long']) {
            const opens = opensBySide[side] || [];
            for (const o of opens) {
                const pid = o._norm_id;
                if (!pid || !closesBySide[side].has(pid)) {
                    const posId = pid || (`${side}_${o.trade_id || o.id || Date.now()}`);
                    console.log(`🔄 [REBUILD] Agregando ${side.toUpperCase()} abierto: ${posId}`);
                    this.openPositions.push({
                        id: posId,
                        side: side,
                        amountBtc: Number(o.amount) || Number(o.amountBtc) || 0,
                        entryPrice: Number(o.price) || Number(o.entryPrice) || 0,
                        stopLoss: o.stop_loss || o.stopLoss || null,
                        takeProfit: o.take_profit || o.takeProfit || null,
                        entryUsd: Number(o.usd_amount || o.usdAmount || o.entryUsd || 0) || 0,
                        timestamp: o.timestamp ? new Date(o.timestamp) : new Date()
                    });
                } else {
                    console.log(`🔄 [REBUILD] ${side.toUpperCase()} ya cerrado: ${pid}`);
                }
            }
        }

        // Sincronizar valores en memoria: si hay longs abiertas pero btcAmount en memoria es 0, setearlo
        try {
            const totalOpenLongBtc = this.openPositions.filter(p => p.side === 'long').reduce((s, p) => s + (Number(p.amountBtc) || 0), 0);
            if (this.btcAmount === 0 && totalOpenLongBtc > 0) {
                console.log(`🔄 [REBUILD SYNC] sincronizando btcAmount desde posiciones abiertas: ${totalOpenLongBtc.toFixed(8)}`);
                this.btcAmount = Number(totalOpenLongBtc) || 0;
            }
        } catch (err) {
            console.warn('⚠️ Error sincronizando btcAmount desde rebuild:', err && err.message ? err.message : err);
        }

        // Nota: no forzamos cambios al balance desde rebuild; el balance es la fuente de verdad en portfolio_state
    }

    // Guardar estado en base de datos
    async saveToDatabase() {
        try {
            const currentBtcPrice = await this.getCurrentBtcPrice();
            // Use explicit numeric conversion and allow zero values.
            // Previous code used `Number(this.balance) || this.initialBalance` which
            // mistakenly stored `initialBalance` when `balance` was 0. That hid the
            // real cash balance in the DB and caused confusing logs/metrics.
            const safeNum = (v) => {
                const n = Number(v);
                return (typeof n === 'number' && !Number.isNaN(n) && Number.isFinite(n)) ? n : 0;
            };

            const state = {
                balance: safeNum(this.balance),
                btcAmount: safeNum(this.btcAmount),
                initialBalance: safeNum(this.initialBalance) || 0,
                totalValue: this.getTotalValue(currentBtcPrice),
                totalReturn: this.getTotalReturn(currentBtcPrice),
                realizedPnL: this.calculateRealizedPnL(),
                unrealizedPnL: this.getUnrealizedPnL(currentBtcPrice),
                totalFees: this.calculateTotalFees(),
                maxDrawdown: await this.calculateMaxDrawdown(currentBtcPrice),
                sharpeRatio: await this.calculateSharpeRatio()
            };

            await this.db.updatePortfolioState(state);

            // Build a richer log to avoid confusion between "balance" (efectivo)
            // and "totalValue" (capital inicial + PnL). This helps debugging.
            const totalValue = Number(state.totalValue || 0);
            const btcAmount = Number(state.btcAmount || 0);
            await this.db.addLog('info', `Portfolio actualizado - Balance: $${this.balance.toFixed(2)} - TotalValue: $${totalValue.toFixed(2)} - BTC: ${btcAmount.toFixed(8)}`, 'portfolio');
        } catch (error) {
            console.error('Error guardando en base de datos:', error);
        }
    }

    // Obtener la última operación de tipo BUY en memoria (rápido, no async)
    getLastBuyTrade() {
        try {
            if (!this.trades || this.trades.length === 0) return null;
            // Las trades se almacenan con la más reciente al inicio (unshift)
            for (const t of this.trades) {
                if (t.type && t.type.toUpperCase() === 'BUY') return t;
            }
            return null;
        } catch (error) {
            console.error('Error obteniendo última compra:', error);
            return null;
        }
    }

    // Ejecutar operación de trading
    async executeTrade(trade) {
        // Serialize trade executions to avoid race conditions
        return await this._withTradeLock(async () => {
            if (!this.isInitialized) {
                console.error('❌ Portfolio no inicializado');
                return false;
            }

            try {
                if (trade.type === 'BUY') {
                    return await this.executeBuy(trade);
                } else if (trade.type === 'SELL') {
                    return await this.executeSell(trade);
                }
                return false;
            } catch (error) {
                console.error('Error ejecutando operación:', error);
                try { await this.db.addLog('error', `Error ejecutando operación: ${error.message}`, 'portfolio'); } catch(e){}
                return false;
            }
        });
    }

    // Ejecutar compra
    async executeBuy(trade) {
        // Si es cierre de short
        if (trade.positionSide === 'short' && trade.action === 'close') {
            return await this.executeShortClose(trade);
        }

        // Si es apertura de long
        if (trade.positionSide === 'long' && trade.action === 'open') {
            return await this.executeLongOpen(trade);
        }

        const totalCost = trade.usdAmount + trade.fee;
        
        // Verificar si tenemos suficiente balance
        if (this.balance < totalCost && !this.simpleMode) {
            const message = `Balance insuficiente para compra: $${this.balance.toFixed(2)} < $${totalCost.toFixed(2)}`;
            console.log('❌ ' + message);
            await this.db.addLog('warning', message, 'portfolio');
            return false;
        } else if (this.balance < totalCost && this.simpleMode) {
            const message = `⚠️ SIMPLE MODE: Balance insuficiente pero permitiendo compra (balance=$${this.balance.toFixed(2)}, cost=$${totalCost.toFixed(2)})`;
            console.warn(message);
            try { await this.db.addLog('warning', message, 'portfolio'); } catch(e){}
            // En modo simple dejamos que la operación deje balance negativo para simular reinversión inmediata
        }

        // Ejecutar la compra
        this.balance -= totalCost;
        this.btcAmount += trade.amount;
        
        // Ensure amounts are valid numbers
        this.balance = Number(this.balance) || 0;
        this.btcAmount = Number(this.btcAmount) || 0;
        trade.amount = Number(trade.amount) || 0;
        
        // Preparar datos de la operación
        trade.id = this.generateTradeId();
        trade.balanceAfter = this.balance;
        trade.btcAfter = this.btcAmount;
        trade.timestamp = new Date();
        
        // Guardar en base de datos
        await this.db.saveTrade(trade);
        this.trades.unshift(trade); // Añadir al principio del array
        
        // Calcular métricas de la operación (para compras, solo set entry_price)
        await this.db.runQuery(
            "UPDATE trades SET entry_price = ?, exit_price = 0, gain_loss = 0, roi = 0 WHERE trade_id = ?",
            [trade.price, trade.id]
        );
        
        // Actualizar estado del portfolio
        await this.saveToDatabase();
        
        // Reconstruir posiciones abiertas después del trade
        this.rebuildOpenPositionsFromTrades();
        
        console.log(`🔹 COMPRA EJECUTADA: ${trade.amount.toFixed(8)} BTC por $${trade.usdAmount.toFixed(2)}`);
        console.log(`💰 Balance restante: $${this.balance.toFixed(2)}`);
        console.log(`₿ BTC total: ${this.btcAmount.toFixed(8)}`);
        
        await this.db.addLog('info', `Compra ejecutada: ${trade.amount.toFixed(8)} BTC por $${trade.usdAmount.toFixed(2)}`, 'trading');
        
        return true;
    }

    // Ejecutar venta
    async executeSell(trade) {
        // Si es apertura de short, permitimos vender sin BTC (venta en corto)
        if (trade.positionSide === 'short' && trade.action === 'open') {
            return await this.executeShortOpen(trade);
        }

        // Si es cierre de long
        if (trade.positionSide === 'long' && trade.action === 'close') {
            return await this.executeLongClose(trade);
        }

        // Verificar si tenemos suficiente BTC (venta normal para cerrar long)
        if (this.btcAmount < trade.amount && !this.simpleMode) {
            const message = `BTC insuficiente para venta: ${this.btcAmount.toFixed(8)} < ${trade.amount.toFixed(8)}`;
            console.log('❌ ' + message);
            await this.db.addLog('warning', message, 'portfolio');
            return false;
        } else if (this.btcAmount < trade.amount && this.simpleMode) {
            const message = `⚠️ SIMPLE MODE: BTC insuficiente pero permitiendo venta (btc=${this.btcAmount.toFixed(8)}, requested=${trade.amount.toFixed(8)})`;
            console.warn(message);
            try { await this.db.addLog('warning', message, 'portfolio'); } catch(e){}
            // En modo simple permitimos que btcAmount quede negativo para simular posiciones sintéticas
        }

        // Ejecutar la venta
        const netAmount = trade.usdAmount - trade.fee;
        this.btcAmount -= trade.amount;
        this.balance += netAmount;
        
        // Ensure amounts are valid numbers
        this.balance = Number(this.balance) || 0;
        this.btcAmount = Number(this.btcAmount) || 0;
        trade.amount = Number(trade.amount) || 0;
        
        // Preparar datos de la operación
        trade.id = this.generateTradeId();
        trade.balanceAfter = this.balance;
        trade.btcAfter = this.btcAmount;
        trade.timestamp = new Date();
        
        // Guardar en base de datos
        await this.db.saveTrade(trade);
        this.trades.unshift(trade); // Añadir al principio del array
        
        // Calcular métricas de la venta (emparejar con compras previas)
        await this.calculateSellTradeMetrics(trade);
        
        // Actualizar estado del portfolio
        await this.saveToDatabase();
        
        // Reconstruir posiciones abiertas después del trade
        this.rebuildOpenPositionsFromTrades();
        
        console.log(`🔸 VENTA EJECUTADA: ${trade.amount.toFixed(8)} BTC por $${trade.usdAmount.toFixed(2)}`);
        console.log(`💰 Balance actual: $${this.balance.toFixed(2)}`);
        console.log(`₿ BTC restante: ${this.btcAmount.toFixed(8)}`);
        
        await this.db.addLog('info', `Venta ejecutada: ${trade.amount.toFixed(8)} BTC por $${trade.usdAmount.toFixed(2)}`, 'trading');
        
        return true;
    }

    // --- Shorts ---
    async executeShortOpen(trade) {
        // Venta en corto: acreditamos el efectivo de la venta (menos fee) y registramos posición
        // DB-level duplicate protection: comprobar si ya existe una posición SHORT abierta
        try {
            const existing = await this.db.getAllQuery(`
                SELECT t.position_id FROM trades t
                WHERE t.position_side = ? AND t.action = 'open' AND t.position_id IS NOT NULL
                AND NOT EXISTS (
                    SELECT 1 FROM trades c WHERE c.position_id = t.position_id AND c.action = 'close'
                )
                LIMIT 1
            `, ['short']);
            if (existing && existing.length > 0) {
                // DB reports an open SHORT; ensure in-memory state is synced before blocking
                try {
                    console.log('⚠️ DB indica SHORT abierto — recargando estado en memoria para confirmar...');
                    await this.loadFromDatabase();
                } catch (e) {
                    console.warn('⚠️ Error recargando desde DB durante verificación de duplicado SHORT:', e && e.message ? e.message : e);
                }

                // If after reload we still have an open SHORT, block the duplicate open.
                const inMemoryHasShort = Array.isArray(this.openPositions) && this.openPositions.some(p => p.side === 'short');
                if (inMemoryHasShort) {
                    const existingPos = this.openPositions.find(p => p.side === 'short');
                    const smallThreshold = Number(process.env.SMALL_POSITION_USD || 100);
                    const posUsd = Number(existingPos?.entryUsd || (existingPos?.amountBtc || 0) * (existingPos?.entryPrice || trade.price || 0) || 0);
                    if (posUsd > 0 && posUsd < smallThreshold) {
                        console.log(`⚠️ Detectada posición SHORT pequeña (USD $${posUsd.toFixed(2)}) < threshold $${smallThreshold} — intentando cerrar antes de abrir nueva.`);
                        try {
                            const closeTrade = {
                                type: 'BUY',
                                amount: existingPos.amountBtc || 0,
                                price: trade.price || (await this.getCurrentBtcPrice()),
                                usdAmount: (existingPos.amountBtc || 0) * (trade.price || await this.getCurrentBtcPrice()),
                                fee: 0,
                                timestamp: new Date(),
                                confidence: 0,
                                reasons: ['AUTO_RECOVER_CLOSE_SMALL_SHORT'],
                                positionSide: 'short',
                                action: 'close'
                            };
                            const closedOk = await this.executeTrade(closeTrade);
                            if (closedOk) {
                                console.log('✅ Auto-cierre de posición SHORT pequeña completado, procediendo con apertura solicitada');
                                await this.db.addLog('info', `Auto-cierre de SHORT pequeño (${posUsd.toFixed(2)}) ejecutado para recuperar flujo de trading`, 'portfolio');
                            } else {
                                console.log('❌ Falló auto-cierre de posición SHORT pequeña — abortando apertura');
                                await this.db.addLog('warning', `Auto-cierre de SHORT pequeño falló (posUsd=${posUsd.toFixed(2)})`, 'portfolio');
                                return false;
                            }
                        } catch (e) {
                            console.warn('⚠️ Error intentando auto-cerrar SHORT pequeño:', e && e.message ? e.message : e);
                            return false;
                        }
                    }

                    const stillHasShort = Array.isArray(this.openPositions) && this.openPositions.some(p => p.side === 'short');
                    if (stillHasShort) {
                        console.log('⚠️ Ya existe una posición SHORT abierta en base de datos (confirmado en memoria). Omitiendo apertura duplicada.');
                        await this.db.addLog('warning', 'Intento de abrir SHORT duplicado detectado y bloqueado por DB check', 'portfolio');
                        return false;
                    }
                } else {
                    console.log('⚠️ Inconsistencia detectada: DB indica SHORT abierto pero memoria no lo refleja. Procediendo a abrir para recuperar estado.');
                    await this.db.addLog('warning', 'Inconsistencia DB vs memoria: DB reports open SHORT but memory did not — proceeding to open to reconcile', 'portfolio');
                }
            }
        } catch (err) {
            console.warn('⚠️ Error verificando posiciones abiertas en DB (proceeding):', err && err.message ? err.message : err);
            // Si la comprobación falla, no bloqueamos la apertura; continuar para evitar bloqueo accidental
        }

        // Diagnostic: snapshot requested USD and balance before any adjustment
        const requestedUsdOrigShort = Number(trade.usdAmount || 0);
        const balanceSnapshotShort = Number(this.balance || 0);
        try {
            console.log(`📣 executeShortOpen invoked: balanceBefore=$${balanceSnapshotShort.toFixed(2)}, requestedUsd=$${requestedUsdOrigShort.toFixed(2)}, tradeId=${trade.id || 'n/a'}, positionId=${trade.positionId || 'n/a'}`);
            if (this.db && typeof this.db.addLog === 'function') {
                await this.db.addLog('debug', `executeShortOpen: balanceBefore=${balanceSnapshotShort.toFixed(2)}, requestedUsd=${requestedUsdOrigShort.toFixed(2)}, positionId=${trade.positionId||'n/a'}`,'portfolio');
            }
        } catch(err) { /* best-effort logging */ }

        // Nuevo comportamiento: la apertura de SHORT consume fondos disponibles (no acredita dinero)
        // Se requiere disponer de usdAmount + fee en balance
        trade.amount = Number(trade.amount) || 0;
        trade.usdAmount = Number(trade.usdAmount) || 0;
        const feeAmount = Number(trade.fee || 0);

        // Enforce: clamp requested usdAmount to available balance (portfolio-side enforcement)
        try {
            if (!trade.forceSimple) {
                const available = Number(this.balance || 0);
                if (trade.usdAmount + feeAmount > available) {
                    const prev = trade.usdAmount + feeAmount;
                    // reduce usdAmount so totalCost == available (or slightly less to avoid zero)
                    trade.usdAmount = Math.max(0, available - feeAmount);
                    trade.amount = trade.price > 0 ? Number(trade.usdAmount) / Number(trade.price) : 0;
                    const msg = `⚠️ Ajustado usdAmount para OPEN SHORT: antes=${prev.toFixed(2)}, ahora=${(trade.usdAmount+feeAmount).toFixed(2)} (usdAmount=${trade.usdAmount.toFixed(2)}, fee=${feeAmount.toFixed(2)})`;
                    console.log(msg);
                    try { await this.db.addLog('warning', msg, 'portfolio'); } catch(e) {}
                }
            }
        } catch (e) {
            console.warn('⚠️ Error calculando clamp de usdAmount para short:', e && e.message ? e.message : e);
        }

        // Audit the attempt (requested vs final)
        try {
            if (this.db && typeof this.db.addTradeAudit === 'function') {
                await this.db.addTradeAudit({ tradeId: trade.id || null, requestedUsd: requestedUsdOrigShort, finalUsd: trade.usdAmount, balanceSnapshot: balanceSnapshotShort, note: 'OPEN SHORT attempt' });
            }
        } catch (e) {}

        const totalCost = trade.usdAmount + feeAmount;
        if (!trade.forceSimple) {
            if (this.balance < totalCost || trade.usdAmount <= 0) {
                const msg = `Balance insuficiente o monto nulo para abrir short tras ajuste: $${this.balance.toFixed(2)} < $${totalCost.toFixed(2)}`;
                console.log('❌ ' + msg);
                await this.db.addLog('warning', msg, 'portfolio');
                return false;
            }
        }

        // Debitar el importe usado para la apertura (se considera reservado/consumido)
        // In forceSimple mode allow negative balance (simple behavior requested)
        this.balance -= totalCost;
        this.balance = Number(this.balance) || 0;

        // Crear posición short y almacenar entryUsd para cálculo de PnL a cierre
        const positionId = trade.positionId || `short_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
        const entryUsd = trade.usdAmount;
        const entryPrice = trade.price;
        this.openPositions.push({ id: positionId, side: 'short', amountBtc: trade.amount, entryPrice: entryPrice, entryUsd: entryUsd, stopLoss: trade.stopLoss || null, takeProfit: trade.takeProfit || null, timestamp: new Date() });

        // Preparar y guardar trade
        trade.id = this.generateTradeId();
        trade.positionId = positionId;
        trade.position_side = trade.positionSide || 'short';
        trade.entryPrice = entryPrice;
        trade.exitPrice = 0;
        trade.balanceAfter = this.balance;
        trade.btcAfter = this.btcAmount; // no cambia BTC spot
        await this.db.saveTrade(trade);
        this.trades.unshift(trade);

        await this.saveToDatabase();
        
        // Reconstruir posiciones abiertas después del trade
        this.rebuildOpenPositionsFromTrades();

        await this.db.addLog('info', `Apertura SHORT (consumido): ${trade.amount.toFixed(8)} BTC a $${trade.price.toFixed(2)} (usdLocked=${entryUsd})`, 'trading');
        return true;
    }

    async executeShortClose(trade) {
        // Cierre de short: gastamos efectivo para recomprar BTC
        // Buscar posición short abierta
        const posIndex = this.openPositions.findIndex(p => p.side === 'short' && (trade.positionId ? p.id === trade.positionId : true));
        if (posIndex === -1) {
            const message = 'No hay posición SHORT abierta para cerrar (memoria)';
            console.log('❌ ' + message);
            await this.db.addLog('warning', message, 'portfolio');
            return false;
        }
        const pos = this.openPositions[posIndex];

        // DB-level check: asegurar que la posición todavía tiene un open sin close en la base de datos.
        // Esto evita cierres duplicados que reduzcan el balance dos veces.
        try {
            const existing = await this.db.getAllQuery(`
                SELECT t.position_id FROM trades t
                WHERE t.position_id = ? AND t.position_side = ? AND t.action = 'open'
                AND NOT EXISTS (
                    SELECT 1 FROM trades c WHERE c.position_id = t.position_id AND c.action = 'close'
                )
                LIMIT 1
            `, [pos.id, 'short']);
            if (!existing || existing.length === 0) {
                const message = `Posición SHORT ${pos.id} ya fue cerrada en DB - evitando cierre duplicado`;
                console.log('⚠️ ' + message);
                await this.db.addLog('warning', message, 'portfolio');
                // Asegurar que la posición local también se elimine para mantener consistencia
                this.openPositions.splice(posIndex, 1);
                return false;
            }
        } catch (err) {
            console.warn('⚠️ Error verificando estado de posición en DB (proceeding):', err && err.message ? err.message : err);
            // Si la comprobación falla, continuar con cuidado (no asumimos duplicado)
        }

        // El coste real para recomprar BTC (incluye fee de cierre)
        const exitPrice = trade.price;
        const costToBuyBack = (pos.amountBtc || 0) * exitPrice;
        const feeClose = Number(trade.fee || 0);
        const cost = Number(costToBuyBack || 0) + feeClose;

        // entryUsd fue consumido al abrir; consideramos que el disponible para cerrar
        // es el balance en memoria más el entryUsd reservado para la posición.
        const entryUsd = Number(pos.entryUsd || (pos.amountBtc * pos.entryPrice)) || 0;
        const availableForClose = Number(this.balance || 0) + entryUsd;

        // Log diagnóstico mínimo para ayudar a depurar diferencias pequeñas
        console.log(`📣 executeShortClose: balance=${this.balance.toFixed(2)}, entryUsd=${entryUsd.toFixed(2)}, availableForClose=${availableForClose.toFixed(2)}, costToBuyBack=${costToBuyBack.toFixed(2)}, feeClose=${feeClose.toFixed(2)}, totalCost=${cost.toFixed(2)}, posId=${pos.id}`);
        try { await this.db.addLog('debug', `executeShortClose: balance=${this.balance.toFixed(2)}, entryUsd=${entryUsd.toFixed(2)}, availableForClose=${availableForClose.toFixed(2)}, totalCost=${cost.toFixed(2)}, posId=${pos.id}`,'portfolio'); } catch(e) {}

        if (availableForClose < cost) {
            // Diagnostic: include more context to help debug why availableForClose is low
            const totalValueAtExit = this.getTotalValue(exitPrice);
            const diagnostic = {
                balance: Number(this.balance || 0),
                entryUsd: Number(entryUsd || 0),
                availableForClose: Number(availableForClose || 0),
                costToBuyBack: Number(costToBuyBack || 0),
                feeClose: Number(feeClose || 0),
                totalCost: Number(cost || 0),
                totalValueAtExit: Number(totalValueAtExit || 0),
                btcAmount: Number(this.btcAmount || 0),
                openPositionsCount: this.openPositions.length
            };
            const message = `Balance insuficiente para cerrar short: disponible=$${availableForClose.toFixed(2)} < costo_total=$${cost.toFixed(2)}`;
            console.log('❌ ' + message);
            console.log('⚠️ Diagnostic snapshot for insufficient-close:', diagnostic);
            try { await this.db.addLog('warning', `${message} | diagnostic=${JSON.stringify(diagnostic)}`, 'portfolio'); } catch(e) {}
            // If running in SIMPLE MODE (test/forced behavior), allow the close anyway
            if (this.simpleMode || trade.forceSimple) {
                const fm = `⚠️ SIMPLE MODE / forceSimple: forzando cierre SHORT ${pos.id} aunque available=${availableForClose.toFixed(2)} < cost=${cost.toFixed(2)}`;
                console.warn(fm);
                try { await this.db.addLog('warning', fm, 'portfolio'); } catch(e) {}
                // proceed with closure ignoring shortfall (balance may become negative)
            } else {
                // Optional auto-liquidation: if enabled, attempt to free USD by selling available long BTC
                try {
                    const autoFlag = process.env.AUTO_LIQUIDATE_ON_SHORT_CLOSE === '1';
                    if (autoFlag) {
                        const neededUsd = Math.max(0, cost - availableForClose);
                        const neededBtc = exitPrice > 0 ? (neededUsd / exitPrice) : 0;
                        if (neededBtc > 0 && (this.btcAmount || 0) >= neededBtc) {
                            // Perform a lightweight liquidation: reduce btcAmount and add cash
                            const liquidUsd = Number((neededBtc * exitPrice));
                            this.btcAmount = Number(this.btcAmount) - Number(neededBtc);
                            this.balance = Number(this.balance) + Number(liquidUsd);
                            try {
                                await this.db.addLog('info', `Auto-liquidación: vendiendo ${neededBtc.toFixed(8)} BTC por $${liquidUsd.toFixed(2)} para cubrir cierre SHORT ${pos.id}`, 'portfolio');
                                const synth = {
                                    id: this.generateTradeId(),
                                    trade_id: this.generateTradeId(),
                                    type: 'SELL',
                                    amount: neededBtc,
                                    price: exitPrice,
                                    usd_amount: liquidUsd,
                                    fee: 0,
                                    timestamp: new Date(),
                                    confidence: 0,
                                    reasons: ['AUTO_LIQUIDATION_FOR_SHORT_CLOSE'],
                                    balance_after: this.balance,
                                    btc_after: this.btcAmount,
                                    status: 'completed',
                                    created_at: (new Date()).toISOString(),
                                    entry_price: 0,
                                    exit_price: exitPrice,
                                    gain_loss: null,
                                    roi: null,
                                    related_trade_id: null,
                                    position_side: 'long',
                                    position_id: null,
                                    action: 'auto_liquidation'
                                };
                                if (this.db && typeof this.db.saveTrade === 'function') {
                                    await this.db.saveTrade(synth);
                                    this.trades.unshift(synth);
                                }
                            } catch (e) {
                                console.warn('⚠️ Error registrando auto-liquidación:', e && e.message ? e.message : e);
                            }

                            const newEntryUsd = Number(pos.entryUsd || 0);
                            const newAvailable = Number(this.balance || 0) + newEntryUsd;
                            if (newAvailable >= cost) {
                                await this.db.addLog('info', `Auto-liquidación completada, available=${newAvailable.toFixed(2)} >= cost=${cost.toFixed(2)}. Procediendo con cierre SHORT ${pos.id}`, 'portfolio');
                            } else {
                                const msg2 = `Auto-liquidación insuficiente: available=${newAvailable.toFixed(2)} < cost=${cost.toFixed(2)}`;
                                console.log('❌ ' + msg2);
                                await this.db.addLog('warning', msg2, 'portfolio');
                                return false;
                            }
                        } else {
                            await this.db.addLog('warning', `AUTO_LIQUIDATE requested but insufficient BTC to liquidate (have ${this.btcAmount || 0}, need ${neededBtc})`, 'portfolio');
                            return false;
                        }
                    }
                } catch (e) {
                    console.warn('⚠️ Error evaluating auto-liquidation:', e && e.message ? e.message : e);
                }

                // If auto-liquidation not enabled or failed, abort
                return false;
            }
        }

        // Actualizar balance en un solo paso para evitar doble contabilidad:
        // El balance en memoria ya tenía entryUsd sustraído en la apertura; al cerrar
        // devolvemos entryUsd y gastamos el coste de recompra + fee de cierre.
        // Resultado: balance_final = balance_actual + entryUsd - costToBuyBack - feeClose
        this.balance = Number(this.balance || 0) + entryUsd - costToBuyBack - feeClose;
        this.balance = Number(this.balance) || 0;

        // Calcular PnL y ROI
        const pnl = entryUsd - costToBuyBack - feeClose;
        const roi = entryUsd > 0 ? ((entryUsd - costToBuyBack) / entryUsd) * 100 : 0;

        // Guardar trade de cierre
        trade.id = this.generateTradeId();
        trade.entryPrice = pos.entryPrice;
        trade.exitPrice = exitPrice;
        trade.gainLoss = pnl;
        trade.roi = roi;
        trade.positionId = pos.id;
        trade.balanceAfter = this.balance;
        trade.btcAfter = this.btcAmount;
        await this.db.saveTrade(trade);
        this.trades.unshift(trade);

    // Eliminar posición short abierta
    this.openPositions.splice(posIndex, 1);

    await this.saveToDatabase();
        
    // Reconstruir posiciones abiertas después del trade
    this.rebuildOpenPositionsFromTrades();
        
    const glText = trade.gainLoss >= 0 ? `ganancia de $${trade.gainLoss.toFixed(2)} (+${roi.toFixed(2)}%)` : `pérdida de $${Math.abs(trade.gainLoss).toFixed(2)} (${roi.toFixed(2)}%)`;
    await this.db.addLog('info', `Cierre SHORT: ${pos.amountBtc.toFixed(8)} BTC - ${glText}`, 'trading');
    return true;
    }

    // --- Longs ---
    async executeLongOpen(trade) {
        // Apertura de long: acreditamos BTC y debitamos efectivo
        // DB-level duplicate protection: comprobar si ya existe una posición LONG abierta
        try {
            const existing = await this.db.getAllQuery(`
                SELECT t.position_id FROM trades t
                WHERE t.position_side = ? AND t.action = 'open' AND t.position_id IS NOT NULL
                AND NOT EXISTS (
                    SELECT 1 FROM trades c WHERE c.position_id = t.position_id AND c.action = 'close'
                )
                LIMIT 1
            `, ['long']);
            if (existing && existing.length > 0) {
                // DB reports an open LONG; ensure in-memory state is synced before blocking
                try {
                    console.log('⚠️ DB indica LONG abierto — recargando estado en memoria para confirmar...');
                    await this.loadFromDatabase();
                } catch (e) {
                    console.warn('⚠️ Error recargando desde DB durante verificación de duplicado LONG:', e && e.message ? e.message : e);
                }

                // If after reload we still have an open LONG, block the duplicate open.
                const inMemoryHasLong = Array.isArray(this.openPositions) && this.openPositions.some(p => p.side === 'long');
                if (inMemoryHasLong) {
                    // If there's an open LONG in memory, decide if it's a tiny/stale position we should auto-close to recover.
                    const existingPos = this.openPositions.find(p => p.side === 'long');
                    const smallThreshold = Number(process.env.SMALL_POSITION_USD || 100);
                    const posUsd = Number(existingPos?.entryUsd || (existingPos?.amountBtc || 0) * (existingPos?.entryPrice || trade.price || 0) || 0);
                    if (posUsd > 0 && posUsd < smallThreshold) {
                        console.log(`⚠️ Detectada posición LONG pequeña (USD $${posUsd.toFixed(2)}) < threshold $${smallThreshold} — intentando cerrar antes de abrir nueva.`);
                        try {
                            // Build a close trade and execute
                            const closeTrade = {
                                type: 'SELL',
                                amount: existingPos.amountBtc || 0,
                                price: trade.price || (await this.getCurrentBtcPrice()),
                                usdAmount: (existingPos.amountBtc || 0) * (trade.price || await this.getCurrentBtcPrice()),
                                fee: 0,
                                timestamp: new Date(),
                                confidence: 0,
                                reasons: ['AUTO_RECOVER_CLOSE_SMALL_LONG'],
                                positionSide: 'long',
                                action: 'close'
                            };
                            const closedOk = await this.executeTrade(closeTrade);
                            if (closedOk) {
                                console.log('✅ Auto-cierre de posición LONG pequeña completado, procediendo con apertura solicitada');
                                await this.db.addLog('info', `Auto-cierre de LONG pequeño (${posUsd.toFixed(2)}) ejecutado para recuperar flujo de trading`, 'portfolio');
                                // continue to allow opening
                            } else {
                                console.log('❌ Falló auto-cierre de posición LONG pequeña — abortando apertura');
                                await this.db.addLog('warning', `Auto-cierre de LONG pequeño falló (posUsd=${posUsd.toFixed(2)})`, 'portfolio');
                                return false;
                            }
                        } catch (e) {
                            console.warn('⚠️ Error intentando auto-cerrar LONG pequeño:', e && e.message ? e.message : e);
                            return false;
                        }
                    }

                    // If not small (or after successful auto-close) still exists, block duplicate
                    const stillHasLong = Array.isArray(this.openPositions) && this.openPositions.some(p => p.side === 'long');
                    if (stillHasLong) {
                        console.log('⚠️ Ya existe una posición LONG abierta en base de datos (confirmado en memoria). Omitiendo apertura duplicada.');
                        await this.db.addLog('warning', 'Intento de abrir LONG duplicado detectado y bloqueado por DB check', 'portfolio');
                        return false;
                    }
                } else {
                    // Inconsistencia DB vs memoria: log and proceed with opening to recover (DB may contain stale record)
                    console.log('⚠️ Inconsistencia detectada: DB indica LONG abierto pero memoria no lo refleja. Procediendo a abrir para recuperar estado.');
                    await this.db.addLog('warning', 'Inconsistencia DB vs memoria: DB reports open LONG but memory did not — proceeding to open to reconcile', 'portfolio');
                }
            }
        } catch (err) {
            console.warn('⚠️ Error verificando posiciones abiertas en DB (proceeding):', err && err.message ? err.message : err);
            // Si la comprobación falla, no bloqueamos la apertura; continuar para evitar bloqueo accidental
        }

        // Diagnostic: snapshot requested USD and balance before any adjustment
        const requestedUsdOrigLong = Number(trade.usdAmount || 0);
        const balanceSnapshotLong = Number(this.balance || 0);
        try {
            console.log(`📣 executeLongOpen invoked: balanceBefore=$${balanceSnapshotLong.toFixed(2)}, requestedUsd=$${requestedUsdOrigLong.toFixed(2)}, tradeId=${trade.id || 'n/a'}, positionId=${trade.positionId || 'n/a'}`);
            if (this.db && typeof this.db.addLog === 'function') {
                await this.db.addLog('debug', `executeLongOpen: balanceBefore=${balanceSnapshotLong.toFixed(2)}, requestedUsd=${requestedUsdOrigLong.toFixed(2)}, positionId=${trade.positionId||'n/a'}`,'portfolio');
            }
        } catch(err) { /* best-effort logging */ }

        const feeAmount = Number(trade.fee || 0);

        // Enforce: clamp requested usdAmount to available balance (portfolio-side enforcement)
        try {
            trade.usdAmount = Number(trade.usdAmount) || 0;
            trade.amount = Number(trade.amount) || 0;
            if (!trade.forceSimple) {
                const available = Number(this.balance || 0);
                if (trade.usdAmount + feeAmount > available) {
                    const prev = trade.usdAmount + feeAmount;
                    trade.usdAmount = Math.max(0, available - feeAmount);
                    trade.amount = trade.price > 0 ? Number(trade.usdAmount) / Number(trade.price) : 0;
                    const msg = `⚠️ Ajustado usdAmount para OPEN LONG: antes=${prev.toFixed(2)}, ahora=${(trade.usdAmount+feeAmount).toFixed(2)} (usdAmount=${trade.usdAmount.toFixed(2)}, fee=${feeAmount.toFixed(2)})`;
                    console.log(msg);
                    try { await this.db.addLog('warning', msg, 'portfolio'); } catch(e) {}
                }
            }
        } catch (e) {
            console.warn('⚠️ Error calculando clamp de usdAmount para long:', e && e.message ? e.message : e);
        }

            // Audit the attempt (requested vs final)
            try {
                if (this.db && typeof this.db.addTradeAudit === 'function') {
                    await this.db.addTradeAudit({ tradeId: trade.id || null, requestedUsd: requestedUsdOrigLong, finalUsd: trade.usdAmount, balanceSnapshot: balanceSnapshotLong, note: 'OPEN LONG attempt' });
                }
            } catch (e) {}

        const totalCost = trade.usdAmount + feeAmount;

        // Verificar si tenemos suficiente balance después del ajuste (o forzar apertura en SIMPLE MODE)
        if (!trade.forceSimple) {
            if (this.balance < totalCost || trade.usdAmount <= 0) {
                const message = `Balance insuficiente para abrir long tras ajuste: $${this.balance.toFixed(2)} < $${totalCost.toFixed(2)}`;
                console.log('❌ ' + message);
                await this.db.addLog('warning', message, 'portfolio');
                return false;
            }
        }

        // Debitar el importe usado para la apertura (se considera reservado/consumido)
        // En SIMPLE MODE permitimos balance negativo para forzar reinversión
        this.balance -= totalCost;
        this.btcAmount += trade.amount;

        // Ensure amounts are valid numbers
        this.balance = Number(this.balance) || 0;
        this.btcAmount = Number(this.btcAmount) || 0;
        trade.amount = Number(trade.amount) || 0;

        // Crear posición long abierta
        const positionId = trade.positionId || `long_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
    this.openPositions.push({ id: positionId, side: 'long', amountBtc: trade.amount, entryPrice: trade.price, stopLoss: trade.stopLoss || null, takeProfit: trade.takeProfit || null, timestamp: new Date() });

        // Preparar y guardar trade
        trade.id = this.generateTradeId();
        trade.positionId = positionId;
    // Asegurar que el campo position_side exista en el objeto trade para que la inserción en BD
    // y la reconstrucción detecten correctamente las posiciones LONG.
    trade.position_side = trade.positionSide || 'long';
        trade.entryPrice = trade.price;
        trade.exitPrice = 0;
        trade.balanceAfter = this.balance;
        trade.btcAfter = this.btcAmount;
        await this.db.saveTrade(trade);
        this.trades.unshift(trade);

        await this.saveToDatabase();
        
        // Reconstruir posiciones abiertas después del trade
        this.rebuildOpenPositionsFromTrades();
        
        await this.db.addLog('info', `Apertura LONG: ${trade.amount.toFixed(8)} BTC a $${trade.price.toFixed(2)}`, 'trading');
        return true;
    }

    async executeLongClose(trade) {
        // Cierre de long: vendemos BTC y acreditamos efectivo
        // Buscar posición long abierta
        const posIndex = this.openPositions.findIndex(p => p.side === 'long' && (trade.positionId ? p.id === trade.positionId : true));
        if (posIndex === -1) {
            const message = 'No hay posición LONG abierta para cerrar';
            console.log('❌ ' + message);
            await this.db.addLog('warning', message, 'portfolio');
            return false;
        }
        const pos = this.openPositions[posIndex];

        // Verificar si tenemos suficiente BTC
        if (this.btcAmount < pos.amountBtc) {
            const message = `BTC insuficiente para cerrar long: ${this.btcAmount.toFixed(8)} < ${pos.amountBtc.toFixed(8)}`;
            console.log('❌ ' + message);
            await this.db.addLog('warning', message, 'portfolio');
            return false;
        }

        const netAmount = trade.usdAmount - trade.fee;
        this.btcAmount -= pos.amountBtc;
        this.balance += netAmount;

        // Ensure amounts are valid numbers
        this.balance = Number(this.balance) || 0;
        this.btcAmount = Number(this.btcAmount) || 0;
        trade.amount = Number(trade.amount) || 0;
        trade.usdAmount = Number(trade.usdAmount) || 0;

        // Calcular PnL del long
        const entry = pos.entryPrice;
        const exit = trade.price;
        const pnl = (exit - entry) * pos.amountBtc - trade.fee;
        const roi = entry > 0 ? ((exit - entry) / entry) * 100 : 0;

        // Guardar trade de cierre
        trade.id = this.generateTradeId();
        trade.entryPrice = entry;
        trade.exitPrice = exit;
        trade.gainLoss = pnl;
        trade.roi = roi;
        trade.positionId = pos.id;
        trade.balanceAfter = this.balance;
        trade.btcAfter = this.btcAmount;
        await this.db.saveTrade(trade);
        this.trades.unshift(trade);

        // Eliminar posición long abierta
        this.openPositions.splice(posIndex, 1);

        await this.saveToDatabase();
        
        // Reconstruir posiciones abiertas después del trade
        this.rebuildOpenPositionsFromTrades();
        
        const glText = pnl >= 0 ? `ganancia de $${pnl.toFixed(2)} (+${roi.toFixed(2)}%)` : `pérdida de $${Math.abs(pnl).toFixed(2)} (${roi.toFixed(2)}%)`;
        await this.db.addLog('info', `Cierre LONG: ${pos.amountBtc.toFixed(8)} BTC - ${glText}`, 'trading');
        return true;
    }

    // Calcular métricas para una venta (emparejar con compras previas)
    async calculateSellTradeMetrics(sellTrade) {
        try {
            // Obtener compras pendientes (ordenadas por fecha, FIFO)
            const buyTrades = await this.db.getAllQuery(`
                SELECT * FROM trades 
                WHERE type = 'BUY' 
                AND (exit_price = 0 OR exit_price IS NULL)
                ORDER BY timestamp ASC
            `);
            
            if (buyTrades.length === 0) {
                // No hay compras para emparejar, usar precio actual como entry_price estimado
                await this.db.runQuery(
                    "UPDATE trades SET entry_price = ?, exit_price = ?, gain_loss = 0, roi = 0 WHERE trade_id = ?",
                    [sellTrade.price, sellTrade.price, sellTrade.id]
                );
                return;
            }
            
            let sellAmount = sellTrade.amount;
            let totalGainLoss = 0;
            let weightedEntryPrice = 0;
            let relatedTradeId = buyTrades[0].trade_id;
            
            // Emparejar con compras (FIFO)
            for (const buyTrade of buyTrades) {
                if (sellAmount <= 0) break;
                
                const buyAmount = buyTrade.amount;
                const matchAmount = Math.min(sellAmount, buyAmount);
                const entryPrice = buyTrade.price;
                const exitPrice = sellTrade.price;
                
                // Calcular ganancia/pérdida para esta porción
                const grossProfit = (exitPrice - entryPrice) * matchAmount;
                const feesPortion = sellTrade.fee * (matchAmount / sellTrade.amount);
                const netGainLoss = grossProfit - feesPortion;
                
                totalGainLoss += netGainLoss;
                weightedEntryPrice += entryPrice * matchAmount;
                sellAmount -= matchAmount;
                
                // Marcar la compra como parcial o completamente vendida
                if (matchAmount === buyAmount) {
                    // Compra completamente vendida
                    await this.db.runQuery(
                        "UPDATE trades SET exit_price = ? WHERE trade_id = ?",
                        [exitPrice, buyTrade.trade_id]
                    );
                } else {
                    // Compra parcialmente vendida - necesitaríamos dividir la operación
                    // Por simplicidad, marcaremos como vendida completamente
                    await this.db.runQuery(
                        "UPDATE trades SET exit_price = ? WHERE trade_id = ?",
                        [exitPrice, buyTrade.trade_id]
                    );
                }
            }
            
            // Calcular métricas promedio para la venta
            const avgEntryPrice = weightedEntryPrice / sellTrade.amount;
            const totalRoi = ((sellTrade.price - avgEntryPrice) / avgEntryPrice) * 100;
            
            // Actualizar la venta con las métricas calculadas
            await this.db.runQuery(`
                UPDATE trades 
                SET entry_price = ?, exit_price = ?, gain_loss = ?, roi = ?, related_trade_id = ? 
                WHERE trade_id = ?
            `, [avgEntryPrice, sellTrade.price, totalGainLoss, totalRoi, relatedTradeId, sellTrade.id]);
            
            // Log mejorado con ganancia/pérdida
            const gainLossText = totalGainLoss >= 0 ? 
                `ganancia de $${totalGainLoss.toFixed(2)} (+${totalRoi.toFixed(2)}%)` : 
                `pérdida de $${Math.abs(totalGainLoss).toFixed(2)} (${totalRoi.toFixed(2)}%)`;
                
            await this.db.addLog('info', 
                `Venta completada: ${sellTrade.amount.toFixed(8)} BTC - ${gainLossText} - Precio entrada: $${avgEntryPrice.toFixed(2)} → Precio salida: $${sellTrade.price.toFixed(2)}`, 
                'trading'
            );
            
        } catch (error) {
            console.error('Error calculando métricas de venta:', error);
        }
    }

    // Generar ID único para operación
    generateTradeId() {
        return `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Obtener valor total del portafolio
    getTotalValue(currentBtcPrice = 0) {
        // Nuevo cálculo: el valor total se considera como el capital inicial más PnL realizado y no realizado
        // Esto evita que la apertura de un SHORT (que acredita efectivo) haga subir artificialmente el "totalValue".
        const realized = this.calculateRealizedPnL();
        const unrealized = this.getUnrealizedPnL(currentBtcPrice);

        const totalValue = (Number(this.initialBalance) || 0) + (Number(realized) || 0) + (Number(unrealized) || 0);
        return totalValue;
    }

    // Obtener rendimiento total
    getTotalReturn(currentBtcPrice = 0) {
        const currentValue = this.getTotalValue(currentBtcPrice);
        return ((currentValue - this.initialBalance) / this.initialBalance) * 100;
    }

    // Obtener PnL no realizado
    getUnrealizedPnL(currentBtcPrice) {
        let unrealized = 0;

        // Sumar PnL de posiciones abiertas (longs y shorts)
        if (this.openPositions && this.openPositions.length > 0) {
            for (const position of this.openPositions) {
                if (!position.entryPrice || !position.amountBtc) continue;
                const entry = Number(position.entryPrice) || 0;
                const amt = Number(position.amountBtc) || 0;
                if (position.side === 'long') {
                    unrealized += (currentBtcPrice - entry) * amt;
                } else if (position.side === 'short') {
                    unrealized += (entry - currentBtcPrice) * amt;
                }
            }
        } else {
            // Fallback: si no hay openPositions pero hay BTC spot (legacy), calcular PnL sobre el BTC spot
            if (this.btcAmount && this.btcAmount > 0) {
                const buyTrades = this.trades.filter(t => t.type === 'BUY');
                if (buyTrades.length > 0) {
                    let totalCost = 0;
                    let totalAmount = 0;
                    for (const trade of buyTrades) {
                        totalCost += Number(trade.usdAmount || trade.usd_amount || 0);
                        totalAmount += Number(trade.amount || 0);
                    }
                    const avgBuyPrice = totalAmount > 0 ? totalCost / totalAmount : 0;
                    unrealized += (currentBtcPrice - avgBuyPrice) * this.btcAmount;
                }
            }
        }

        return unrealized;
    }

    // Calcular PnL realizado
    calculateRealizedPnL() {
        let realizedPnL = 0;
        const sellTrades = this.trades.filter(t => t.type === 'SELL');
        
        for (const sell of sellTrades) {
            // Buscar compras correspondientes (FIFO)
            const buyTrades = this.trades.filter(t => 
                t.type === 'BUY' && 
                new Date(t.timestamp) < new Date(sell.timestamp)
            );
            
            if (buyTrades.length > 0) {
                const avgBuyPrice = buyTrades.reduce((sum, trade) => sum + (trade.price * trade.amount), 0) / 
                                 buyTrades.reduce((sum, trade) => sum + trade.amount, 0);
                
                realizedPnL += (sell.price - avgBuyPrice) * sell.amount;
            }
        }
        
        return realizedPnL;
    }

    // Calcular total de comisiones
    calculateTotalFees() {
        return this.trades.reduce((total, trade) => total + (trade.fee || 0), 0);
    }

    // Calcular máximo drawdown
    async calculateMaxDrawdown(currentBtcPrice) {
        try {
            const trades = await this.db.getTrades(1000); // Obtener más historial
            if (trades.length === 0) return 0;

            let peak = this.initialBalance;
            let maxDrawdown = 0;

            for (const trade of trades.reverse()) { // Cronológico
                const portfolioValue = trade.balance_after + (trade.btc_after * currentBtcPrice);
                
                if (portfolioValue > peak) {
                    peak = portfolioValue;
                }
                
                const drawdown = ((peak - portfolioValue) / peak) * 100;
                if (drawdown > maxDrawdown) {
                    maxDrawdown = drawdown;
                }
            }

            return maxDrawdown;
        } catch (error) {
            console.error('Error calculando drawdown:', error);
            return 0;
        }
    }

    // Calcular ratio de Sharpe
    async calculateSharpeRatio() {
        try {
            const trades = await this.db.getTrades(100);
            if (trades.length < 2) return 0;

            const returns = [];
            for (let i = 1; i < trades.length; i++) {
                const prev = trades[i];
                const curr = trades[i - 1];
                const prevValue = prev.balance_after + prev.btc_after * prev.price;
                const currValue = curr.balance_after + curr.btc_after * curr.price;
                const return_ = (currValue - prevValue) / prevValue;
                returns.push(return_);
            }

            const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
            const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
            const stdDev = Math.sqrt(variance);

            return stdDev === 0 ? 0 : (avgReturn / stdDev) * Math.sqrt(252); // Anualizado
        } catch (error) {
            console.error('Error calculando Sharpe ratio:', error);
            return 0;
        }
    }

    // Obtener precio actual de BTC (simulado)
    async getCurrentBtcPrice() {
        try {
            // En un entorno real, esto vendría de la API
            const marketData = require('./marketData');
            const data = await marketData.getMarketData();
            return data.price;
        } catch (error) {
            return 50000; // Precio por defecto
        }
    }

    // Obtener estadísticas del portfolio
    async getPortfolioStats(currentBtcPrice) {
        try {
            if (!this.isInitialized || !this.db) {
                console.warn('Portfolio no inicializado, retornando stats básicas');
                const currentValue = this.getTotalValue(currentBtcPrice);
                return {
                    balance: this.balance,
                    btcAmount: this.btcAmount,
                    totalValue: currentValue,
                    totalReturn: this.getTotalReturn(currentBtcPrice),
                    totalTrades: this.trades.length,
                    performance: {
                        initial: this.initialBalance,
                        current: currentValue,
                        change: currentValue - this.initialBalance,
                        changePercent: this.getTotalReturn(currentBtcPrice)
                    }
                };
            }
            
            const stats = await this.db.getTradeStatistics();
            const currentValue = this.getTotalValue(currentBtcPrice);
            
            return {
                balance: this.balance,
                btcAmount: this.btcAmount,
                totalValue: currentValue,
                totalReturn: this.getTotalReturn(currentBtcPrice),
                realizedPnL: this.calculateRealizedPnL(),
                unrealizedPnL: this.getUnrealizedPnL(currentBtcPrice),
                totalFees: this.calculateTotalFees(),
                maxDrawdown: await this.calculateMaxDrawdown(currentBtcPrice),
                sharpeRatio: await this.calculateSharpeRatio(),
                totalTrades: stats?.total_trades || 0,
                buyTrades: stats?.buy_trades || 0,
                sellTrades: stats?.sell_trades || 0,
                avgConfidence: stats?.avg_confidence || 0,
                // Nuevas métricas: operaciones ganadoras/perdedoras y tasa de éxito
                winningTrades: stats?.winning_trades || 0,
                losingTrades: stats?.losing_trades || 0,
                winRate: typeof stats?.win_rate === 'number' ? Number(stats.win_rate) : (stats?.win_rate || 0),
                grossWins: stats?.gross_wins || 0,
                grossLosses: stats?.gross_losses || 0,
                profitFactor: (stats && stats.gross_losses && Number(stats.gross_losses) > 0) ? (Number(stats.gross_wins || 0) / Number(stats.gross_losses || 0)) : null,
                startDate: this.startDate,
                performance: {
                    initial: this.initialBalance,
                    current: currentValue,
                    change: currentValue - this.initialBalance,
                    changePercent: this.getTotalReturn(currentBtcPrice)
                }
            };
        } catch (error) {
            console.error('Error obteniendo estadísticas:', error);
            return null;
        }
    }

    // Obtener historial de operaciones
    async getTradeHistory(limit = 50) {
        try {
            if (!this.isInitialized || !this.db) {
                console.warn('Portfolio no inicializado, retornando trades en memoria');
                return this.trades.slice(0, limit);
            }
            return await this.db.getTrades(limit);
        } catch (error) {
            console.error('Error obteniendo historial:', error);
            return this.trades.slice(0, limit) || [];
        }
    }

    // Resetear portafolio (solo para desarrollo/testing)
    async resetPortfolio() {
        try {
            console.log('🔄 RESET PORTFOLIO - Estado antes del reset:');
            console.log('  Balance:', this.balance);
            console.log('  BTC Amount:', this.btcAmount);
            console.log('  Open Positions count:', this.openPositions.length);
            console.log('  Trades count:', this.trades.length);
            
            // Limpiar datos persistidos (trades, logs, market data)
            try {
                if (this.db && this.db.clearTradesAndLogs) {
                    await this.db.clearTradesAndLogs();
                }
            } catch (dbError) {
                console.error('❌ Error limpiando BD:', dbError);
                throw dbError;
            }

            // Reset de estado en memoria
            try {
                this.initialBalance = 10000; // Forzar reset del balance inicial
                this.balance = this.initialBalance;
                this.btcAmount = 0;
                this.trades = [];
                this.openPositions = [];
                this.startDate = new Date();
                
                console.log('🔄 RESET PORTFOLIO - Después de limpiar memoria:');
                console.log('  Balance:', this.balance);
                console.log('  BTC Amount:', this.btcAmount);
                console.log('  Open Positions count:', this.openPositions.length);
                console.log('  Trades count:', this.trades.length);
            } catch (memError) {
                console.error('❌ Error reseteando memoria:', memError);
                throw memError;
            }
            
            // Asegurar que las posiciones abiertas estén vacías
            try {
                this.rebuildOpenPositionsFromTrades();
                
                console.log('🔄 RESET PORTFOLIO - Después de rebuild:');
                console.log('  Open Positions count:', this.openPositions.length);
            } catch (rebuildError) {
                console.error('❌ Error reconstruyendo posiciones:', rebuildError);
                throw rebuildError;
            }
            
            // Guardar nuevo estado en BD (portfolio_state)
            try {
                // Also ensure portfolio_state in DB is reset immediately to avoid race
                // with other server instances reading old values.
                if (this.db && typeof this.db.updatePortfolioState === 'function') {
                    // Use safe numeric conversion to preserve zeros and avoid accidental fallback
                    const safeNum = (v) => {
                        const n = Number(v);
                        return (typeof n === 'number' && !Number.isNaN(n) && Number.isFinite(n)) ? n : 0;
                    };

                    const resetState = {
                        balance: safeNum(this.balance),
                        btcAmount: safeNum(this.btcAmount),
                        initialBalance: safeNum(this.initialBalance) || 0,
                        totalValue: this.getTotalValue(0) || safeNum(this.initialBalance) || 0,
                        totalReturn: 0,
                        realizedPnL: 0,
                        unrealizedPnL: 0,
                        totalFees: 0,
                        maxDrawdown: 0,
                        sharpeRatio: 0
                    };

                    try {
                        await this.db.updatePortfolioState(resetState);
                        // Add a system log entry for the reset
                        if (typeof this.db.addLog === 'function') {
                            await this.db.addLog('warning', 'Portfolio RESET invoked: DB state replaced with initial values', 'portfolio');
                        }
                    } catch (innerDbErr) {
                        console.warn('⚠️ Warning: could not update portfolio_state directly during reset:', innerDbErr);
                    }
                }

                // Finally, run the usual saveToDatabase to recalc metrics (safe after DB row exists)
                await this.saveToDatabase();
                
                console.log('🔄 RESET PORTFOLIO - Estado final:');
                console.log('  Balance:', this.balance);
                console.log('  BTC Amount:', this.btcAmount);
                console.log('  Open Positions count:', this.openPositions.length);
                console.log('  Total Value:', this.getTotalValue(100000));
                
                console.log('🔄 Portfolio reseteado a estado inicial (posiciones despejadas)');
                // No añadir log aquí porque se limpia después - el log principal lo maneja el server
            } catch (saveError) {
                console.error('❌ Error guardando estado:', saveError);
                throw saveError;
            }
        } catch (error) {
            console.error('❌ Error crítico en resetPortfolio:', error);
            throw error;
        }
    }

    // Validar operación antes de ejecutar
    validateTrade(trade, currentBtcPrice) {
        const errors = [];
        
        if (!trade.type || !['BUY', 'SELL'].includes(trade.type)) {
            errors.push('Tipo de operación inválido');
        }
        
        if (!trade.amount || trade.amount <= 0) {
            errors.push('Cantidad debe ser mayor a 0');
        }
        
        if (!trade.price || trade.price <= 0) {
            errors.push('Precio debe ser mayor a 0');
        }
        
        if (trade.type === 'BUY') {
            const totalCost = trade.usdAmount + (trade.fee || 0);
            if (totalCost > this.balance) {
                errors.push('Balance insuficiente');
            }
        }
        
        if (trade.type === 'SELL') {
            if (trade.amount > this.btcAmount) {
                errors.push('BTC insuficiente');
            }
        }
        
        return errors;
    }

    // Cerrar conexión a base de datos
    async close() {
        if (this.db) {
            await this.db.close();
        }
    }
}

module.exports = Portfolio;