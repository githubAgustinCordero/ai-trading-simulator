const Portfolio = require('./portfolio');

async function testPortfolio() {
    const portfolio = new Portfolio(10000);
    
    try {
        console.log('🔍 Iniciando prueba de portfolio...');
        
        const success = await portfolio.initialize();
        if (success) {
            console.log('✅ Portfolio inicializado correctamente');
            
            // Obtener estadísticas
            const stats = await portfolio.getPortfolioStats(50000);
            console.log('✅ Estadísticas obtenidas:', {
                balance: stats.balance,
                btcAmount: stats.btcAmount,
                totalTrades: stats.totalTrades
            });
            
            // Cerrar conexión
            await portfolio.close();
            console.log('✅ Portfolio cerrado correctamente');
            
            console.log('🎉 Prueba de portfolio exitosa');
        } else {
            console.error('❌ Error inicializando portfolio');
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Error en prueba de portfolio:', error);
        process.exit(1);
    }
}

testPortfolio();