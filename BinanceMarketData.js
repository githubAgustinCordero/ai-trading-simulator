const axios = require('axios');
const { safeNum } = require('./lib/utils');

class BinanceMarketData {
    constructor() {
        this.binanceURL = 'https://api.binance.com/api/v3';
        this.coingeckoURL = 'https://api.coingecko.com/api/v3';
        this.symbol = 'BTCUSDT';
        
        this.currentPrice = 0;
        this.priceHistory = [];
        this.lastUpdate = null;
        
        // Caché para ticker 24h - SE ACTUALIZA CADA 30 MINUTOS (no es crítico)
        this.ticker24h = {
            lastPrice: 109000,
            priceChangePercent: -0.5, // Valor por defecto, será actualizado desde API
            quoteAssetVolume: 40000000000
        }; // Inicializar con valores por defecto
        this.ticker24hTimestamp = 0;
        this.tickerCacheDuration = 30 * 60 * 1000; // 30 minutos - evita rate limits
        
        // Caché para candles por timeframe - se actualiza cada 2 minutos
        this.candleCache = {
            '1m': [],
            '5m': [],
            '15m': [],
            '30m': [],
            '1h': []
        };
        this.candleCacheTimestamp = 0;
        this.candleCacheDuration = 2 * 60 * 1000; // 2 minutos para todos los timeframes
        
        this.indicators = {
            sma20: 0,
            sma50: 0,
            rsi: 0,
            ema12: 0,
            ema26: 0,
            macd: { macd: 0, signal: 0, histogram: 0 },
            bb_upper: 0,
            bb_lower: 0,
            volume: 0,
            stoch: {
                '5m': { k: 0, d: 0, kPrev: 0 },
                '15m': { k: 0, d: 0, kPrev: 0 },
                '30m': { k: 0, d: 0, kPrev: 0 },
                '60m': { k: 0, d: 0, kPrev: 0 }
            }
        };
    }

    // Obtener precio actual - Estrategia: Cachear cambio24h por 30 minutos
    async getCurrentPrice() {
        try {
            const now = Date.now();
            const shouldUpdate = (now - this.ticker24hTimestamp) > this.tickerCacheDuration;
            
            // Solo consultar API cada 30 minutos
            if (shouldUpdate) {
                console.log('🔄 [BinanceMarketData] Actualizando cambio24h desde CoinGecko...');
                // Try up to 3 attempts for CoinGecko with increased timeout
                let response = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        response = await axios.get(
                            `${this.coingeckoURL}/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`,
                            { timeout: 15000 }
                        );
                        break;
                    } catch (err) {
                        console.error(`Attempt ${attempt + 1} error fetching coingecko ticker:`, err.message);
                        if (attempt < 2) await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
                    }
                }
                if (!response) throw new Error('Failed to fetch coingecko ticker after retries');
                
                const data = response.data.bitcoin;
                this.ticker24h = {
                    lastPrice: data.usd,
                    priceChangePercent: data.usd_24h_change,
                    quoteAssetVolume: data.usd_24h_vol
                };
                this.ticker24hTimestamp = now;
                console.log(`✅ [BinanceMarketData] Actualizado: Cambio24h = ${data.usd_24h_change}%`);
            }
            
            // Usar datos cacheados (cada segundo simplemente devolvemos el caché)
            const tickerData = this.ticker24h;
            this.currentPrice = safeNum(parseFloat(tickerData.lastPrice), 109000);
            this.lastUpdate = new Date();
            
            const change24h = safeNum(parseFloat(tickerData.priceChangePercent), 0);
            const volume24h = safeNum(parseFloat(tickerData.quoteAssetVolume), 40000000000);
            
            // Agregar al historial
            this.priceHistory.push({
                timestamp: this.lastUpdate,
                price: this.currentPrice,
                change24h: change24h,
                volume: volume24h
            });
            
            // Mantener últimos 1000 puntos
            if (this.priceHistory.length > 1000) {
                this.priceHistory = this.priceHistory.slice(-1000);
            }
            
            // Actualizar candles e indicadores (también cacheados)
            await this.updateCandles();
            this.calculateTechnicalIndicators();
            
            return {
                price: this.currentPrice,
                change24h: change24h,
                volume: volume24h,
                timestamp: this.lastUpdate,
                indicators: this.indicators
            };
        } catch (error) {
            console.error('❌ [BinanceMarketData] Error en getCurrentPrice:', error.message);
            
            // Si falla, devolver el último caché que tenemos
            const tickerData = this.ticker24h;
            const change24h = safeNum(parseFloat(tickerData.priceChangePercent), 0);
            const volume24h = safeNum(parseFloat(tickerData.quoteAssetVolume), 40000000000);
            
            console.log(`💾 [BinanceMarketData] Caché devuelto: change24h=${change24h}`);
            
            return {
                price: this.currentPrice,
                change24h: change24h,
                volume: volume24h,
                timestamp: this.lastUpdate,
                indicators: this.indicators,
                source: 'cached'
            };
        }
    }

    // Fallback a CoinGecko si Binance falla
    
    // Actualizar candles de todos los timeframes (CON CACHÉ PARA EVITAR 429)
    async updateCandles() {
        try {
            const now = Date.now();
            
            // Actualizar candles solo cada 2 minutos para evitar rate limits
            const shouldUpdate = (now - this.candleCacheTimestamp) > this.candleCacheDuration;
            
            if (!shouldUpdate && Object.values(this.candleCache).some(c => c.length > 0)) {
                return; // Usar caché actual
            }
            
            const timeframes = ['5m', '15m', '30m', '1h']; // Principales timeframes
            
            for (const tf of timeframes) {
                try {
                    // Try up to 3 attempts for candles with exponential backoff
                    let response = null;
                    for (let attempt = 0; attempt < 3; attempt++) {
                        try {
                            response = await axios.get(`${this.binanceURL}/klines?symbol=${this.symbol}&interval=${tf}&limit=100`, {
                                timeout: 15000
                            });
                            break;
                        } catch (err) {
                            console.error(`Attempt ${attempt + 1} error fetching candles ${tf}:`, err.message);
                            if (attempt < 2) await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
                        }
                    }
                    if (!response) {
                        console.error(`Failed to fetch candles for ${tf} after retries`);
                        continue;
                    }
                    
                    this.candleCache[tf] = response.data.map(candle => ({
                        timestamp: new Date(candle[0]),
                        open: parseFloat(candle[1]),
                        high: parseFloat(candle[2]),
                        low: parseFloat(candle[3]),
                        close: parseFloat(candle[4]),
                        volume: parseFloat(candle[7])
                    }));
                    
                } catch (error) {
                    if (error.response?.status !== 429) {
                        console.error(`⚠️  Error actualizando candles ${tf}:`, error.message);
                    }
                }
            }
            
            this.candleCacheTimestamp = now;
            
        } catch (error) {
            console.error('❌ Error en updateCandles:', error.message);
        }
    }

    // Calcular indicadores técnicos
    calculateTechnicalIndicators() {
        try {
            if (this.priceHistory.length < 50) return;
            
            const prices = this.priceHistory.map(h => h.price);
            const volumes = this.priceHistory.map(h => h.volume || 0);
            
            // SMA
            this.indicators.sma20 = this.calculateSMA(prices, 20);
            this.indicators.sma50 = this.calculateSMA(prices, 50);
            
            // EMA
            this.indicators.ema12 = this.calculateEMA(prices, 12);
            this.indicators.ema26 = this.calculateEMA(prices, 26);
            
            // RSI
            this.indicators.rsi = this.calculateRSI(prices);
            
            // MACD
            this.indicators.macd = this.calculateMACD(prices);
            
            // Bandas de Bollinger
            const bb = this.calculateBollingerBands(prices);
            this.indicators.bb_upper = bb.upper;
            this.indicators.bb_lower = bb.lower;
            
            // Volumen actual
            this.indicators.volume = volumes[volumes.length - 1] || 0;
            
            // Estocástico para múltiples timeframes
            this.updateStochasticsForTimeframes();
            
        } catch (error) {
            console.error('❌ Error calculando indicadores:', error.message);
        }
    }

    // Actualizar Estocástico para cada timeframe
    updateStochasticsForTimeframes() {
        const timeframes = ['5m', '15m', '30m', '1h'];
        
        for (const tf of timeframes) {
            if (this.candleCache[tf].length >= 14) {
                const closes = this.candleCache[tf].map(c => c.close);
                const stoch = this.calculateStochastic(closes, 14, 3, 3);
                
                // Guardar valor anterior de K para detectar cruces
                const prevK = this.indicators.stoch[tf].k;
                
                this.indicators.stoch[tf] = {
                    k: stoch.k,
                    d: stoch.d,
                    kPrev: prevK
                };
            }
        }
    }

    // Calcular SMA
    calculateSMA(prices, period) {
        if (prices.length < period) return prices[prices.length - 1];
        
        const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
        return sum / period;
    }

    // Calcular EMA
    calculateEMA(prices, period) {
        if (prices.length < period) return prices[prices.length - 1];
        
        const k = 2 / (period + 1);
        let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;
        
        for (let i = period; i < prices.length; i++) {
            ema = prices[i] * k + ema * (1 - k);
        }
        
        return ema;
    }

    // Calcular RSI
    calculateRSI(prices, period = 14) {
        if (prices.length < period + 1) return 50;
        
        let gains = 0, losses = 0;
        
        for (let i = prices.length - period; i < prices.length; i++) {
            const change = prices[i] - prices[i - 1];
            if (change > 0) gains += change;
            else losses += Math.abs(change);
        }
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        
        return Math.min(100, Math.max(0, rsi));
    }

    // Calcular MACD
    calculateMACD(prices) {
        const ema12 = this.calculateEMA(prices, 12);
        const ema26 = this.calculateEMA(prices, 26);
        const macdLine = ema12 - ema26;
        
        // Calcular signal line (EMA 9 del MACD)
        let macdValues = [];
        const k = 2 / 27;
        let ema9 = 0;
        
        for (let i = prices.length - 25; i < prices.length; i++) {
            const temp12 = this.calculateEMA(prices.slice(0, i + 1), 12);
            const temp26 = this.calculateEMA(prices.slice(0, i + 1), 26);
            macdValues.push(temp12 - temp26);
        }
        
        if (macdValues.length > 0) {
            ema9 = macdValues[0];
            for (let i = 1; i < macdValues.length; i++) {
                ema9 = macdValues[i] * k + ema9 * (1 - k);
            }
        }
        
        return {
            macd: macdLine,
            signal: ema9,
            histogram: macdLine - ema9
        };
    }

    // Calcular Bandas de Bollinger
    calculateBollingerBands(prices, period = 20, stdDev = 2) {
        if (prices.length < period) {
            return { upper: prices[prices.length - 1], lower: prices[prices.length - 1] };
        }
        
        const recentPrices = prices.slice(-period);
        const sma = recentPrices.reduce((a, b) => a + b) / period;
        
        const variance = recentPrices.reduce((sum, price) => {
            return sum + Math.pow(price - sma, 2);
        }, 0) / period;
        
        const std = Math.sqrt(variance);
        
        return {
            upper: sma + std * stdDev,
            lower: sma - std * stdDev
        };
    }

    // Calcular Estocástico
    calculateStochastic(closes, period = 14, smoothK = 3, smoothD = 3) {
        if (closes.length < period) {
            return { k: 50, d: 50 };
        }
        
        const recentCloses = closes.slice(-period);
        const low = Math.min(...recentCloses);
        const high = Math.max(...recentCloses);
        
        if (high === low) {
            return { k: 50, d: 50 };
        }
        
        const k = ((closes[closes.length - 1] - low) / (high - low)) * 100;
        
        // Suavizar K
        let kValues = [];
        for (let i = Math.max(0, closes.length - period - smoothK + 1); i < closes.length; i++) {
            const tempClose = closes.slice(Math.max(0, i - period + 1), i + 1);
            const tempLow = Math.min(...tempClose);
            const tempHigh = Math.max(...tempClose);
            
            if (tempHigh !== tempLow) {
                kValues.push(((closes[i] - tempLow) / (tempHigh - tempLow)) * 100);
            }
        }
        
        const smoothedK = kValues.length >= smoothK 
            ? kValues.slice(-smoothK).reduce((a, b) => a + b) / smoothK 
            : k;
        
        // D = SMA de K
        const d = smoothedK;
        
        return {
            k: Math.min(100, Math.max(0, smoothedK)),
            d: Math.min(100, Math.max(0, d))
        };
    }

    // Obtener señales del mercado
    getMarketSignals() {
        return {
            rsi: this.indicators.rsi,
            sma20: this.indicators.sma20,
            sma50: this.indicators.sma50,
            macd: this.indicators.macd,
            bb_upper: this.indicators.bb_upper,
            bb_lower: this.indicators.bb_lower,
            stoch: this.indicators.stoch,
            volume: this.indicators.volume,
            currentPrice: this.currentPrice
        };
    }

    // Generar datos simulados como último recurso
    generateSimulatedData() {
        const now = new Date();
        const randomChange = (Math.random() - 0.5) * 100;
        this.currentPrice = Math.max(30000, this.currentPrice + randomChange);
        
        this.priceHistory.push({
            timestamp: now,
            price: this.currentPrice,
            change24h: (Math.random() - 0.5) * 5,
            volume: 40000000000 + Math.random() * 20000000000
        });
        
        if (this.priceHistory.length > 1000) {
            this.priceHistory = this.priceHistory.slice(-1000);
        }
        
        this.calculateTechnicalIndicators();
        
        return {
            price: this.currentPrice,
            change24h: (Math.random() - 0.5) * 5,
            volume: 40000000000,
            timestamp: now,
            indicators: this.indicators,
            source: 'simulated'
        };
    }
}

module.exports = BinanceMarketData;
