const AITradingServer = require('./server');

async function testServerReset() {
    console.log('🧪 Probando reset a través del servidor...');

    // Crear instancia del servidor (sin iniciar el servidor HTTP)
    const server = new AITradingServer();

    // Inicializar servicios
    await server.marketData.initialize();
    await server.portfolio.initialize();
    server.tradingBot = {
        stop: () => true,
        start: () => true,
        isActive: false,
        getStats: async () => ({}),
        getStrategy: () => 'test'
    };

    console.log('📊 Estado inicial:');
    console.log('  Balance:', server.portfolio.balance);
    console.log('  Open Positions:', server.portfolio.openPositions.length);

    try {
        // Simular la lógica del endpoint reset
        server.tradingBot.stop();
        console.log('🔄 Ejecutando resetPortfolio...');
        await server.portfolio.resetPortfolio();

        console.log('💾 Forzando guardado...');
        await server.portfolio.saveToDatabase();

        console.log('📊 Estado después del reset:');
        console.log('  Balance:', server.portfolio.balance);
        console.log('  Open Positions:', server.portfolio.openPositions.length);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error durante el reset del servidor:', error);
        process.exit(1);
    }
}

testServerReset();