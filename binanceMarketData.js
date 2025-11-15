const axios = require('axios');

class BinanceMarketData {
    constructor(database = null) {
        this.db = database;
        this.binanceURL = 'https://api.binance.com/api/v3';
        this.coinGeckoURL = 'https://api.coingecko.com/api/v3';
        
        // Datos de precio y candles
        this.currentPrice = 0;
        this.priceHistory = [];
        this.candlesCache = {
            '1m': [],
            '5m': [],
            '15m': [],
            '30m': [],
            '1h': []
        };
        
        // Indicadores técnicos
        this.indicators = {
            sma20: [],
            sma50: [],
            rsi: [],
            ema12: [],
            ema26: [],
            macd: [],
            bb_upper: [],
            bb_lower: [],
            volume: [],
            stoch: {
                '5m': {},
                '15m': {},
                '30m': {},
                '60m': {}
            }
        };
        
        this.lastUpdate = null;
        this.lastBinanceUpdate = null;
        this.updateInProgress = false;
    this.lastChange24h = 0; // almacenar último change24h conocido
        
        // Rate limiting interno
        this.requestCount = 0;
        this.requestResetTime = Date.now();
        
        console.log('🔗 Binance Market Data Service inicializado');
    }

    setDatabase(database) {
        this.db = database;
    }

    // Obtener precio actual via Binance WebSocket simulado (o fallback HTTP)
    async getCurrentPrice() {
        if (this.updateInProgress) {
            // Si ya hay una actualización en progreso, devolver el último valor conocido
            return {
                price: this.currentPrice,
                change24h: this.lastChange24h || 0,
                volume: 0,
                timestamp: this.lastUpdate,
                indicators: this.indicators,
                source: 'cache'
            };
        }

        this.updateInProgress = true;
        try {
            // Obtener precio spot actual y cambio 24h desde Binance
            // Try with one retry on transient network issues
            let tickerResponse = null;
            // Try up to 3 attempts with exponential backoff for transient network issues
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    tickerResponse = await axios.get(`${this.binanceURL}/ticker/24hr?symbol=BTCUSDT`, {
                        timeout: 15000
                    });
                    break;
                } catch (err) {
                    console.error(`Attempt ${attempt + 1} error fetching ticker:`, err.message);
                    if (attempt < 2) await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
                }
            }
            if (!tickerResponse) throw new Error('Failed to fetch ticker from Binance after retries');

            const ticker = tickerResponse.data;
            this.currentPrice = parseFloat(ticker.lastPrice);
            this.lastChange24h = parseFloat(ticker.priceChangePercent) || this.lastChange24h;
            this.lastBinanceUpdate = new Date();
            this.lastUpdate = this.lastBinanceUpdate;

            // Obtener candles recientes para los indicadores
            await this.updateCandlesForIndicators();

            // Calcular indicadores técnicos
            this.calculateTechnicalIndicators();

            // Guardar en base de datos - TEMPORALMENTE DESHABILITADO PARA DEBUGGING
            // if (this.db) {
            //     try {
            //         await this.db.saveMarketData({
            //             price: this.currentPrice,
            //             change24h: parseFloat(ticker.priceChangePercent),
            //             volume: parseFloat(ticker.quoteAssetVolume),
            //             indicators: this.indicators,
            //             source: 'binance'
            //         });
            //     } catch (error) {
            //         console.error('Error guardando datos de mercado:', error.message);
            //     }
            // }

            this.updateInProgress = false;
            return {
                price: this.currentPrice,
                change24h: this.lastChange24h,
                volume: parseFloat(ticker.quoteAssetVolume),
                timestamp: this.lastUpdate,
                indicators: this.indicators,
                source: 'binance'
            };
        } catch (error) {
            console.error('❌ Error obteniendo precio de Binance:', error.message);
            this.updateInProgress = false;
            
            // Fallback a CoinGecko
            return await this.getCurrentPriceFallback();
        }
    }

    // Fallback a CoinGecko si Binance falla
    async getCurrentPriceFallback() {
        try {
            console.log('⚠️  Usando fallback CoinGecko...');
            const response = await axios.get(
                `${this.coinGeckoURL}/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`,
                { timeout: 10000 }
            );

            const data = response.data.bitcoin;
            this.currentPrice = data.usd;
            this.lastChange24h = parseFloat(data.usd_24h_change) || this.lastChange24h;
            this.lastUpdate = new Date();

            // Actualizar historial
            this.priceHistory.push({
                timestamp: this.lastUpdate,
                price: this.currentPrice,
                change24h: data.usd_24h_change,
                volume: data.usd_24h_vol
            });

            if (this.priceHistory.length > 1000) {
                this.priceHistory = this.priceHistory.slice(-1000);
            }

            this.calculateTechnicalIndicators();

            return {
                price: this.currentPrice,
                change24h: this.lastChange24h,
                volume: data.usd_24h_vol,
                timestamp: this.lastUpdate,
                indicators: this.indicators,
                source: 'coingecko_fallback'
            };
        } catch (error) {
            console.error('❌ Error en fallback CoinGecko:', error.message);
            
            // Si todo falla, usar último precio conocido o simulado
            if (this.currentPrice === 0) {
                this.currentPrice = 95000 + Math.random() * 5000;
            }

            return {
                price: this.currentPrice,
                change24h: 0,
                volume: 0,
                timestamp: new Date(),
                indicators: this.indicators,
                source: 'simulated'
            };
        }
    }

    // Obtener candles para calcular indicadores por timeframe
    async updateCandlesForIndicators() {
        const timeframes = {
            '15m': '15m',
            '30m': '30m',
            '1h': '1h',
            '5m': '5m'
        };

        for (const [key, interval] of Object.entries(timeframes)) {
            try {
                // Add a single retry for transient errors
                let response = null;
                // Try up to 3 attempts with small exponential backoff
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        response = await axios.get(
                            `${this.binanceURL}/klines?symbol=BTCUSDT&interval=${interval}&limit=100`,
                            { timeout: 15000 }
                        );
                        break;
                    } catch (err) {
                        console.error(`Attempt ${attempt + 1} error fetching candles ${interval}:`, err.message);
                        if (attempt < 2) await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
                    }
                }
                if (!response) {
                    console.error(`Failed to fetch candles for ${interval} after retries`);
                    continue;
                }

                this.candlesCache[key] = response.data.map(candle => ({
                    openTime: candle[0],
                    open: parseFloat(candle[1]),
                    high: parseFloat(candle[2]),
                    low: parseFloat(candle[3]),
                    close: parseFloat(candle[4]),
                    volume: parseFloat(candle[7])
                }));

            } catch (error) {
                console.error(`Error obteniendo candles ${interval}:`, error.message);
            }
        }
    }

    // Calcular indicadores técnicos basados en candles
    calculateTechnicalIndicators() {
        // Usar candles de 15m para calcular indicadores principales
        const candles = this.candlesCache['15m'] || [];
        if (candles.length < 50) {
            // Intentar cargar candles si no hay suficientes
            console.log('📊 No hay suficientes candles, cargando...');
            this.updateCandlesForIndicators().then(() => {
                // Reintentar después de cargar
                const newCandles = this.candlesCache['15m'] || [];
                if (newCandles.length >= 50) {
                    console.log('📊 Candles cargados, calculando indicadores...');
                    this.calculateIndicatorsFromCandles(newCandles);
                }
            }).catch(error => {
                console.error('Error cargando candles:', error.message);
            });
            return;
        }

        this.calculateIndicatorsFromCandles(candles);
    }

    calculateIndicatorsFromCandles(candles) {
        const closes = candles.map(c => c.close);

        // SMA - Guardar como array para compatibilidad
        const sma20 = this.calculateSMA(closes, 20);
        const sma50 = this.calculateSMA(closes, 50);
        this.indicators.sma20 = [sma20];
        this.indicators.sma50 = [sma50];

        // EMA - Guardar como array
        const ema12 = this.calculateEMA(closes, 12);
        const ema26 = this.calculateEMA(closes, 26);
        this.indicators.ema12 = [ema12];
        this.indicators.ema26 = [ema26];

        // RSI - Guardar como array
        const rsi = this.calculateRSI(closes);
        this.indicators.rsi = [rsi];

        // MACD - Guardar como array
        const macd = this.calculateMACD();
        this.indicators.macd = [macd.macd];

        // Bollinger Bands - Guardar como arrays
        const bb = this.calculateBollingerBands(closes, 20, 2);
        this.indicators.bb_upper = [bb.upper];
        this.indicators.bb_lower = [bb.lower];

        // Estocástico para múltiples timeframes
        this.calculateStochastic();
    }

    // Calcular Estocástico para diferentes timeframes
    calculateStochastic() {
        const timeframes = {
            '5m': this.candlesCache['5m'],
            '15m': this.candlesCache['15m'],
            '30m': this.candlesCache['30m'],
            '60m': this.candlesCache['1h']
        };

        for (const [key, candles] of Object.entries(timeframes)) {
            if (!candles || candles.length < 14) continue;

            const closes = candles.map(c => c.close);
            const stoch = this.calculateStochasticValues(closes, 14, 3, 3);
            
            // Calcular señales de cruce
            const crossUp = stoch.kPrev < stoch.dPrev && stoch.k > stoch.d ? true : false;
            const crossDown = stoch.kPrev > stoch.dPrev && stoch.k < stoch.d ? true : false;
            const crossUpFromBottom = crossUp && stoch.kPrev < 20 ? true : false;
            const crossDownFromTop = crossDown && stoch.kPrev > 80 ? true : false;
            
            this.indicators.stoch[key] = {
                k: stoch.k,
                d: stoch.d,
                kPrev: stoch.kPrev,
                dPrev: stoch.dPrev,
                crossUp: crossUp,
                crossDown: crossDown,
                crossUpFromBottom: crossUpFromBottom,
                crossDownFromTop: crossDownFromTop
            };
        }
    }

    // SMA - Simple Moving Average
    calculateSMA(prices, period) {
        if (prices.length < period) return prices[prices.length - 1];
        const slice = prices.slice(-period);
        return slice.reduce((a, b) => a + b, 0) / period;
    }

    // EMA - Exponential Moving Average
    calculateEMA(prices, period) {
        const k = 2 / (period + 1);
        let ema = prices[0];
        for (let i = 1; i < prices.length; i++) {
            ema = prices[i] * k + ema * (1 - k);
        }
        return ema;
    }

    // RSI - Relative Strength Index
    calculateRSI(prices, period = 14) {
        if (prices.length < period + 1) return 50;

        let gains = 0, losses = 0;
        for (let i = prices.length - period; i < prices.length; i++) {
            const diff = prices[i] - prices[i - 1];
            if (diff > 0) gains += diff;
            else losses += Math.abs(diff);
        }

        const avgGain = gains / period;
        const avgLoss = losses / period;
        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));

        return isNaN(rsi) ? 50 : Math.max(0, Math.min(100, rsi));
    }

    // MACD
    calculateMACD() {
        const candles = this.candlesCache['15m'] || [];
        if (candles.length < 26) return { macd: 0, signal: 0, histogram: 0 };

        const closes = candles.map(c => c.close);
        const ema12 = this.calculateEMA(closes, 12);
        const ema26 = this.calculateEMA(closes, 26);
        const macd = ema12 - ema26;
        const signal = this.calculateEMA([macd], 9);

        return {
            macd: macd,
            signal: signal,
            histogram: macd - signal
        };
    }

    // Bollinger Bands
    calculateBollingerBands(prices, period = 20, deviation = 2) {
        if (prices.length < period) {
            return { upper: prices[prices.length - 1], lower: prices[prices.length - 1] };
        }

        const slice = prices.slice(-period);
        const sma = slice.reduce((a, b) => a + b, 0) / period;
        const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
        const stdev = Math.sqrt(variance);

        return {
            upper: sma + (stdev * deviation),
            lower: sma - (stdev * deviation)
        };
    }

    // Estocástico - Calcula K y D
    calculateStochasticValues(prices, period = 14, smoothK = 3, smoothD = 3) {
        if (prices.length < period) {
            return { k: 50, d: 50, kPrev: 50, dPrev: 50 };
        }

        const slice = prices.slice(-period);
        const low = Math.min(...slice);
        const high = Math.max(...slice);
        const current = prices[prices.length - 1];

        const k = ((current - low) / (high - low)) * 100;
        
        // Para D necesitamos más datos
        const kValues = [];
        for (let i = period; i < prices.length; i++) {
            const tempSlice = prices.slice(i - period, i);
            const tempLow = Math.min(...tempSlice);
            const tempHigh = Math.max(...tempSlice);
            const tempK = ((prices[i] - tempLow) / (tempHigh - tempLow)) * 100;
            kValues.push(tempK);
        }

        const dBase = kValues.length >= smoothD ? 
            kValues.slice(-smoothD).reduce((a, b) => a + b, 0) / smoothD : 
            k;

        return {
            k: isNaN(k) ? 50 : Math.max(0, Math.min(100, k)),
            d: isNaN(dBase) ? 50 : Math.max(0, Math.min(100, dBase)),
            kPrev: kValues.length > 1 ? kValues[kValues.length - 2] : k,
            dPrev: kValues.length > smoothD ? kValues.slice(-smoothD - 1, -1).reduce((a, b) => a + b, 0) / smoothD : dBase
        };
    }

    // Obtener señales del mercado (compatible con dashboard)
    getMarketSignals() {
        // Asegurar que los indicadores estén calculados
        this.calculateTechnicalIndicators();
        
        const stoch15m = this.indicators.stoch['15m'] || {};
        const rsi = (this.indicators.rsi && this.indicators.rsi[0]) || 50;
        const sma20 = (this.indicators.sma20 && this.indicators.sma20[0]) || 0;
        const sma50 = (this.indicators.sma50 && this.indicators.sma50[0]) || 0;
        const macd = (this.indicators.macd && this.indicators.macd[0]) || 0;
        const bbUpper = (this.indicators.bb_upper && this.indicators.bb_upper[0]) || 0;
        const bbLower = (this.indicators.bb_lower && this.indicators.bb_lower[0]) || 0;
        const volume = (this.indicators.volume && this.indicators.volume[0]) || 0;
        const stoch = this.indicators.stoch || {};

        let signal = 'HOLD';
        let confidence = 0;
        let reasons = [];

        // Lógica simple de señales
        if (stoch15m.k < 20 && rsi < 30 && sma20 > sma50) {
            signal = 'BUY';
            confidence = 75;
            reasons = ['Estocástico <20', 'RSI <30', 'SMA20 > SMA50'];
        } else if (stoch15m.k > 80 && rsi > 70 && sma20 < sma50) {
            signal = 'SELL';
            confidence = 75;
            reasons = ['Estocástico >80', 'RSI >70', 'SMA20 < SMA50'];
        } else if (stoch15m.k < 50 && rsi < 50) {
            signal = 'BUY';
            confidence = 50;
            reasons = ['Estocástico <50', 'RSI <50'];
        } else if (stoch15m.k > 50 && rsi > 50) {
            signal = 'SELL';
            confidence = 50;
            reasons = ['Estocástico >50', 'RSI >50'];
        } else {
            reasons = ['En espera de señal clara'];
        }

        return {
            signal: signal,
            confidence: confidence,
            reasons: reasons,
            indicators: {
                rsi: rsi,
                sma20: sma20,
                sma50: sma50,
                stoch: stoch,
                macd: macd,
                bb_upper: bbUpper,
                bb_lower: bbLower,
                volume: volume
            }
        };
    }

    // Getter para compatibility
    getStrategy() {
        return 'binance-realtime';
    }
}

module.exports = BinanceMarketData;
