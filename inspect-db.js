const DatabaseManager = require('./database');

async function inspectDatabase() {
    const db = new DatabaseManager();
    
    try {
        console.log('🔍 Inspeccionando base de datos SQLite...');
        
        await db.initialize();
        
        // Verificar configuración
        const config = await db.getBotConfig();
        console.log('\n📋 Configuración del bot:');
        console.log('  - Tamaño máximo de posición:', config.max_position_size);
        console.log('  - Stop loss:', config.stop_loss);
        console.log('  - Take profit:', config.take_profit);
        console.log('  - Bot activo:', config.is_active ? 'Sí' : 'No');
        
        // Verificar estado del portfolio
        const portfolio = await db.getPortfolioState();
        console.log('\n💰 Estado del portfolio:');
        console.log('  - Balance USD:', `$${portfolio.balance}`);
        console.log('  - Cantidad BTC:', portfolio.btc_amount.toFixed(8));
        console.log('  - Balance inicial:', `$${portfolio.initial_balance}`);
        console.log('  - Valor total:', `$${portfolio.total_value}`);
        console.log('  - Fecha inicio:', new Date(portfolio.start_date).toLocaleString());
        
        // Verificar operaciones
        const trades = await db.getTrades(10);
        console.log('\n📊 Operaciones recientes:');
        console.log(`  - Total de operaciones: ${trades.length}`);
        if (trades.length > 0) {
            trades.forEach((trade, index) => {
                console.log(`  ${index + 1}. ${trade.type} ${trade.amount} BTC a $${trade.price} (${new Date(trade.timestamp).toLocaleString()})`);
            });
        } else {
            console.log('  - No hay operaciones registradas');
        }
        
        // Verificar logs del sistema
        const logs = await db.getLogs(5);
        console.log('\n📝 Logs recientes:');
        logs.forEach((log, index) => {
            console.log(`  ${index + 1}. [${log.level.toUpperCase()}] ${log.message} (${log.component})`);
        });
        
        // Verificar datos de mercado
        const marketDataQuery = `SELECT COUNT(*) as count, MAX(timestamp) as last_update FROM market_data`;
        const marketData = await db.getQuery(marketDataQuery);
        console.log('\n📈 Datos de mercado:');
        console.log(`  - Registros de precio: ${marketData.count}`);
        if (marketData.last_update) {
            console.log(`  - Última actualización: ${new Date(marketData.last_update).toLocaleString()}`);
        }
        
        // Estadísticas generales
        const stats = await db.getTradeStatistics();
        if (stats && stats.total_trades > 0) {
            console.log('\n📊 Estadísticas de trading:');
            console.log(`  - Total operaciones: ${stats.total_trades}`);
            console.log(`  - Operaciones de compra: ${stats.buy_trades}`);
            console.log(`  - Operaciones de venta: ${stats.sell_trades}`);
            console.log(`  - Confianza promedio: ${stats.avg_confidence}%`);
            console.log(`  - Total comisiones: $${stats.total_fees}`);
        }
        
        await db.close();
        
        console.log('\n✅ Inspección de base de datos completada');
    } catch (error) {
        console.error('❌ Error inspeccionando base de datos:', error);
    }
}

inspectDatabase();