const fs = require('fs-extra');
const path = require('path');

class Portfolio {
    constructor(initialBalance = 10000) {
        this.initialBalance = initialBalance;
        this.balance = initialBalance; // USD disponible
        this.btcAmount = 0; // Cantidad de BTC en posesión
        this.trades = []; // Historial de operaciones
        this.dataFile = path.join(__dirname, 'data', 'portfolio.json');
        this.startDate = new Date();
        
        // Crear directorio de datos si no existe
        this.ensureDataDirectory();
        
        // Cargar datos previos si existen
        this.loadPortfolio();
    }

    // Asegurar que el directorio de datos existe
    async ensureDataDirectory() {
        const dataDir = path.dirname(this.dataFile);
        await fs.ensureDir(dataDir);
    }

    // Cargar portafolio desde archivo
    async loadPortfolio() {
        try {
            if (await fs.pathExists(this.dataFile)) {
                const data = await fs.readJson(this.dataFile);
                this.balance = data.balance || this.initialBalance;
                this.btcAmount = data.btcAmount || 0;
                this.trades = data.trades || [];
                this.startDate = new Date(data.startDate) || new Date();
                console.log('📂 Portafolio cargado desde archivo');
            } else {
                console.log('🆕 Creando nuevo portafolio');
                await this.savePortfolio();
            }
        } catch (error) {
            console.error('Error cargando portafolio:', error.message);
            // Si hay error, reiniciar con valores por defecto
            this.resetPortfolio();
        }
    }

    // Guardar portafolio en archivo
    async savePortfolio() {
        try {
            await this.ensureDataDirectory();
            const data = {
                balance: this.balance,
                btcAmount: this.btcAmount,
                trades: this.trades,
                startDate: this.startDate,
                lastUpdate: new Date()
            };
            await fs.writeJson(this.dataFile, data, { spaces: 2 });
        } catch (error) {
            console.error('Error guardando portafolio:', error.message);
        }
    }

    // Ejecutar operación de trading
    async executeTrade(trade) {
        try {
            if (trade.type === 'BUY') {
                return await this.executeBuy(trade);
            } else if (trade.type === 'SELL') {
                return await this.executeSell(trade);
            }
            return false;
        } catch (error) {
            console.error('Error ejecutando operación:', error.message);
            return false;
        }
    }

    // Ejecutar compra
    async executeBuy(trade) {
        const totalCost = trade.usdAmount + trade.fee;
        
        // Verificar si tenemos suficiente balance
        if (this.balance < totalCost) {
            console.log('❌ Balance insuficiente para compra');
            return false;
        }

        // Ejecutar la compra
        this.balance -= totalCost;
        this.btcAmount += trade.amount;
        
        // Añadir al historial
        trade.id = this.generateTradeId();
        trade.balanceAfter = this.balance;
        trade.btcAfter = this.btcAmount;
        this.trades.push(trade);

        // Guardar cambios
        await this.savePortfolio();
        
        console.log(`💰 Balance restante: $${this.balance.toFixed(2)}`);
        console.log(`₿ BTC total: ${this.btcAmount.toFixed(8)}`);
        
        return true;
    }

    // Ejecutar venta
    async executeSell(trade) {
        // Verificar si tenemos suficiente BTC
        if (this.btcAmount < trade.amount) {
            console.log('❌ BTC insuficiente para venta');
            return false;
        }

        // Ejecutar la venta
        const netAmount = trade.usdAmount - trade.fee;
        this.btcAmount -= trade.amount;
        this.balance += netAmount;
        
        // Añadir al historial
        trade.id = this.generateTradeId();
        trade.balanceAfter = this.balance;
        trade.btcAfter = this.btcAmount;
        this.trades.push(trade);

        // Guardar cambios
        await this.savePortfolio();
        
        console.log(`💰 Balance actual: $${this.balance.toFixed(2)}`);
        console.log(`₿ BTC restante: ${this.btcAmount.toFixed(8)}`);
        
        return true;
    }

    // Obtener valor total del portafolio
    getTotalValue(currentBtcPrice = 0) {
        const btcValue = this.btcAmount * currentBtcPrice;
        return this.balance + btcValue;
    }

    // Obtener rendimiento total
    getTotalReturn(currentBtcPrice = 0) {
        const currentValue = this.getTotalValue(currentBtcPrice);
        return ((currentValue - this.initialBalance) / this.initialBalance) * 100;
    }

    // Obtener PnL no realizado
    getUnrealizedPnL(currentBtcPrice) {
        if (this.btcAmount === 0) return 0;
        
        const lastBuyTrade = this.getLastBuyTrade();
        if (!lastBuyTrade) return 0;
        
        const currentValue = this.btcAmount * currentBtcPrice;
        const costBasis = lastBuyTrade.usdAmount;
        
        return currentValue - costBasis;
    }

    // Obtener última operación de compra
    getLastBuyTrade() {
        for (let i = this.trades.length - 1; i >= 0; i--) {
            if (this.trades[i].type === 'BUY') {
                return this.trades[i];
            }
        }
        return null;
    }

    // Obtener historial de operaciones
    getTradeHistory(limit = null) {
        if (limit) {
            return this.trades.slice(-limit);
        }
        return [...this.trades];
    }

    // Obtener estadísticas detalladas
    getDetailedStats(currentBtcPrice = 0) {
        const totalValue = this.getTotalValue(currentBtcPrice);
        const totalReturn = this.getTotalReturn(currentBtcPrice);
        const unrealizedPnL = this.getUnrealizedPnL(currentBtcPrice);
        
        // Calcular estadísticas de trading
        const buyTrades = this.trades.filter(t => t.type === 'BUY');
        const sellTrades = this.trades.filter(t => t.type === 'SELL');
        
        let totalFees = 0;
        let realizedPnL = 0;
        
        this.trades.forEach(trade => {
            totalFees += trade.fee || 0;
            
            if (trade.type === 'SELL') {
                // Calcular PnL realizado aproximado
                const avgBuyPrice = this.calculateAverageBuyPrice(trade.timestamp);
                if (avgBuyPrice > 0) {
                    realizedPnL += (trade.price - avgBuyPrice) * trade.amount;
                }
            }
        });

        // Calcular drawdown máximo
        const maxDrawdown = this.calculateMaxDrawdown(currentBtcPrice);
        
        // Calcular ratio de Sharpe aproximado
        const sharpeRatio = this.calculateSharpeRatio();

        return {
            // Valores actuales
            balance: this.balance,
            btcAmount: this.btcAmount,
            totalValue: totalValue,
            initialBalance: this.initialBalance,
            
            // Rendimiento
            totalReturn: totalReturn,
            realizedPnL: realizedPnL,
            unrealizedPnL: unrealizedPnL,
            totalFees: totalFees,
            
            // Estadísticas de trading
            totalTrades: this.trades.length,
            buyTrades: buyTrades.length,
            sellTrades: sellTrades.length,
            
            // Métricas de riesgo
            maxDrawdown: maxDrawdown,
            sharpeRatio: sharpeRatio,
            
            // Tiempo
            startDate: this.startDate,
            daysSinceStart: Math.floor((new Date() - this.startDate) / (1000 * 60 * 60 * 24)),
            
            // Distribución de activos
            usdPercentage: (this.balance / totalValue) * 100,
            btcPercentage: ((this.btcAmount * currentBtcPrice) / totalValue) * 100
        };
    }

    // Calcular precio promedio de compra
    calculateAverageBuyPrice(beforeTimestamp) {
        const buyTrades = this.trades.filter(t => 
            t.type === 'BUY' && new Date(t.timestamp) < new Date(beforeTimestamp)
        );
        
        if (buyTrades.length === 0) return 0;
        
        let totalCost = 0;
        let totalBtc = 0;
        
        buyTrades.forEach(trade => {
            totalCost += trade.usdAmount;
            totalBtc += trade.amount;
        });
        
        return totalBtc > 0 ? totalCost / totalBtc : 0;
    }

    // Calcular drawdown máximo
    calculateMaxDrawdown(currentBtcPrice) {
        if (this.trades.length === 0) return 0;
        
        let peak = this.initialBalance;
        let maxDD = 0;
        
        this.trades.forEach(trade => {
            const portfolioValue = trade.balanceAfter + (trade.btcAfter * trade.price);
            
            if (portfolioValue > peak) {
                peak = portfolioValue;
            }
            
            const drawdown = ((peak - portfolioValue) / peak) * 100;
            if (drawdown > maxDD) {
                maxDD = drawdown;
            }
        });
        
        return maxDD;
    }

    // Calcular ratio de Sharpe aproximado
    calculateSharpeRatio() {
        if (this.trades.length < 2) return 0;
        
        const returns = [];
        let previousValue = this.initialBalance;
        
        this.trades.forEach(trade => {
            const currentValue = trade.balanceAfter + (trade.btcAfter * trade.price);
            const returnRate = (currentValue - previousValue) / previousValue;
            returns.push(returnRate);
            previousValue = currentValue;
        });
        
        if (returns.length === 0) return 0;
        
        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
        const stdDev = Math.sqrt(variance);
        
        return stdDev > 0 ? (avgReturn / stdDev) : 0;
    }

    // Generar ID único para operación
    generateTradeId() {
        return `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Reiniciar portafolio
    async resetPortfolio() {
        this.balance = this.initialBalance;
        this.btcAmount = 0;
        this.trades = [];
        this.startDate = new Date();
        await this.savePortfolio();
        console.log('🔄 Portafolio reiniciado');
    }

    // Exportar datos para análisis
    exportData() {
        return {
            portfolio: {
                balance: this.balance,
                btcAmount: this.btcAmount,
                initialBalance: this.initialBalance,
                startDate: this.startDate
            },
            trades: this.trades,
            stats: this.getDetailedStats()
        };
    }
}

module.exports = Portfolio;