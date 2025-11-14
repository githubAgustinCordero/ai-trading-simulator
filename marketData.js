const axios = require('axios');

class MarketDataService {
    constructor(database = null) {
        this.db = database;
        this.baseURL = 'https://api.coingecko.com/api/v3';
        this.currentPrice = 0;
        this.priceHistory = [];
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
        
        // Generar datos iniciales para desarrollo
        this.generateInitialHistoricalData();
        // Calcular indicadores con los datos iniciales
        this.calculateTechnicalIndicators();
    }

    // Configurar base de datos
    setDatabase(database) {
        this.db = database;
    }

    // Obtener precio actual de Bitcoin
    async getCurrentPrice() {
        try {
            const response = await axios.get(`${this.baseURL}/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`);
            const data = response.data.bitcoin;
            
            this.currentPrice = data.usd;
            this.lastUpdate = new Date();
            
            // Añadir a historial
            this.priceHistory.push({
                timestamp: this.lastUpdate,
                price: this.currentPrice,
                change24h: data.usd_24h_change,
                volume: data.usd_24h_vol
            });

            // Mantener solo los últimos 1000 puntos
            if (this.priceHistory.length > 1000) {
                this.priceHistory = this.priceHistory.slice(-1000);
            }

            // Calcular indicadores técnicos
            this.calculateTechnicalIndicators();

            // Guardar en base de datos si está disponible
            if (this.db) {
                try {
                    await this.db.saveMarketData({
                        price: this.currentPrice,
                        change24h: data.usd_24h_change,
                        volume: data.usd_24h_vol,
                        indicators: this.indicators
                    });
                } catch (error) {
                    console.error('Error guardando datos de mercado:', error);
                }
            }

            return {
                price: this.currentPrice,
                change24h: data.usd_24h_change,
                volume: data.usd_24h_vol,
                timestamp: this.lastUpdate,
                indicators: this.indicators
            };
        } catch (error) {
            console.error('Error obteniendo precio:', error.message);
            
            // Fallback: Generar datos simulados para desarrollo
            return this.generateSimulatedPrice();
        }
    }

    // Generar datos de precio simulados cuando la API falla
    generateSimulatedPrice() {
        const now = new Date();
        
        // Si no hay precio anterior, generar datos históricos iniciales
        if (this.currentPrice === 0 || this.priceHistory.length < 50) {
            this.generateInitialHistoricalData();
        }
        
        // Simular variación realista (±0.1% por llamada)
        const variation = (Math.random() - 0.5) * 0.002; // ±0.1%
        this.currentPrice = this.currentPrice * (1 + variation);
        
        this.lastUpdate = now;
        
        // Añadir a historial
        this.priceHistory.push({
            timestamp: now,
            price: this.currentPrice,
            change24h: (Math.random() - 0.5) * 10, // Cambio 24h simulado
            volume: 50000000000 + Math.random() * 20000000000 // Volumen simulado
        });

        // Mantener solo los últimos 1000 puntos
        if (this.priceHistory.length > 1000) {
            this.priceHistory = this.priceHistory.slice(-1000);
        }

        // Calcular indicadores técnicos con datos simulados
        this.calculateTechnicalIndicators();

        console.log(`📊 Datos simulados generados - Precio: $${this.currentPrice.toFixed(2)}, Historial: ${this.priceHistory.length} puntos`);

        return {
            price: this.currentPrice,
            change24h: this.priceHistory[this.priceHistory.length - 1].change24h,
            volume: this.priceHistory[this.priceHistory.length - 1].volume,
            timestamp: this.lastUpdate,
            indicators: this.indicators
        };
    }

    // Generar datos históricos iniciales para calcular indicadores
    generateInitialHistoricalData() {
        console.log('📈 Generando datos históricos iniciales...');
        const basePrice = 110000;
        const now = new Date();
        
        // Generar 3000 puntos de datos históricos (~50 horas) para tener suficientes datos para todos los timeframes
        for (let i = 2999; i >= 0; i--) {
            const timestamp = new Date(now.getTime() - (i * 60 * 1000)); // 1 minuto por punto
            const variation = (Math.random() - 0.5) * 0.01; // ±1% de variación
            const price = basePrice * (1 + variation * (i / 100)); // Tendencia ligeramente alcista
            
            this.priceHistory.push({
                timestamp: timestamp,
                price: price,
                change24h: (Math.random() - 0.5) * 5,
                volume: 40000000000 + Math.random() * 20000000000
            });
        }
        
        this.currentPrice = this.priceHistory[this.priceHistory.length - 1].price;
        console.log(`✅ Generados ${this.priceHistory.length} puntos históricos iniciales`);
    }

    // Configurar base de datos
    setDatabase(database) {
        this.db = database;
    }

    // Obtener datos históricos para análisis
    async getHistoricalData(days = 30) {
        try {
            const response = await axios.get(`${this.baseURL}/coins/bitcoin/market_chart?vs_currency=usd&days=${days}&interval=hourly`);
            const prices = response.data.prices;
            
            return prices.map(([timestamp, price]) => ({
                timestamp: new Date(timestamp),
                price: price
            }));
        } catch (error) {
            console.error('Error obteniendo datos históricos:', error.message);
            return [];
        }
    }

    // Calcular indicadores técnicos
    calculateTechnicalIndicators() {
        if (this.priceHistory.length < 50) return;

        const prices = this.priceHistory.map(h => h.price);
        const volumes = this.priceHistory.map(h => h.volume || 0);

        // SMA (Simple Moving Average)
        this.indicators.sma20 = this.calculateSMA(prices, 20);
        this.indicators.sma50 = this.calculateSMA(prices, 50);

        // EMA (Exponential Moving Average)
        this.indicators.ema12 = this.calculateEMA(prices, 12);
        this.indicators.ema26 = this.calculateEMA(prices, 26);

        // RSI (Relative Strength Index)
        this.indicators.rsi = this.calculateRSI(prices);

        // MACD
        this.indicators.macd = this.calculateMACD();

        // Bollinger Bands
        const bb = this.calculateBollingerBands(prices);
        this.indicators.bb_upper = bb.upper;
        this.indicators.bb_lower = bb.lower;

        this.indicators.volume = volumes;

                        // Calcular Estocástico multi-timeframe (5m, 15m, 30m, 60m) con parámetros 14,3,3 (más realista)
        try {
            const tfList = [5, 15, 30, 60];
            for (const tf of tfList) {
                const bars = this.aggregateBars(tf);
                const stoch = this.calculateStochastic(bars, 14, 3, 3); // Período 14 en lugar de 34
                this.indicators.stoch[`${tf}m`] = stoch;
            }
        } catch (e) {
            console.error('❌ Error calculando estocásticos:', e);
        }
    }

    // Calcular SMA
    calculateSMA(prices, period) {
        const sma = [];
        for (let i = period - 1; i < prices.length; i++) {
            const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
            sma.push(sum / period);
        }
        return sma;
    }

    // Calcular EMA
    calculateEMA(prices, period) {
        const ema = [];
        const multiplier = 2 / (period + 1);
        
        ema[0] = prices[0];
        for (let i = 1; i < prices.length; i++) {
            ema[i] = (prices[i] * multiplier) + (ema[i - 1] * (1 - multiplier));
        }
        return ema;
    }

    // Calcular RSI
    calculateRSI(prices, period = 14) {
        const changes = [];
        for (let i = 1; i < prices.length; i++) {
            changes.push(prices[i] - prices[i - 1]);
        }

        const rsi = [];
        for (let i = period; i < changes.length; i++) {
            const recentChanges = changes.slice(i - period, i);
            const gains = recentChanges.filter(c => c > 0);
            const losses = recentChanges.filter(c => c < 0).map(c => Math.abs(c));
            
            const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
            const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;
            
            const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            const rsiValue = 100 - (100 / (1 + rs));
            rsi.push(rsiValue);
        }
        return rsi;
    }

    // Calcular MACD
    calculateMACD() {
        if (this.indicators.ema12.length === 0 || this.indicators.ema26.length === 0) return [];
        
        const macd = [];
        const minLength = Math.min(this.indicators.ema12.length, this.indicators.ema26.length);
        
        for (let i = 0; i < minLength; i++) {
            macd.push(this.indicators.ema12[i] - this.indicators.ema26[i]);
        }
        return macd;
    }

    // Calcular Bollinger Bands
    calculateBollingerBands(prices, period = 20, stdDev = 2) {
        const sma = this.calculateSMA(prices, period);
        const upper = [];
        const lower = [];

        for (let i = 0; i < sma.length; i++) {
            const dataIndex = i + period - 1;
            const relevantPrices = prices.slice(dataIndex - period + 1, dataIndex + 1);
            
            const variance = relevantPrices.reduce((sum, price) => {
                return sum + Math.pow(price - sma[i], 2);
            }, 0) / period;
            
            const standardDeviation = Math.sqrt(variance);
            
            upper.push(sma[i] + (standardDeviation * stdDev));
            lower.push(sma[i] - (standardDeviation * stdDev));
        }

        return { upper, lower };
    }

    // Obtener señales de trading basadas en indicadores
    getMarketSignals() {
        if (this.priceHistory.length < 50) {
            return { signal: 'HOLD', confidence: 0, reasons: ['Insuficientes datos históricos'] };
        }

        const signals = [];
        const reasons = [];
        let confidence = 0;

        const currentPrice = this.currentPrice;
        const sma20 = this.indicators.sma20.slice(-1)[0];
        const sma50 = this.indicators.sma50.slice(-1)[0];
        const rsi = this.indicators.rsi.slice(-1)[0];
        const macd = this.indicators.macd.slice(-1)[0];
        const prevMACD = this.indicators.macd.slice(-2)[0];

        // Señal de SMA
        if (currentPrice > sma20 && sma20 > sma50) {
            signals.push('BUY');
            reasons.push('Precio por encima de SMA20 y SMA50');
            confidence += 20;
        } else if (currentPrice < sma20 && sma20 < sma50) {
            signals.push('SELL');
            reasons.push('Precio por debajo de SMA20 y SMA50');
            confidence += 20;
        }

        // Señal de RSI
        if (rsi < 30) {
            signals.push('BUY');
            reasons.push(`RSI sobreventa (${rsi.toFixed(2)})`);
            confidence += 25;
        } else if (rsi > 70) {
            signals.push('SELL');
            reasons.push(`RSI sobrecompra (${rsi.toFixed(2)})`);
            confidence += 25;
        }

        // Señal de MACD
        if (macd > prevMACD && macd > 0) {
            signals.push('BUY');
            reasons.push('MACD cruzando al alza');
            confidence += 15;
        } else if (macd < prevMACD && macd < 0) {
            signals.push('SELL');
            reasons.push('MACD cruzando a la baja');
            confidence += 15;
        }

        // Determinar señal final
        const buySignals = signals.filter(s => s === 'BUY').length;
        const sellSignals = signals.filter(s => s === 'SELL').length;

        let finalSignal = 'HOLD';
        if (buySignals > sellSignals && confidence > 30) {
            finalSignal = 'BUY';
        } else if (sellSignals > buySignals && confidence > 30) {
            finalSignal = 'SELL';
        }

        // Preparar estocástico multi-timeframe para exponer a estrategias
        const stochSignals = this.getStochasticSignals();

        return {
            signal: finalSignal,
            confidence: Math.min(confidence, 100),
            reasons: reasons,
            indicators: {
                price: currentPrice,
                sma20: sma20,
                sma50: sma50,
                rsi: rsi,
                macd: macd,
                stoch: stochSignals
            }
        };
    }

    // --- Utilidades de Estocástico y agregación ---
    // Agregar ticks a velas de N minutos con high/low/close
    aggregateBars(tfMinutes = 5) {
        const ms = tfMinutes * 60 * 1000;
        const buckets = new Map();
        for (const p of this.priceHistory) {
            const t = p.timestamp instanceof Date ? p.timestamp.getTime() : new Date(p.timestamp).getTime();
            const key = Math.floor(t / ms) * ms;
            const price = p.price;
            if (!buckets.has(key)) {
                buckets.set(key, { time: new Date(key), open: price, high: price, low: price, close: price });
            } else {
                const b = buckets.get(key);
                b.high = Math.max(b.high, price);
                b.low = Math.min(b.low, price);
                b.close = price;
            }
        }
        // Ordenar por tiempo ascendente y devolver array
        return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
    }

    // Calcular Estocástico %K y %D con periodo y suavizados
    calculateStochastic(bars, period = 34, smoothK = 3, smoothD = 3) {
        if (!bars || bars.length < period + smoothK + smoothD - 2) {
            console.log(`⚠️ Datos insuficientes para estocástico: ${bars?.length} barras, necesarias: ${period + smoothK + smoothD - 2}`);
            return {};
        }
        const closes = bars.map(b => b.close);
        const highs = bars.map(b => b.high);
        const lows = bars.map(b => b.low);

        const rawK = [];
        for (let i = period - 1; i < closes.length; i++) {
            const windowHigh = Math.max(...highs.slice(i - period + 1, i + 1));
            const windowLow = Math.min(...lows.slice(i - period + 1, i + 1));
            const c = closes[i];
            const denom = (windowHigh - windowLow) || 1; // evitar división por cero
            const k = ((c - windowLow) / denom) * 100;
            rawK.push(k);
        }
        const kSmooth = this.simpleMA(rawK, smoothK);
        const dSmooth = this.simpleMA(kSmooth, smoothD);

        const kLast = kSmooth.length > 0 ? kSmooth[kSmooth.length - 1] : null;
        const dLast = dSmooth.length > 0 ? dSmooth[dSmooth.length - 1] : null;
        const kPrev = kSmooth.length > 1 ? kSmooth[kSmooth.length - 2] : null;
        const dPrev = dSmooth.length > 1 ? dSmooth[dSmooth.length - 2] : null;

        const crossUpFromBottom = (kPrev !== null && dPrev !== null && kLast !== null && dLast !== null
            && kPrev <= dPrev && kLast > dLast && Math.max(kPrev, dPrev) < 20);
        const crossDownFromTop = (kPrev !== null && dPrev !== null && kLast !== null && dLast !== null
            && kPrev >= dPrev && kLast < dLast && Math.min(kPrev, dPrev) > 80);
        const overbought = (kLast !== null && dLast !== null && kLast > 85 && dLast > 85);
        const oversold = (kLast !== null && dLast !== null && kLast < 15 && dLast < 15);

        return {
            k: kLast,
            d: dLast,
            kPrev,
            dPrev,
            crossUpFromBottom,
            crossDownFromTop,
            overbought,
            oversold
        };
    }

    simpleMA(series, period) {
        if (!series || series.length < period) return [];
        const out = [];
        for (let i = period - 1; i < series.length; i++) {
            const slice = series.slice(i - period + 1, i + 1);
            out.push(slice.reduce((a, b) => a + b, 0) / period);
        }
        return out;
    }

    getStochasticSignals() {
        const tfList = [5, 15, 30, 60]; // Añadido 60m para 1 hora
        const result = {};
        for (const tf of tfList) {
            const bars = this.aggregateBars(tf);
            result[`${tf}m`] = this.calculateStochastic(bars, 14, 3, 3); // Período 14
        }
        return result;
    }
}

module.exports = MarketDataService;