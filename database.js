const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs-extra');
const EventEmitter = require('events');
const { safeNum } = require('./lib/utils');

class DatabaseManager {
    constructor() {
            // Allow tests to override DB path via TEST_DB_PATH env var
            this.dbPath = process.env.TEST_DB_PATH ? path.resolve(process.env.TEST_DB_PATH) : path.join(__dirname, 'trading_simulator_agustin.db');
        this.db = null;
        this.isConnected = false;
        // Event emitter to notify about important DB events (trade saved, reset, etc.)
        this.events = new EventEmitter();
    }

    // Inicializar base de datos
    async initialize() {
        try {
            // Crear directorio de datos si no existe
            await fs.ensureDir(path.dirname(this.dbPath));
            
            // Conectar a la base de datos
            await new Promise((resolve, reject) => {
                this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
                    if (err) {
                        console.error('Error conectando a la base de datos:', err.message);
                        reject(err);
                        return;
                    }
                    console.log('📊 Conectado a SQLite database (read-write mode)');
                    this.isConnected = true;
                    resolve();
                });
            });

            // Limpiar datos antiguos al reiniciar (solo si se especifica RESET_DB=true)
            if (process.env.RESET_DB === 'true') {
                await this.resetDatabase();
            }
            
            // Crear tablas
            await this.createTables();
            
            // Migrar tabla trades si es necesario
            await this.migrateTradesTable();
            
            // Calcular métricas de trades existentes
            await this.calculateTradeMetrics();
            
            // Insertar configuración inicial si no existe
            await this.initializeDefaultConfig();
            
            console.log('✅ Base de datos inicializada correctamente');
            return true;
        } catch (error) {
            console.error('Error inicializando base de datos:', error);
            return false;
        }
    }

    // Limpiar base de datos al reiniciar (elimina todos los datos antiguos)
    async resetDatabase() {
        try {
            console.log('🧹 Limpiando base de datos al reiniciar...');
            
            // Eliminar datos de todas las tablas
            const tables = ['trades', 'portfolio_state', 'performance_metrics', 'bot_config', 'system_logs', 'market_data'];
            
            for (const table of tables) {
                await new Promise((resolve, reject) => {
                    this.db.run(`DELETE FROM ${table}`, (err) => {
                        if (err && !err.message.includes('no such table')) {
                            console.warn(`⚠️ Error limpiando tabla ${table}:`, err.message);
                        }
                        resolve();
                    });
                });
            }
            
            // Limpiar archivos de log
            const fs = require('fs-extra');
            const path = require('path');
            
            const logFiles = ['server.log', 'nohup.out'];
            for (const logFile of logFiles) {
                const logPath = path.join(__dirname, logFile);
                try {
                    await fs.remove(logPath);
                    // Recrear archivo vacío
                    await fs.writeFile(logPath, '');
                } catch (error) {
                    // Ignorar errores si el archivo no existe
                }
            }
            
            console.log('✅ Base de datos y logs limpiados');
        } catch (error) {
            console.error('Error limpiando base de datos:', error);
        }
    }

    // Crear tablas de la base de datos
    async createTables() {
        const tables = [
            // Tabla de operaciones
            `CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trade_id TEXT UNIQUE NOT NULL,
                type TEXT NOT NULL,
                amount REAL NOT NULL,
                price REAL NOT NULL,
                usd_amount REAL NOT NULL,
                fee REAL NOT NULL DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                confidence INTEGER DEFAULT 0,
                reasons TEXT,
                stop_loss REAL,
                take_profit REAL,
                balance_after REAL,
                btc_after REAL,
                status TEXT DEFAULT 'completed',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Tabla de configuración del bot
            `CREATE TABLE IF NOT EXISTS bot_config (
                id INTEGER PRIMARY KEY,
                max_position_size REAL DEFAULT 0.8,
                stop_loss REAL DEFAULT 0.05,
                stop_loss_usd REAL DEFAULT 100,
                take_profit REAL DEFAULT 0.10,
                min_confidence INTEGER DEFAULT 40,
                cooldown_period INTEGER DEFAULT 300000,
                risk_per_trade REAL DEFAULT 0.02,
                max_consecutive_losses INTEGER DEFAULT 3,
                is_active BOOLEAN DEFAULT 0,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Tabla de estado del portafolio
            `CREATE TABLE IF NOT EXISTS portfolio_state (
                id INTEGER PRIMARY KEY,
                balance REAL NOT NULL,
                btc_amount REAL DEFAULT 0,
                initial_balance REAL NOT NULL,
                total_value REAL NOT NULL,
                total_return REAL DEFAULT 0,
                realized_pnl REAL DEFAULT 0,
                unrealized_pnl REAL DEFAULT 0,
                total_fees REAL DEFAULT 0,
                max_drawdown REAL DEFAULT 0,
                sharpe_ratio REAL DEFAULT 0,
                start_date DATETIME,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Tabla de datos de mercado históricos
            `CREATE TABLE IF NOT EXISTS market_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                price REAL NOT NULL,
                change_24h REAL DEFAULT 0,
                volume_24h REAL DEFAULT 0,
                sma_20 REAL,
                sma_50 REAL,
                rsi REAL,
                macd REAL,
                ema_12 REAL,
                ema_26 REAL,
                bb_upper REAL,
                bb_lower REAL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Tabla de logs del sistema
            `CREATE TABLE IF NOT EXISTS system_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                level TEXT NOT NULL DEFAULT 'info',
                message TEXT NOT NULL,
                component TEXT DEFAULT 'system',
                data TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Tabla de métricas de performance
            `CREATE TABLE IF NOT EXISTS performance_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                total_trades INTEGER DEFAULT 0,
                winning_trades INTEGER DEFAULT 0,
                losing_trades INTEGER DEFAULT 0,
                win_rate REAL DEFAULT 0,
                avg_trade_duration INTEGER DEFAULT 0,
                best_trade REAL DEFAULT 0,
                worst_trade REAL DEFAULT 0,
                profit_factor REAL DEFAULT 0,
                calculated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
            ,
            // Tabla de auditoría de intentos de ejecución de trades (para post-mortems)
            `CREATE TABLE IF NOT EXISTS trade_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trade_id TEXT,
                requested_usd REAL,
                final_usd REAL,
                balance_snapshot REAL,
                note TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        // Crear índices para mejorar performance
        const indexes = [
            `CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp)`,
            `CREATE INDEX IF NOT EXISTS idx_trades_type ON trades(type)`,
            `CREATE INDEX IF NOT EXISTS idx_market_data_timestamp ON market_data(timestamp)`,
            `CREATE INDEX IF NOT EXISTS idx_system_logs_timestamp ON system_logs(timestamp)`,
            `CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level)`
        ];

        // Ejecutar creación de tablas
        for (const table of tables) {
            await this.runQuery(table);
        }

        // Crear índices
        for (const index of indexes) {
            await this.runQuery(index);
        }
    }

    // Inicializar configuración por defecto
    async initializeDefaultConfig() {
        const config = await this.getBotConfig();
        if (!config) {
            await this.runQuery(`
                INSERT INTO bot_config (id, max_position_size, stop_loss, stop_loss_usd, take_profit, 
                    min_confidence, cooldown_period, risk_per_trade, max_consecutive_losses, is_active)
                VALUES (1, 0.8, 0.05, 100, 0.10, 40, 300000, 0.02, 3, 0)
            `);
        }

        // Ensure stoch_period exists in case older DB lacked the column
        try {
            const botConfigInfo = await this.getAllQuery("PRAGMA table_info(bot_config)");
            const botConfigColumns = botConfigInfo.map(c => c.name);
            if (!botConfigColumns.includes('stoch_period')) {
                await this.runQuery(`ALTER TABLE bot_config ADD COLUMN stoch_period TEXT DEFAULT '15m'`);
            }
        } catch (e) {
            // non-fatal
        }

        const portfolio = await this.getPortfolioState();
        if (!portfolio) {
            await this.runQuery(`
                INSERT INTO portfolio_state (id, balance, btc_amount, initial_balance, 
                    total_value, start_date)
                VALUES (1, 10000, 0, 10000, 10000, CURRENT_TIMESTAMP)
            `);
        }
    }

    // Migrar base de datos para agregar campos de ganancia/pérdida
    async migrateTradesTable() {
        try {
            // Verificar si las columnas ya existen
            const tableInfo = await this.getAllQuery("PRAGMA table_info(trades)");
            const columnNames = tableInfo.map(col => col.name);
            
            const newColumns = [
                { name: 'entry_price', type: 'REAL DEFAULT 0' },
                { name: 'exit_price', type: 'REAL DEFAULT 0' },
                { name: 'gain_loss', type: 'REAL DEFAULT 0' },
                { name: 'roi', type: 'REAL DEFAULT 0' },
                { name: 'related_trade_id', type: 'TEXT DEFAULT NULL' },
                // Nuevas columnas para soportar posiciones long/short
                { name: 'position_side', type: "TEXT DEFAULT NULL" },
                { name: 'position_id', type: "TEXT DEFAULT NULL" },
                { name: 'action', type: "TEXT DEFAULT NULL" }
            ];
            
            // También migrar tabla bot_config para agregar estrategia
            const botConfigInfo = await this.getAllQuery("PRAGMA table_info(bot_config)");
            const botConfigColumns = botConfigInfo.map(col => col.name);
            
            if (!botConfigColumns.includes('trading_strategy')) {
                console.log('Agregando columna trading_strategy a tabla bot_config');
                await this.runQuery(`ALTER TABLE bot_config ADD COLUMN trading_strategy TEXT DEFAULT 'estocastico909'`);
            }
            if (!botConfigColumns.includes('stop_loss_usd')) {
                console.log('Agregando columna stop_loss_usd a tabla bot_config');
                await this.runQuery(`ALTER TABLE bot_config ADD COLUMN stop_loss_usd REAL DEFAULT 100`);
            }
            if (!botConfigColumns.includes('stoch_period')) {
                console.log('Agregando columna stoch_period a tabla bot_config');
                await this.runQuery(`ALTER TABLE bot_config ADD COLUMN stoch_period TEXT DEFAULT '15m'`);
            }
            
            // Agregar columnas que no existan
            for (const col of newColumns) {
                if (!columnNames.includes(col.name)) {
                    console.log(`Agregando columna ${col.name} a tabla trades`);
                    await this.runQuery(`ALTER TABLE trades ADD COLUMN ${col.name} ${col.type}`);
                }
            }
            
            console.log('Migración de tabla trades completada');
            return true;
        } catch (error) {
            console.error('Error en migración de tabla trades:', error);
            return false;
        }
    }

    // Calcular y actualizar ganancias/pérdidas para operaciones existentes
    async calculateTradeMetrics() {
        try {
            const trades = await this.getAllQuery("SELECT * FROM trades ORDER BY timestamp ASC");
            // Si ya existen columnas de 'action', asumimos que las métricas se calculan al cerrar la posición
            const tableInfo = await this.getAllQuery("PRAGMA table_info(trades)");
            const hasAction = tableInfo.some(col => col.name === 'action');
            if (hasAction) {
                console.log('ℹ️ Esquema con posiciones detectado, se omite recálculo automático de métricas');
                return true;
            }
            let buyTrades = [];
            
            for (const trade of trades) {
                if (trade.type === 'BUY') {
                    // Agregar a lista de compras pendientes
                    buyTrades.push({
                        ...trade,
                        entry_price: trade.price,
                        remaining_amount: trade.amount
                    });
                    
                    // Actualizar entry_price en BD
                    await this.runQuery(
                        "UPDATE trades SET entry_price = ?, exit_price = 0, gain_loss = 0, roi = 0 WHERE id = ?",
                        [trade.price, trade.id]
                    );
                    
                } else if (trade.type === 'SELL' && buyTrades.length > 0) {
                    // Emparejar con compras previas (FIFO - First In, First Out)
                    let sellAmount = trade.amount;
                    let totalGainLoss = 0;
                    let weightedEntryPrice = 0;
                    let matchedBuys = [];
                    
                    for (let i = 0; i < buyTrades.length && sellAmount > 0; i++) {
                        const buyTrade = buyTrades[i];
                        if (buyTrade.remaining_amount <= 0) continue;
                        
                        const matchAmount = Math.min(sellAmount, buyTrade.remaining_amount);
                        const entryPrice = buyTrade.price;
                        const exitPrice = trade.price;
                        const gainLoss = (exitPrice - entryPrice) * matchAmount - trade.fee * (matchAmount / trade.amount);
                        const roi = ((exitPrice - entryPrice) / entryPrice) * 100;
                        
                        totalGainLoss += gainLoss;
                        weightedEntryPrice += entryPrice * matchAmount;
                        
                        // Reducir cantidad restante de la compra
                        buyTrades[i].remaining_amount -= matchAmount;
                        sellAmount -= matchAmount;
                        
                        matchedBuys.push({
                            buyTradeId: buyTrade.id,
                            amount: matchAmount,
                            entryPrice,
                            exitPrice,
                            gainLoss,
                            roi
                        });
                    }
                    
                    if (matchedBuys.length > 0) {
                        const avgEntryPrice = weightedEntryPrice / trade.amount;
                        const totalRoi = ((trade.price - avgEntryPrice) / avgEntryPrice) * 100;
                        
                        // Actualizar la venta con los cálculos
                        await this.runQuery(
                            "UPDATE trades SET entry_price = ?, exit_price = ?, gain_loss = ?, roi = ?, related_trade_id = ? WHERE id = ?",
                            [avgEntryPrice, trade.price, totalGainLoss, totalRoi, matchedBuys[0].buyTradeId, trade.id]
                        );
                    }
                }
            }
            
            // Limpiar compras que ya no tienen cantidad restante
            buyTrades = buyTrades.filter(bt => bt.remaining_amount > 0);
            
            console.log('✅ Métricas de trades calculadas correctamente');
            return true;
        } catch (error) {
            console.error('Error calculando métricas de trades:', error);
            return false;
        }
    }

    // Ejecutar query con promesa
    runQuery(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, changes: this.changes });
                }
            });
        });
    }

    // Obtener datos con promesa
    getQuery(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // Obtener múltiples filas
    getAllQuery(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // === MÉTODOS DE TRADING ===

    // Guardar operación
    async saveTrade(trade) {
        try {
            // Ensure numeric fields are valid numbers (avoid Infinity/NaN being stored)
            const toNumberSafe = (v, fallback = 0) => {
                const n = Number(v);
                return Number.isFinite(n) ? n : fallback;
            };

            trade.amount = toNumberSafe(trade.amount, 0);
            trade.price = toNumberSafe(trade.price, 0);
            trade.usdAmount = toNumberSafe(trade.usdAmount ?? trade.usd_amount, 0);
            trade.fee = toNumberSafe(trade.fee, 0);
            trade.balanceAfter = toNumberSafe(trade.balanceAfter ?? trade.balance_after, 0);
            trade.btcAfter = toNumberSafe(trade.btcAfter ?? trade.btc_after, 0);

            // Defensive: ensure position_id exists for open trades.
            // Some codepaths previously saved trades without a position_id which
            // broke rebuild logic. If this is an 'open' action and no position id
            // is provided, generate a stable-ish id and attach it to the trade
            // so both DB and in-memory listeners receive it.
            const action = trade.action || null;
            let positionId = trade.positionId || trade.position_id || null;
            const positionSide = trade.positionSide || trade.position_side || null;
            if (!positionId && action === 'open') {
                // Build an id that encodes side if available and a timestamp+random
                const sidePrefix = positionSide ? `${positionSide}` : 'pos';
                positionId = `${sidePrefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
                // Attach back to trade object in both common variants so callers/readers see it
                trade.positionId = positionId;
                trade.position_id = positionId;
            }

            // Prevent inserting duplicate CLOSE records for the same position_id.
            // Historically multiple processes or race conditions could create
            // two 'close' rows for one position; detect an existing close and
            // skip the insert to keep the ledger consistent.
            if (action === 'close' && positionId) {
                try {
                    const existingClose = await this.getQuery(
                        "SELECT trade_id FROM trades WHERE action = 'close' AND position_id = ? LIMIT 1",
                        [positionId]
                    ).catch(() => null);
                    if (existingClose && existingClose.trade_id) {
                        console.warn(`Duplicate close detected for position_id=${positionId} (existing trade_id=${existingClose.trade_id}). Skipping insert.`);
                        try { await this.addLog('warning', `Duplicate close skipped for position_id=${positionId}`, 'database', { tradeId: trade.id, existingTradeId: existingClose.trade_id }); } catch(e){}
                        return { skipped: true };
                    }
                } catch (e) {
                    // If the check fails for any reason, proceed with the insert
                    // to avoid blocking normal operation — but log the error.
                    console.warn('Error checking duplicate close:', e && e.message ? e.message : e);
                }
            }
            const sql = `
                INSERT INTO trades (trade_id, type, amount, price, usd_amount, fee,
                    confidence, reasons, stop_loss, take_profit, balance_after, btc_after,
                    entry_price, exit_price, gain_loss, roi, related_trade_id,
                    position_side, position_id, action)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            // Accept both camelCase and snake_case variants to be robust across codepaths
            const params = [
                trade.id,
                trade.type,
                trade.amount,
                trade.price,
                trade.usdAmount,
                trade.fee || 0,
                trade.confidence || 0,
                JSON.stringify(trade.reasons || []),
                trade.stopLoss || trade.stop_loss || null,
                trade.takeProfit || trade.take_profit || null,
                trade.balanceAfter || trade.balance_after || 0,
                trade.btcAfter || trade.btc_after || 0,
                trade.entryPrice || trade.entry_price || null,
                trade.exitPrice || trade.exit_price || null,
                typeof trade.gainLoss === 'number' ? trade.gainLoss : (typeof trade.gain_loss === 'number' ? trade.gain_loss : null),
                typeof trade.roi === 'number' ? trade.roi : (typeof trade.roi === 'number' ? trade.roi : null),
                trade.relatedTradeId || trade.related_trade_id || null,
                trade.positionSide || trade.position_side || null,
                trade.positionId || trade.position_id || null,
                trade.action || null
            ];

            const result = await this.runQuery(sql, params);
            console.log(`💾 Operación guardada: ${trade.type} ${trade.amount} BTC`);
            // Emit event for listeners (e.g., server) so UI can be updated in real-time
            try {
                if (this.events && typeof this.events.emit === 'function') {
                    this.events.emit('tradeSaved', trade);
                }
            } catch (e) {
                console.warn('Warning emitting tradeSaved event:', e.message);
            }
            return result;
        } catch (error) {
            console.error('Error guardando operación:', error);
            throw error;
        }
    }

    // Obtener historial de operaciones
    async getTrades(limit = 100) {
        try {
            const sql = `
                SELECT *, 
                    json_extract(reasons, '$') as parsed_reasons
                FROM trades 
                ORDER BY timestamp DESC 
                LIMIT ?
            `;
            const trades = await this.getAllQuery(sql, [limit]);

            return trades.map(trade => {
                let reasons = [];
                try {
                    if (trade.parsed_reasons && trade.parsed_reasons !== 'null') {
                        reasons = JSON.parse(trade.parsed_reasons);
                    }
                } catch (e) {
                    console.warn('Error parsing reasons:', e.message);
                    reasons = [];
                }

                // Normalizar timestamp de SQLite (UTC) a ISO para evitar desfase horario
                // SQLite suele devolver 'YYYY-MM-DD HH:MM:SS' en UTC.
                // Convertimos a 'YYYY-MM-DDTHH:MM:SSZ' para que el cliente lo interprete correctamente.
                let normalizedTs = trade.timestamp;
                try {
                    if (typeof normalizedTs === 'string' && normalizedTs.includes(' ')) {
                        normalizedTs = normalizedTs.replace(' ', 'T') + 'Z';
                    }
                } catch (e) {}

                // Mapeo explícito de campos para asegurar compatibilidad
                return {
                    id: trade.trade_id,
                    trade_id: trade.trade_id,
                    type: trade.type,
                    amount: Number(trade.amount) || 0,
                    price: Number(trade.price) || 0,
                    usd_amount: Number(trade.usd_amount) || 0,
                    fee: Number(trade.fee) || 0,
                    timestamp: normalizedTs,
                    confidence: Number(trade.confidence) || 0,
                    reasons: Array.isArray(reasons) ? reasons : [],
                    stop_loss: trade.stop_loss ? Number(trade.stop_loss) : null,
                    take_profit: trade.take_profit ? Number(trade.take_profit) : null,
                    balance_after: Number(trade.balance_after) || 0,
                    btc_after: Number(trade.btc_after) || 0,
                    status: trade.status || 'completed',
                    created_at: trade.created_at,
                    entry_price: trade.entry_price ? Number(trade.entry_price) : 0,
                    exit_price: trade.exit_price ? Number(trade.exit_price) : 0,
                    gain_loss: trade.gain_loss ? Number(trade.gain_loss) : null,
                    roi: trade.roi ? Number(trade.roi) : null,
                    related_trade_id: trade.related_trade_id,
                    position_side: trade.position_side,  // Campo crítico
                    position_id: trade.position_id,      // Campo crítico
                    action: trade.action,                // Campo crítico
                    parsed_reasons: trade.parsed_reasons
                };
            });
        } catch (error) {
            console.error('Error obteniendo operaciones:', error);
            return [];
        }
    }

    // Actualizar estado del portafolio
    async updatePortfolioState(state) {
        try {
            const sql = `
                INSERT OR REPLACE INTO portfolio_state 
                (id, balance, btc_amount, initial_balance, total_value, total_return,
                 realized_pnl, unrealized_pnl, total_fees, max_drawdown, sharpe_ratio, start_date, last_updated)
                VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `;
            const params = [
                state.balance,
                state.btcAmount,
                safeNum(state.initialBalance, 10000),
                state.totalValue,
                state.totalReturn,
                state.realizedPnL || 0,
                state.unrealizedPnL || 0,
                state.totalFees || 0,
                state.maxDrawdown || 0,
                state.sharpeRatio || 0,
                new Date().toISOString()
            ];

            await this.runQuery(sql, params);
            // Add an audit log entry when portfolio_state is updated to aid debugging
            try {
                const msg = `portfolio_state updated - balance=${Number(state.balance||0).toFixed(2)}, btc_amount=${Number(state.btcAmount||0).toFixed(8)}, total_value=${Number(state.totalValue||0).toFixed(2)}`;
                await this.addLog('info', msg, 'portfolio_state');
            } catch (e) {
                // non-fatal
            }
        } catch (error) {
            console.error('Error actualizando portafolio:', error);
            throw error;
        }
    }

    // Obtener estado del portafolio
    async getPortfolioState() {
        try {
            const sql = `SELECT * FROM portfolio_state WHERE id = 1`;
            return await this.getQuery(sql);
        } catch (error) {
            console.error('Error obteniendo estado del portafolio:', error);
            return null;
        }
    }

    // Guardar datos de mercado
    async saveMarketData(data) {
        try {
            const sql = `
                INSERT INTO market_data (price, change_24h, volume_24h, sma_20, sma_50, 
                    rsi, macd, ema_12, ema_26, bb_upper, bb_lower)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const params = [
                data.price,
                data.change24h || 0,
                data.volume || 0,
                data.indicators?.sma20?.slice(-1)[0] || null,
                data.indicators?.sma50?.slice(-1)[0] || null,
                data.indicators?.rsi?.slice(-1)[0] || null,
                data.indicators?.macd?.slice(-1)[0] || null,
                data.indicators?.ema12?.slice(-1)[0] || null,
                data.indicators?.ema26?.slice(-1)[0] || null,
                data.indicators?.bb_upper?.slice(-1)[0] || null,
                data.indicators?.bb_lower?.slice(-1)[0] || null
            ];

            await this.runQuery(sql, params);
        } catch (error) {
            console.error('Error guardando datos de mercado:', error);
        }
    }

    // Configuración del bot
    async getBotConfig() {
        try {
            const sql = `SELECT * FROM bot_config WHERE id = 1`;
            let config = await this.getQuery(sql);
            
            // Si no existe configuración, crear una por defecto
                if (!config) {
                console.log('Creando configuración por defecto del bot...');
                // Por defecto usar MAXI1
                await this.runQuery(`
                    INSERT OR IGNORE INTO bot_config (id, trading_strategy) 
                    VALUES (1, 'maxi1')
                `);
                config = await this.getQuery(sql);
            }
            
            return config;
        } catch (error) {
            console.error('Error obteniendo configuración:', error);
            return null;
        }
    }

    async updateBotConfig(config) {
        try {
            const sql = `
                UPDATE bot_config 
                SET max_position_size = ?, stop_loss = ?, take_profit = ?, 
                    min_confidence = ?, cooldown_period = ?, risk_per_trade = ?,
                    max_consecutive_losses = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
            `;
            const params = [
                config.maxPositionSize,
                config.stopLoss,
                config.takeProfit,
                config.minConfidence,
                config.cooldownPeriod,
                config.riskPerTrade,
                config.maxConsecutiveLosses,
                config.isActive ? 1 : 0
            ];

            await this.runQuery(sql, params);
            console.log('⚙️ Configuración del bot actualizada');
        } catch (error) {
            console.error('Error actualizando configuración:', error);
            throw error;
        }
    }

    // Logging del sistema
    async addLog(level, message, component = 'system', data = null) {
        try {
            const sql = `
                INSERT INTO system_logs (level, message, component, data)
                VALUES (?, ?, ?, ?)
            `;
            const params = [level, message, component, data ? JSON.stringify(data) : null];
            await this.runQuery(sql, params);
        } catch (error) {
            console.error('Error guardando log:', error);
        }
    }

    // Añadir auditoría de trade
    async addTradeAudit(record) {
        try {
            const sql = `
                INSERT INTO trade_audit (trade_id, requested_usd, final_usd, balance_snapshot, note)
                VALUES (?, ?, ?, ?, ?)
            `;
            const params = [record.tradeId || null, Number(record.requestedUsd) || 0, Number(record.finalUsd) || 0, Number(record.balanceSnapshot) || 0, record.note || null];
            await this.runQuery(sql, params);
        } catch (error) {
            console.error('Error guardando trade_audit:', error);
        }
    }

    // Obtener logs recientes
    async getLogs(limit = 50, level = null) {
        try {
            let sql = `SELECT * FROM system_logs`;
            let params = [];
            
            if (level) {
                sql += ` WHERE level = ?`;
                params.push(level);
            }
            
            sql += ` ORDER BY timestamp DESC LIMIT ?`;
            params.push(limit);

            return await this.getAllQuery(sql, params);
        } catch (error) {
            console.error('Error obteniendo logs:', error);
            return [];
        }
    }

    // Estadísticas y métricas
    async getTradeStatistics() {
        try {
                        // Nuevo cálculo: consideramos una "operación" como el par apertura+cierre.
                        // total_trades representa operaciones completadas (cierres emparejados por position_id
                        // o cierres sin position_id). Además las métricas de ganancias/perdidas se calculan
                        // exclusivamente sobre operaciones de cierre para evitar contar aperturas por separado.
                        const sql = `
                            WITH
                                -- Agregar por position_id para obtener el resultado neto por posición
                                positions_agg AS (
                                    SELECT
                                        position_id,
                                        SUM(COALESCE(gain_loss, 0)) AS total_gain
                                    FROM trades
                                    WHERE position_id IS NOT NULL AND position_id != ''
                                    GROUP BY position_id
                                ),
                                -- Solo posiciones que tienen un cierre (completed)
                                positions_completed AS (
                                    SELECT pa.position_id, pa.total_gain
                                    FROM positions_agg pa
                                    WHERE EXISTS (SELECT 1 FROM trades t WHERE t.position_id = pa.position_id AND t.action = 'close')
                                ),
                                -- Cierres sin position_id (cada uno cuenta como una operación)
                                standalone_closes AS (
                                    SELECT * FROM trades WHERE action = 'close' AND (position_id IS NULL OR position_id = '')
                                ),
                                stats_positions AS (
                                    SELECT
                                        (SELECT COUNT(*) FROM positions_completed) AS positions_count,
                                        (SELECT COUNT(*) FROM positions_completed WHERE total_gain > 0) AS positions_wins,
                                        (SELECT COUNT(*) FROM positions_completed WHERE total_gain < 0) AS positions_losses
                                ),
                                stats_standalone AS (
                                    SELECT
                                        (SELECT COUNT(*) FROM standalone_closes) AS standalone_count,
                                        (SELECT COUNT(*) FROM standalone_closes WHERE (gain_loss IS NOT NULL AND gain_loss > 0) OR (position_side = 'long' AND (exit_price - entry_price) > 0) OR (position_side = 'short' AND (entry_price - exit_price) > 0)) AS standalone_wins,
                                        (SELECT COUNT(*) FROM standalone_closes WHERE (gain_loss IS NOT NULL AND gain_loss < 0) OR (position_side = 'long' AND (exit_price - entry_price) < 0) OR (position_side = 'short' AND (entry_price - exit_price) < 0)) AS standalone_losses
                                ),
                                stats_combined AS (
                                    SELECT
                                        (p.positions_count + s.standalone_count) AS total_trades,
                                        (p.positions_wins + s.standalone_wins) AS winning_trades,
                                        (p.positions_losses + s.standalone_losses) AS losing_trades
                                    FROM stats_positions p CROSS JOIN stats_standalone s
                                )
                            SELECT
                                (SELECT total_trades FROM stats_combined) AS total_trades,
                                (SELECT COUNT(CASE WHEN type = 'BUY' THEN 1 END) FROM trades) as buy_trades,
                                (SELECT COUNT(CASE WHEN type = 'SELL' THEN 1 END) FROM trades) as sell_trades,
                                (SELECT AVG(confidence) FROM trades) as avg_confidence,
                                (SELECT MIN(price) FROM trades) as min_price,
                                (SELECT MAX(price) FROM trades) as max_price,
                                (SELECT SUM(fee) FROM trades) as total_fees,
                                (SELECT MIN(timestamp) FROM trades) as first_trade,
                                (SELECT MAX(timestamp) FROM trades) as last_trade,

                                (SELECT winning_trades FROM stats_combined) as winning_trades,
                                (SELECT losing_trades FROM stats_combined) as losing_trades,

                                SUM(CASE WHEN gain_loss IS NOT NULL AND gain_loss > 0 THEN gain_loss ELSE 0 END) as gross_wins,
                                ABS(SUM(CASE WHEN gain_loss IS NOT NULL AND gain_loss < 0 THEN gain_loss ELSE 0 END)) as gross_losses,

                                CASE WHEN (SELECT total_trades FROM stats_combined) = 0 THEN 0 ELSE ((SELECT winning_trades FROM stats_combined) * 100.0 / (SELECT total_trades FROM stats_combined)) END as win_rate
                            FROM trades
                        `;

                        return await this.getQuery(sql);
        } catch (error) {
            console.error('Error obteniendo estadísticas:', error);
            return null;
        }
    }

    // Limpiar datos antiguos (mantenimiento)
    async cleanupOldData(daysToKeep = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
            
            // Limpiar logs antiguos
            await this.runQuery(`
                DELETE FROM system_logs 
                WHERE timestamp < ? AND level IN ('info', 'debug')
            `, [cutoffDate.toISOString()]);

            // Limpiar datos de mercado antiguos (mantener solo muestras)
            await this.runQuery(`
                DELETE FROM market_data 
                WHERE timestamp < ? AND id % 10 != 0
            `, [cutoffDate.toISOString()]);

            console.log(`🧹 Limpieza de datos completada (${daysToKeep} días)`);
        } catch (error) {
            console.error('Error en limpieza:', error);
        }
    }

        // Respaldar base de datos
    async backup() {
        try {
            const backupPath = path.join(path.dirname(this.dbPath), `backup_${Date.now()}.db`);
            await fs.copy(this.dbPath, backupPath);
            console.log(`💾 Respaldo creado: ${backupPath}`);
            return backupPath;
        } catch (error) {
            console.error('Error creando respaldo:', error);
            throw error;
        }
    }

    // Limpiar todas las operaciones y logs (para reset)
    async clearTradesAndLogs() {
        try {
            console.log('🧹 Iniciando limpieza de trades, logs y datos de mercado...');
            await this.runQuery(`DELETE FROM trades`);
            await this.runQuery(`DELETE FROM system_logs`);
            await this.runQuery(`DELETE FROM market_data`);
            console.log('🧹 Trades, logs y datos de mercado limpiados exitosamente');
        } catch (error) {
            console.error('❌ Error limpiando datos:', error);
            throw error;
        }
    }

    // Cerrar conexión
    async close() {
        return new Promise((resolve) => {
            if (this.db && this.isConnected) {
                this.db.close((err) => {
                    if (err) {
                        console.error('Error cerrando base de datos:', err);
                    } else {
                        console.log('📊 Conexión a base de datos cerrada');
                    }
                    this.isConnected = false;
                    this.db = null;
                    resolve();
                });
            } else {
                if (this.db) {
                    this.db = null;
                }
                this.isConnected = false;
                resolve();
            }
        });
    }
}

module.exports = DatabaseManager;
