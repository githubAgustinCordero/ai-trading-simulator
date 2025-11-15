const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const cron = require('node-cron');
const fs = require('fs-extra');
const { safeNum } = require('./lib/utils');

// Importar módulos personalizados
const BinanceMarketData = require('./binanceMarketData');
const Portfolio = require('./portfolio');
const TradingBot = require('./tradingBot');

class AITradingServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });
        this.port = process.env.PORT || 9999;
        
        // Inicializar servicios (se completará en initialize())
        this.marketData = new BinanceMarketData();
        this.portfolio = null; // Se inicializará con base de datos
        this.tradingBot = null;
        
        // Estado del sistema
        this.isRunning = false;
        this.clients = new Set();
        this.lastBroadcast = null;
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupWebSocket();
        this.startMarketDataUpdates();
        
        console.log('🚀 AI Trading Simulator inicializado con Binance API');
    }

    setupMiddleware() {
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname)));
        
        // CORS para desarrollo
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            next();
        });
    }

    setupRoutes() {
        // Ruta principal - servir dashboard
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'index.html'));
        });

        // API: Estado del sistema
        this.app.get('/api/status', async (req, res) => {
            try {
                const currentPrice = await this.marketData.getCurrentPrice();
                const marketSignals = this.marketData.getMarketSignals();
                const botStats = await this.tradingBot.getStats();
                const portfolioStats = await this.portfolio.getPortfolioStats(currentPrice?.price || 0);
                const trades = await this.portfolio.getTradeHistory(20);
                // Obtener métricas agregadas desde la BDD para evitar ambigüedad en la UI
                let tradeMetrics = null;
                try {
                    if (this.portfolio && this.portfolio.db && typeof this.portfolio.db.getTradeStatistics === 'function') {
                        tradeMetrics = await this.portfolio.db.getTradeStatistics();
                    }
                } catch (err) {
                    console.warn('No se pudieron obtener métricas de trades desde la DB:', err && err.message ? err.message : err);
                }
                
                // Posiciones abiertas y totales invertido/no invertido
                const openPositions = this.portfolio.openPositions || [];
                const priceNow = currentPrice?.price || 0;
                // Helper: obtener price de entrada preferente de la posición (entryPrice || trade.price si existe)
                const getEntryPrice = (pos) => {
                    if (pos && pos.entryPrice) return Number(pos.entryPrice);
                    try {
                        if (this.portfolio && Array.isArray(this.portfolio.trades)) {
                            const t = this.portfolio.trades.find(tr => (tr.position_id === pos.id || tr.positionId === pos.id) && (tr.action === 'open'));
                            if (t && t.price) return Number(t.price);
                        }
                    } catch (e) {
                        // ignore and fallback to market price
                    }
                    return Number(priceNow || 0);
                };

                // Base invertido (sin contar ganancias/perdidas): usar precio de entrada cuando esté disponible
                const investedLongBaseUsd = openPositions
                    .filter(p => p.side === 'long')
                    .reduce((sum, p) => sum + (Number(p.amountBtc || 0) * getEntryPrice(p)), 0);
                const investedShortBaseUsd = openPositions
                    .filter(p => p.side === 'short')
                    .reduce((sum, p) => sum + (Number(p.amountBtc || 0) * getEntryPrice(p)), 0);
                const investedBaseUsd = investedLongBaseUsd + investedShortBaseUsd;

                // PnL no realizado (suma de todas las posiciones) y PnL realizado
                const unrealizedPnL = this.portfolio.getUnrealizedPnL(priceNow) || 0;
                const realizedPnL = (portfolioStats && portfolioStats.realizedPnL) || 0;

                // Invertido incluyendo PnL: base + PnL no realizado
                const investedWithPnl = investedBaseUsd + unrealizedPnL;

                // Valor total según tu definición: capital inicial + PnL realizado + PnL no realizado
                const totalValue = (this.portfolio.initialBalance || 0) + realizedPnL + unrealizedPnL;

                // No invertido: inicial antes de abrir - dinero invertido (sin contar beneficio/pérdida)
                let uninvestedUsd = (this.portfolio.initialBalance || 0) - investedBaseUsd;
                if (typeof uninvestedUsd !== 'number' || isNaN(uninvestedUsd) || uninvestedUsd < 0) {
                    uninvestedUsd = Math.max(0, this.portfolio.balance || 0);
                }

                // Estruturar signals correctamente para el dashboard
                const botSignals = {
                    signal: marketSignals.signal || 'HOLD',
                    confidence: marketSignals.confidence || 0,
                    indicators: marketSignals.indicators || {}
                };

                res.json({
                    success: true,
                    data: {
                        portfolio: portfolioStats,
                        market: currentPrice,
                        bot: {
                            isActive: this.tradingBot.isActive,
                            signals: botSignals,
                            strategy: this.tradingBot.getStrategy(),
                            ...botStats,
                            // Mapear estadísticas importantes al objeto `bot` para compatibilidad con el frontend
                            winningTrades: (portfolioStats && (typeof portfolioStats.winningTrades !== 'undefined' ? portfolioStats.winningTrades : portfolioStats.winning_trades)) || (botStats && botStats.winningTrades) || 0,
                            losingTrades: (portfolioStats && (typeof portfolioStats.losingTrades !== 'undefined' ? portfolioStats.losingTrades : portfolioStats.losing_trades)) || (botStats && botStats.losingTrades) || 0,
                            winRate: (portfolioStats && (typeof portfolioStats.winRate !== 'undefined' ? portfolioStats.winRate : portfolioStats.win_rate)) || (botStats && botStats.winRate) || 0,
                            grossWins: (portfolioStats && (typeof portfolioStats.grossWins !== 'undefined' ? portfolioStats.grossWins : portfolioStats.gross_wins)) || (botStats && botStats.grossWins) || 0,
                            grossLosses: (portfolioStats && (typeof portfolioStats.grossLosses !== 'undefined' ? portfolioStats.grossLosses : portfolioStats.gross_losses)) || (botStats && botStats.grossLosses) || 0,
                            profitFactor: (portfolioStats && typeof portfolioStats.profitFactor !== 'undefined') ? portfolioStats.profitFactor : (botStats && botStats.profitFactor) || null
                        },
                        positions: {
                            open: openPositions,
                                invested: {
                                    longUsd: investedLongBaseUsd,
                                    shortUsd: investedShortBaseUsd,
                                    totalUsd: investedBaseUsd,
                                    withPnl: investedWithPnl,
                                    uninvestedUsd: uninvestedUsd,
                                    totalValue: totalValue
                                }
                        },
                        stats: portfolioStats,
                        trades: trades,
                        // Métricas agregadas directas desde la BD para clarificar definiciones
                        metrics: tradeMetrics
                    }
                });
            } catch (error) {
                console.error('Error obteniendo estado:', error);
                res.status(500).json({
                    success: false,
                    message: error.message
                });
            }
        });

        // API: Configurar bot (ESPECÍFICA - debe ir antes que :action)
        this.app.post('/api/bot/settings', (req, res) => {
            try {
                const settings = req.body;
                const result = this.tradingBot.updateSettings(settings);
                
                if (result) {
                    this.logActivity('⚙️ Configuración del bot actualizada', 'info');
                    res.json({
                        success: true,
                        message: 'Configuración actualizada'
                    });
                } else {
                    res.json({
                        success: false,
                        message: 'Error actualizando configuración'
                    });
                }
            } catch (error) {
                res.status(500).json({
                    success: false,
                    message: error.message
                });
            }
        });

        // API: Cambiar estrategia de trading (ESPECÍFICA - debe ir antes que :action)
        this.app.post('/api/bot/strategy', async (req, res) => {
            try {
                const { strategy: strategyRaw } = req.body;
                // Debug: log incoming strategy payload to help diagnose frontend issues
                console.log('🔧 [DEBUG] /api/bot/strategy received body:', req.body);

                // Normalize strategy to lowercase trimmed string to accept case-insensitive input
                const strategy = typeof strategyRaw === 'string' ? strategyRaw.toLowerCase().trim() : '';

                // Solo MAXI1 soportada en esta versión simplificada
                const allowedStrategies = ['maxi1'];

                if (!strategy || !allowedStrategies.includes(strategy)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Estrategia inválida'
                    });
                }

                // Actualizar estrategia en el bot
                if (this.tradingBot) {
                    this.tradingBot.setStrategy(strategy);

                    // Guardar en base de datos
                    await this.portfolio.db.runQuery(
                        "UPDATE bot_config SET trading_strategy = ? WHERE id = 1",
                        [strategy]
                    );
                    
                    const strategyNames = {
                        'maxi1': 'MAXI1 (Long/Short perpetual)'
                    };
                    
                    this.logActivity(`🎯 Estrategia cambiada a: ${strategyNames[strategy]}`, 'info');
                    
                    res.json({
                        success: true,
                        message: `Estrategia cambiada a ${strategyNames[strategy]}`
                    });
                } else {
                    res.json({
                        success: false,
                        message: 'Bot no inicializado'
                    });
                }
            } catch (error) {
                console.error('Error cambiando estrategia:', error);
                res.status(500).json({
                    success: false,
                    message: error.message
                });
            }
        });

        // API: Controlar bot (GENÉRICA - debe ir después de las específicas)
        this.app.post('/api/bot/:action', async (req, res) => {
            console.log(`📨 Recibida petición POST /api/bot/${req.params.action}`);
            try {
                const { action } = req.params;
                let result = false;

                switch (action) {
                    case 'start':
                        // Await start() so initial position (if opened) is created before responding
                        result = await this.tradingBot.start();
                        this.isRunning = true;
                        this.logActivity('🤖 Bot de trading iniciado', 'success');
                        break;
                    
                    case 'stop':
                        result = this.tradingBot.stop();
                        this.isRunning = false;
                        this.logActivity('🛑 Bot de trading detenido', 'warning');
                        break;
                    
                    case 'reset':
                        this.tradingBot.stop();
                        // Log antes de limpiar para que se mantenga
                        this.logActivity('🔄 Bot y portafolio reiniciados', 'warning');
                        await this.portfolio.resetPortfolio();
                        
                        // Forzar guardado del estado correcto después del reset
                        console.log('💾 Forzando guardado del estado después del reset...');
                        await this.portfolio.saveToDatabase();
                        
                        result = true;
                        this.isRunning = false;
                        break;

                    case 'rebuild':
                        // Reconstruir posiciones abiertas desde la tabla de trades y sincronizar el estado en memoria
                        try {
                            this.logActivity('🔧 Reconstruyendo posiciones abiertas desde trades (rebuild)', 'info');
                            // First, reload canonical state from DB to ensure balances are in sync
                            if (typeof this.portfolio.loadFromDatabase === 'function') {
                                try {
                                    await this.portfolio.loadFromDatabase();
                                } catch (loadErr) {
                                    console.warn('⚠️ rebuild: error cargando estado desde BD:', loadErr && loadErr.message ? loadErr.message : loadErr);
                                }
                            }
                            await this.portfolio.rebuildOpenPositionsFromTrades();
                            // Forzar recálculo/guardado inmediato del estado si existe la función
                            if (typeof this.portfolio.saveToDatabase === 'function') {
                                await this.portfolio.saveToDatabase();
                            }
                            result = true;
                        } catch (err) {
                            console.error('⚠️ Error ejecutando rebuild:', err);
                            result = false;
                        }
                        break;
                    
                    default:
                        throw new Error(`Acción no válida: ${action}`);
                }

                if (result) {
                    // Always broadcast update to all clients so UI stays in sync (include reset)
                    try {
                        await this.broadcastUpdate();
                    } catch (err) {
                        console.error('Error broadcasting update after action', action, err);
                    }
                }

                if (result) {
                    res.json({
                        success: true,
                        message: `Bot ${action} ejecutado correctamente`
                    });
                } else {
                    res.json({
                        success: false,
                        message: `Error ejecutando ${action}`
                    });
                }
            } catch (error) {
                console.error(`Error en acción ${req.params.action}:`, error);
                res.status(500).json({
                    success: false,
                    message: error.message
                });
            }
        });

        // API: Historial detallado
        this.app.get('/api/history', async (req, res) => {
            try {
                const { limit = 100, type = 'all' } = req.query;
                let trades = await this.portfolio.getTradeHistory(parseInt(limit));
                
                if (type !== 'all' && Array.isArray(trades)) {
                    trades = trades.filter(t => t.type && t.type.toLowerCase() === type.toLowerCase());
                }
                
                // Obtener logs de actividad desde la base de datos
                let logs = [];
                try {
                    if (this.portfolio && this.portfolio.db) {
                        logs = await this.portfolio.db.getLogs(parseInt(limit));
                    }
                } catch (error) {
                    console.error('Error obteniendo logs:', error);
                }
                
                // Obtener estadísticas
                let stats = null;
                try {
                    const currentPrice = this.marketData?.currentPrice || 0;
                    stats = await this.portfolio.getPortfolioStats(currentPrice);
                } catch (error) {
                    console.error('Error obteniendo estadísticas:', error);
                }

                // Build positions history summary grouped by position_id (include open/close timestamps)
                const positionsHistory = {};
                try {
                    (trades || []).forEach(t => {
                        const pid = t.position_id || t.positionId || null;
                        const action = (t.action || '').toString().toLowerCase();
                        if (!pid) return;
                        if (!positionsHistory[pid]) {
                            positionsHistory[pid] = {
                                positionId: pid,
                                positionSide: t.position_side || t.positionSide || null,
                                openTrade: null,
                                closeTrade: null,
                                openTimestamp: null,
                                closeTimestamp: null,
                                entryUsd: null,
                                exitUsd: null,
                                pnl: null,
                                trades: []
                            };
                        }
                        positionsHistory[pid].trades.push(t);
                        if (action === 'open') {
                            positionsHistory[pid].openTrade = t;
                            try { positionsHistory[pid].openTimestamp = t.timestamp ? (new Date(t.timestamp)).toISOString() : null; } catch(e){ positionsHistory[pid].openTimestamp = t.timestamp || null; }
                            positionsHistory[pid].entryUsd = t.usd_amount || t.usdAmount || null;
                        } else if (action === 'close') {
                            positionsHistory[pid].closeTrade = t;
                            try { positionsHistory[pid].closeTimestamp = t.timestamp ? (new Date(t.timestamp)).toISOString() : null; } catch(e){ positionsHistory[pid].closeTimestamp = t.timestamp || null; }
                            positionsHistory[pid].exitUsd = t.usd_amount || t.usdAmount || null;
                        }
                        // Compute PnL when both present
                        const ph = positionsHistory[pid];
                        if (ph.openTrade && ph.closeTrade) {
                            try {
                                const entry = Number(ph.entryUsd || 0);
                                const exitV = Number(ph.exitUsd || 0);
                                ph.pnl = isFinite(exitV - entry) ? (exitV - entry) : null;
                            } catch (e) { ph.pnl = null; }
                        }
                    });
                } catch (err) {
                    console.warn('Error construyendo positionsHistory:', err && err.message ? err.message : err);
                }

                res.json({
                    success: true,
                    trades: trades || [],
                    logs: logs || [],
                    stats: stats,
                    positionsHistory: Object.values(positionsHistory)
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    message: error.message
                });
            }
        });

        // API: Exportar datos
        this.app.get('/api/export', (req, res) => {
            try {
                const data = this.portfolio.exportData();
                res.json({
                    success: true,
                    data: data,
                    exportDate: new Date()
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    message: error.message
                });
            }
        });

        // (debug route removed)

        // API: Indicadores técnicos
        this.app.get('/api/indicators', (req, res) => {
            try {
                const indicators = this.marketData.indicators;
                const priceHistory = this.marketData.priceHistory.slice(-100);
                
                res.json({
                    success: true,
                    data: {
                        indicators: indicators,
                        priceHistory: priceHistory,
                        currentPrice: this.marketData.currentPrice
                    }
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    message: error.message
                });
            }
        });

        // API: devolver estrategias permitidas (útil para sincronizar frontend)
        this.app.get('/api/bot/strategies', (req, res) => {
            try {
                // Simplified: only MAXI1 available
                const allowedStrategies = ['maxi1'];
                const strategyNames = {
                    'maxi1': 'MAXI1 (Long/Short)'
                };

                res.json({ success: true, strategies: allowedStrategies, names: strategyNames });
            } catch (error) {
                res.status(500).json({ success: false, message: error.message });
            }
        });

        // API de prueba: forzar apertura/cierre de short
        this.app.post('/api/test/short', async (req, res) => {
            try {
                const { action } = req.body; // 'open' o 'close'
                const currentPrice = await this.marketData.getCurrentPrice();
                const price = currentPrice?.price || 100000;

                if (action === 'open') {
                    // Abrir short de prueba
                    await this.tradingBot.openShort(price, 60, ['Test manual short open'], {});
                    res.json({ success: true, message: 'Short abierto', price });
                } else if (action === 'close') {
                    // Cerrar short de prueba
                    await this.tradingBot.closeShort(price, 60, ['Test manual short close']);
                    res.json({ success: true, message: 'Short cerrado', price });
                } else {
                    res.status(400).json({ success: false, message: 'Acción inválida. Use "open" o "close".' });
                }
            } catch (error) {
                console.error('Error en test short:', error);
                res.status(500).json({ success: false, message: error.message });
            }
        });

        // API de prueba: forzar apertura/cierre de long
        this.app.post('/api/test/long', async (req, res) => {
            try {
                const { action } = req.body; // 'open' o 'close'
                const currentPrice = await this.marketData.getCurrentPrice();
                const price = currentPrice?.price || 100000;

                if (action === 'open') {
                    // Abrir long de prueba
                    await this.tradingBot.openLong(price, 60, ['Test manual long open'], {});
                    res.json({ success: true, message: 'Long abierto', price });
                } else if (action === 'close') {
                    // Cerrar long de prueba
                    await this.tradingBot.closeLong(price, 60, ['Test manual long close']);
                    res.json({ success: true, message: 'Long cerrado', price });
                } else {
                    res.status(400).json({ success: false, message: 'Acción inválida. Use "open" o "close".' });
                }
            } catch (error) {
                console.error('Error en test long:', error);
                res.status(500).json({ success: false, message: error.message });
            }
        });

        // API de prueba: simular señales específicas
        this.app.post('/api/test/signal', async (req, res) => {
            try {
                const { signal, confidence = 60, reason = 'Test signal' } = req.body;
                
                if (!['BUY', 'SELL', 'HOLD'].includes(signal)) {
                    return res.status(400).json({ success: false, message: 'Señal inválida. Use BUY, SELL o HOLD.' });
                }

                // Simular indicadores para forzar la señal deseada
                const mockIndicators = {
                    rsi: signal === 'BUY' ? 25 : signal === 'SELL' ? 75 : 50,
                    stoch: {
                        '5m': { k: signal === 'BUY' ? 15 : signal === 'SELL' ? 85 : 50, kPrev: signal === 'BUY' ? 20 : signal === 'SELL' ? 80 : 50 },
                        '15m': { k: signal === 'BUY' ? 15 : signal === 'SELL' ? 85 : 50, kPrev: signal === 'BUY' ? 20 : signal === 'SELL' ? 80 : 50, crossUpFromBottom: signal === 'BUY', crossDownFromTop: signal === 'SELL' },
                        '30m': { k: signal === 'BUY' ? 15 : signal === 'SELL' ? 85 : 50, kPrev: signal === 'BUY' ? 20 : signal === 'SELL' ? 80 : 50 }
                    }
                };

                // Forzar indicadores en marketData temporalmente
                const originalIndicators = this.marketData.indicators;
                this.marketData.indicators = { 
                    ...originalIndicators, 
                    ...mockIndicators,
                    stoch: { ...originalIndicators.stoch, ...mockIndicators.stoch }
                };

                // Obtener señales con indicadores simulados
                const simulatedSignals = this.marketData.getMarketSignals();
                
                // Forzar indicadores simulados en la respuesta
                simulatedSignals.indicators = { 
                    ...simulatedSignals.indicators, 
                    ...mockIndicators,
                    stoch: { ...simulatedSignals.indicators.stoch, ...mockIndicators.stoch }
                };
                
                // Ejecutar estrategia con señales simuladas
                await this.tradingBot.processSignals(simulatedSignals, { price: this.marketData.currentPrice });

                // Restaurar indicadores originales
                this.marketData.indicators = originalIndicators;

                // Broadcast update
                await this.broadcastUpdate();

                res.json({ 
                    success: true, 
                    message: `Señal ${signal} simulada`, 
                    simulatedSignals,
                    currentPosition: this.tradingBot.currentPosition 
                });
            } catch (error) {
                console.error('Error en simulación de señal:', error);
                res.status(500).json({ success: false, message: error.message });
            }
        });

        // API de prueba: simular señal personalizada con indicadores mock (incluye d/dPrev)
        // Útil para pruebas unitarias de estrategias que requieren valores específicos de indicadores
        this.app.post('/api/test/signal_custom', async (req, res) => {
            try {
                const { signal = 'HOLD', confidence = 60, reason = 'Custom test', mockIndicators = {} } = req.body || {};

                if (!['BUY', 'SELL', 'HOLD'].includes(signal)) {
                    return res.status(400).json({ success: false, message: 'Señal inválida. Use BUY, SELL o HOLD.' });
                }

                // Guardar indicadores originales y construir señales simuladas a partir de mockIndicators
                const originalIndicators = this.marketData.indicators;
                const mergedIndicators = {
                    ...originalIndicators,
                    ...mockIndicators,
                    stoch: { ...originalIndicators.stoch, ...(mockIndicators.stoch || {}) }
                };

                // Construir el objeto simulatedSignals manualmente para evitar que calculateTechnicalIndicators
                // (invocado por getMarketSignals) sobrescriba nuestros mocks.
                const simulatedSignals = {
                    signal: signal,
                    confidence: safeNum(confidence, 60),
                    reasons: [reason],
                    indicators: {
                        rsi: (mergedIndicators.rsi && Array.isArray(mergedIndicators.rsi)) ? mergedIndicators.rsi[0] : (mergedIndicators.rsi || 50),
                        sma20: (mergedIndicators.sma20 && Array.isArray(mergedIndicators.sma20)) ? mergedIndicators.sma20[0] : (mergedIndicators.sma20 || 0),
                        sma50: (mergedIndicators.sma50 && Array.isArray(mergedIndicators.sma50)) ? mergedIndicators.sma50[0] : (mergedIndicators.sma50 || 0),
                        stoch: mergedIndicators.stoch || {},
                        macd: (mergedIndicators.macd && Array.isArray(mergedIndicators.macd)) ? mergedIndicators.macd[0] : (mergedIndicators.macd || 0),
                        bb_upper: (mergedIndicators.bb_upper && Array.isArray(mergedIndicators.bb_upper)) ? mergedIndicators.bb_upper[0] : (mergedIndicators.bb_upper || 0),
                        bb_lower: (mergedIndicators.bb_lower && Array.isArray(mergedIndicators.bb_lower)) ? mergedIndicators.bb_lower[0] : (mergedIndicators.bb_lower || 0),
                        volume: (mergedIndicators.volume && Array.isArray(mergedIndicators.volume)) ? mergedIndicators.volume[0] : (mergedIndicators.volume || 0)
                    }
                };

                // Ejecutar la estrategia con las señales simuladas (no llamar a getMarketSignals para respetar el mock)
                await this.tradingBot.processSignals(simulatedSignals, { price: this.marketData.currentPrice });

                // Nota: no forzamos trades aquí — dejamos que la estrategia procese los simulatedSignals

                // Restaurar indicadores originales (no modificamos this.marketData.indicators permanentemente)
                this.marketData.indicators = originalIndicators;

                // Broadcast update
                await this.broadcastUpdate();

                res.json({ success: true, message: `Señal personalizada ${signal} simulada`, simulatedSignals, currentPosition: this.tradingBot.currentPosition });
            } catch (error) {
                console.error('Error en simulación de señal personalizada:', error);
                res.status(500).json({ success: false, message: error.message });
            }
        });
    }

    setupWebSocket() {
        this.wss.on('connection', (ws, req) => {
            console.log(`📱 Cliente conectado desde ${req.socket.remoteAddress}`);
            this.clients.add(ws);
            
            // Enviar estado inicial
            this.sendToClient(ws, {
                type: 'welcome',
                message: 'Conectado al AI Trading Simulator'
            });
            
            // Enviar datos actuales
            this.sendCurrentState(ws);

            ws.on('close', () => {
                console.log('📱 Cliente desconectado');
                this.clients.delete(ws);
            });

            ws.on('error', (error) => {
                console.error('Error WebSocket:', error);
                this.clients.delete(ws);
            });

            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    this.handleClientMessage(ws, data);
                } catch (error) {
                    console.error('Error procesando mensaje del cliente:', error);
                }
            });
        });
    }

    async sendCurrentState(ws) {
        try {
            const currentPrice = await this.marketData.getCurrentPrice();
            const signals = this.marketData.getMarketSignals();
            const botStats = await this.tradingBot.getStats();
            const portfolioStats = await this.portfolio.getPortfolioStats(currentPrice?.price || 0);
            const trades = await this.portfolio.getTradeHistory(10);
            // Obtener métricas agregadas desde la BDD para el envío inicial
            let tradeMetrics = null;
            try {
                if (this.portfolio && this.portfolio.db && typeof this.portfolio.db.getTradeStatistics === 'function') {
                    tradeMetrics = await this.portfolio.db.getTradeStatistics();
                }
            } catch (err) {
                console.warn('No se pudieron obtener métricas de trades desde la DB (sendCurrentState):', err && err.message ? err.message : err);
            }
            // (metrics already loaded above for sendCurrentState)
            // Posiciones abiertas y totales invertido/no invertido
            const openPositions = this.portfolio.openPositions || [];
            const priceNow = currentPrice?.price || 0;
            const getEntryPrice = (pos) => {
                if (pos && pos.entryPrice) return Number(pos.entryPrice);
                try {
                    if (this.portfolio && Array.isArray(this.portfolio.trades)) {
                        const t = this.portfolio.trades.find(tr => (tr.position_id === pos.id || tr.positionId === pos.id) && (tr.action === 'open'));
                        if (t && t.price) return Number(t.price);
                    }
                } catch (e) {}
                return Number(priceNow || 0);
            };
            const investedLongBaseUsd = openPositions
                .filter(p => p.side === 'long')
                .reduce((sum, p) => sum + (Number(p.amountBtc || 0) * getEntryPrice(p)), 0);
            const investedShortBaseUsd = openPositions
                .filter(p => p.side === 'short')
                .reduce((sum, p) => sum + (Number(p.amountBtc || 0) * getEntryPrice(p)), 0);
            const investedBaseUsd = investedLongBaseUsd + investedShortBaseUsd;
            const unrealizedPnL = this.portfolio.getUnrealizedPnL(priceNow) || 0;
            const realizedPnL = (portfolioStats && portfolioStats.realizedPnL) || 0;
            const investedWithPnl = investedBaseUsd + unrealizedPnL;
            const totalValue = (this.portfolio.initialBalance || 0) + realizedPnL + unrealizedPnL;
            let uninvestedUsd = (this.portfolio.initialBalance || 0) - investedBaseUsd;
            // Fallback to current balance if result is invalid (negative/NaN)
            if (typeof uninvestedUsd !== 'number' || isNaN(uninvestedUsd) || uninvestedUsd < 0) {
                uninvestedUsd = Math.max(0, this.portfolio.balance || 0);
            }

            this.sendToClient(ws, {
                type: 'update',
                data: {
                    portfolio: portfolioStats,
                    market: currentPrice,
                    bot: {
                        isActive: this.tradingBot.isActive,
                        signals: signals,
                        strategy: this.tradingBot.getStrategy(),
                        ...botStats,
                        winningTrades: (portfolioStats && (typeof portfolioStats.winningTrades !== 'undefined' ? portfolioStats.winningTrades : portfolioStats.winning_trades)) || (botStats && botStats.winningTrades) || 0,
                        losingTrades: (portfolioStats && (typeof portfolioStats.losingTrades !== 'undefined' ? portfolioStats.losingTrades : portfolioStats.losing_trades)) || (botStats && botStats.losingTrades) || 0,
                        winRate: (portfolioStats && (typeof portfolioStats.winRate !== 'undefined' ? portfolioStats.winRate : portfolioStats.win_rate)) || (botStats && botStats.winRate) || 0,
                        grossWins: (portfolioStats && (typeof portfolioStats.grossWins !== 'undefined' ? portfolioStats.grossWins : portfolioStats.gross_wins)) || (botStats && botStats.grossWins) || 0,
                        grossLosses: (portfolioStats && (typeof portfolioStats.grossLosses !== 'undefined' ? portfolioStats.grossLosses : portfolioStats.gross_losses)) || (botStats && botStats.grossLosses) || 0,
                        profitFactor: (portfolioStats && typeof portfolioStats.profitFactor !== 'undefined') ? portfolioStats.profitFactor : (botStats && botStats.profitFactor) || null
                    },
                    positions: {
                        open: openPositions,
                        invested: {
                            longUsd: investedLongBaseUsd,
                            shortUsd: investedShortBaseUsd,
                            totalUsd: investedBaseUsd,
                            withPnl: investedWithPnl,
                            uninvestedUsd: uninvestedUsd,
                            totalValue: totalValue
                        }
                    },
                    stats: portfolioStats,
                    trades: trades,
                    metrics: tradeMetrics
                }
            });
        } catch (error) {
            console.error('Error enviando estado actual:', error);
        }
    }

    handleClientMessage(ws, data) {
        switch (data.type) {
            case 'ping':
                this.sendToClient(ws, { type: 'pong' });
                break;
            
            case 'requestUpdate':
                this.sendCurrentState(ws);
                break;
                
            default:
                console.log('Mensaje no reconocido:', data);
        }
    }

    sendToClient(ws, data) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    broadcast(data) {
        this.clients.forEach(client => {
            this.sendToClient(client, data);
        });
    }

    async broadcastUpdate() {
        try {
            const currentPrice = await this.marketData.getCurrentPrice();
            const marketSignals = this.marketData.getMarketSignals();
            const botStats = await this.tradingBot.getStats();
            const portfolioStats = await this.portfolio.getPortfolioStats(currentPrice?.price || 0);
            const trades = await this.portfolio.getTradeHistory(10);
            // Posiciones abiertas y totales invertido/no invertido
            const openPositions = this.portfolio.openPositions || [];
            const priceNow = currentPrice?.price || 0;
            const investedLongBaseUsd = openPositions
                .filter(p => p.side === 'long')
                .reduce((sum, p) => sum + (p.amountBtc || 0) * (p.entryPrice || priceNow), 0);
            const investedShortBaseUsd = openPositions
                .filter(p => p.side === 'short')
                .reduce((sum, p) => sum + (p.amountBtc || 0) * (p.entryPrice || priceNow), 0);
            const investedBaseUsd = investedLongBaseUsd + investedShortBaseUsd;
            const unrealizedPnL = this.portfolio.getUnrealizedPnL(priceNow) || 0;
            const realizedPnL = (portfolioStats && portfolioStats.realizedPnL) || 0;
            const investedWithPnl = investedBaseUsd + unrealizedPnL;
            const totalValue = (this.portfolio.initialBalance || 0) + realizedPnL + unrealizedPnL;
            let uninvestedUsd = (this.portfolio.initialBalance || 0) - investedBaseUsd;
            if (typeof uninvestedUsd !== 'number' || isNaN(uninvestedUsd) || uninvestedUsd < 0) {
                uninvestedUsd = Math.max(0, this.portfolio.balance || 0);
            }

            // Estruturar signals correctamente para el dashboard (igual que en /api/status)
            const botSignals = {
                signal: marketSignals.signal || 'HOLD',
                confidence: marketSignals.confidence || 0,
                indicators: {
                    rsi: marketSignals.rsi,
                    sma20: marketSignals.sma20,
                    sma50: marketSignals.sma50,
                    macd: marketSignals.macd,
                    bb_upper: marketSignals.bb_upper,
                    bb_lower: marketSignals.bb_lower,
                    stoch: marketSignals.stoch,
                    volume: marketSignals.volume
                }
            };

            // Obtener métricas agregadas desde la BDD para evitar ambigüedad en la UI
            let tradeMetrics = null;
            try {
                if (this.portfolio && this.portfolio.db && typeof this.portfolio.db.getTradeStatistics === 'function') {
                    tradeMetrics = await this.portfolio.db.getTradeStatistics();
                }
            } catch (err) {
                console.warn('No se pudieron obtener métricas de trades desde la DB (broadcast):', err && err.message ? err.message : err);
            }

            const updateData = {
                type: 'update',
                data: {
                    portfolio: portfolioStats,
                    market: currentPrice,
                    bot: {
                        isActive: this.tradingBot.isActive,
                        signals: botSignals,
                        strategy: this.tradingBot.getStrategy(),
                        ...botStats,
                        winningTrades: (portfolioStats && (typeof portfolioStats.winningTrades !== 'undefined' ? portfolioStats.winningTrades : portfolioStats.winning_trades)) || (botStats && botStats.winningTrades) || 0,
                        losingTrades: (portfolioStats && (typeof portfolioStats.losingTrades !== 'undefined' ? portfolioStats.losingTrades : portfolioStats.losing_trades)) || (botStats && botStats.losingTrades) || 0,
                        winRate: (portfolioStats && (typeof portfolioStats.winRate !== 'undefined' ? portfolioStats.winRate : portfolioStats.win_rate)) || (botStats && botStats.winRate) || 0,
                        grossWins: (portfolioStats && (typeof portfolioStats.grossWins !== 'undefined' ? portfolioStats.grossWins : portfolioStats.gross_wins)) || (botStats && botStats.grossWins) || 0,
                        grossLosses: (portfolioStats && (typeof portfolioStats.grossLosses !== 'undefined' ? portfolioStats.grossLosses : portfolioStats.gross_losses)) || (botStats && botStats.grossLosses) || 0,
                        profitFactor: (portfolioStats && typeof portfolioStats.profitFactor !== 'undefined') ? portfolioStats.profitFactor : (botStats && botStats.profitFactor) || null
                    },
                    positions: {
                        open: openPositions,
                        invested: {
                            longUsd: investedLongBaseUsd,
                            shortUsd: investedShortBaseUsd,
                            totalUsd: investedBaseUsd,
                            withPnl: investedWithPnl,
                            uninvestedUsd: uninvestedUsd,
                            totalValue: totalValue
                        }
                    },
                    stats: portfolioStats,
                    trades: trades,
                    metrics: tradeMetrics
                }
            };

            this.broadcast(updateData);
            this.lastBroadcast = new Date();
        } catch (error) {
            console.error('Error broadcasting update:', error);
        }
    }

    logActivity(message, level = 'info') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ${message}`);
        
        // Enviar log a clientes
        this.broadcast({
            type: 'log',
            message: message,
            level: level,
            timestamp: timestamp
        });
    }

    startMarketDataUpdates() {
        // Actualizar datos de mercado cada 1 segundo y broadcastUpdate cuando haya clientes
        cron.schedule('* * * * * *', async () => {
            try {
                if (!this.marketData) return;
                const marketData = await this.marketData.getCurrentPrice();
                // Solo broadcast si hay clientes conectados
                if (this.clients && this.clients.size > 0) {
                    await this.broadcastUpdate();
                }
            } catch (err) {
                console.error('Error en startMarketDataUpdates:', err);
            }
        });

        console.log('⏰ Tareas programadas iniciadas (actualización: 1 segundo via Binance API)');
    }

    async start() {
        try {
            // Inicializar base de datos y portfolio
            console.log('🔄 Inicializando sistema de persistencia...');
            this.portfolio = new Portfolio(10000);
            const dbInitialized = await this.portfolio.initialize();
            
            try {
                if (this.portfolio && this.portfolio.db && this.portfolio.db.events) {
                    this.portfolio.db.events.on('tradeSaved', async (trade) => {
                        // Small debounce could be added if many trades happen quickly
                        try {
                            await this.broadcastUpdate();
                        } catch (err) {
                            console.error('Error broadcasting update after tradeSaved:', err);
                        }
                    });
                }
            } catch (err) {
                console.warn('Could not attach tradeSaved listener:', err.message);
            }

            // Configurar base de datos en MarketData
            this.marketData.setDatabase(this.portfolio.db);

            // Inicializar bot de trading
            this.tradingBot = new TradingBot(this.portfolio, this.marketData);

            // Cargar estrategia guardada en la base de datos (si existe)
            try {
                const botConfig = await this.portfolio.db.getBotConfig();
                if (botConfig && botConfig.trading_strategy) {
                    const loaded = this.tradingBot.setStrategy(botConfig.trading_strategy);
                    if (loaded) {
                        this.logActivity(`🎯 Estrategia cargada desde DB: ${botConfig.trading_strategy}`, 'info');
                    } else {
                        this.logActivity(`⚠️ Estrategia en DB no válida: ${botConfig.trading_strategy}`, 'warning');
                    }
                } else {
                    this.logActivity('ℹ️ No se encontró estrategia en DB, usando por defecto', 'info');
                }

                // Si la configuración en BD indica que el bot debe estar activo, iniciarlo automáticamente
                try {
                    if (botConfig && (botConfig.is_active === 1 || botConfig.is_active === true)) {
                        console.log('🔁 Config DB indica bot activo — iniciando bot automáticamente...');
                        try {
                            const started = await this.tradingBot.start();
                            if (started) {
                                this.isRunning = true;
                                this.logActivity('🤖 Bot iniciado automáticamente (bot_config.is_active)', 'success');
                                // Broadcast para que el frontend se sincronice inmediatamente
                                try { await this.broadcastUpdate(); } catch (bErr) { console.warn('Error broadcasting after auto-start:', bErr && bErr.message ? bErr.message : bErr); }
                            }
                        } catch (startErr) {
                            console.error('Error iniciando bot automáticamente desde config DB:', startErr && startErr.message ? startErr.message : startErr);
                        }
                    }
                } catch (err) {
                    console.warn('Error comprobando auto-start desde botConfig:', err && err.message ? err.message : err);
                }
            } catch (err) {
                console.error('Error cargando estrategia desde DB:', err);
            }

            this.server.listen(this.port, '0.0.0.0', () => {
                console.log(`🌐 Servidor corriendo en http://0.0.0.0:${this.port}`);
                console.log(`🌍 Accesible externamente en http://agubot.ddns.net:${this.port}`);
                console.log(`💰 Capital inicial: $10,000`);
                console.log(`📊 Dashboard disponible en la URL principal`);
                console.log(`🔗 WebSocket habilitado para actualizaciones en tiempo real`);
                console.log(`💾 Sistema de persistencia SQLite activo`);
                
                // Log inicial
                this.logActivity('🚀 AI Trading Simulator iniciado y listo', 'success');
            });
        } catch (error) {
            console.error('❌ Error iniciando servidor:', error);
            process.exit(1);
        }

        // Manejo graceful de cierre
        process.on('SIGINT', async () => {
            console.log('\n🛑 Cerrando servidor...');
            if (this.tradingBot) {
                this.tradingBot.stop();
            }
            if (this.portfolio) {
                await this.portfolio.close();
            }
            this.server.close(() => {
                console.log('✅ Servidor cerrado correctamente');
                process.exit(0);
            });
        });
    }
}

// Crear e iniciar servidor
const server = new AITradingServer();
server.start().catch(error => {
    console.error('❌ Error crítico iniciando servidor:', error);
    process.exit(1);
});