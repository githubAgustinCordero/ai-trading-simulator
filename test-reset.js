const DatabaseManager = require('./database');
const Portfolio = require('./portfolio');

async function testReset() {
    console.log('🧪 Iniciando test completo de reset del portfolio...');

    try {
        // 1. Inicializar base de datos limpia
        console.log('1. Inicializando base de datos limpia...');
        const db = new DatabaseManager();
        await db.initialize();

        // 2. Crear portfolio y agregar una operación falsa
        console.log('2. Creando portfolio y agregando operación falsa...');
        const portfolio = new Portfolio();
        await portfolio.initialize();

        // Agregar una operación BUY falsa
        const fakeTrade = {
            id: 'test-trade-123',
            type: 'BUY',
            amount: 0.001,
            price: 50000,
            usdAmount: 50,
            fee: 0.5,
            confidence: 80,
            reasons: ['Test trade'],
            stopLoss: null,
            takeProfit: null,
            balanceAfter: 9950,
            btcAfter: 0.001,
            entryPrice: 50000,
            exitPrice: null,
            gainLoss: null,
            roi: null,
            relatedTradeId: null,
            positionSide: 'long',
            positionId: 'test-pos-123',
            action: 'open'
        };

        await db.saveTrade(fakeTrade);
        console.log('   ✅ Operación falsa agregada');

        // Verificar que la operación existe
        const tradesBefore = await db.getTrades(10);
        console.log(`   📊 Trades antes del reset: ${tradesBefore.length}`);

        // 3. Ejecutar reset
        console.log('3. Ejecutando reset del portfolio...');
        await portfolio.resetPortfolio();
        console.log('   ✅ Reset ejecutado');

        // 4. Verificar estado después del reset
        console.log('4. Verificando estado después del reset...');

        // Verificar trades en BD
        const tradesAfter = await db.getTrades(10);
        console.log(`   📊 Trades después del reset: ${tradesAfter.length}`);

        // Verificar estado del portfolio
        const portfolioState = await db.getPortfolioState();
        console.log(`   💰 Balance: $${portfolioState.balance}`);
        console.log(`   ₿ BTC Amount: ${portfolioState.btc_amount}`);
        console.log(`   📈 Total Value: $${portfolioState.total_value}`);

        // Verificar posiciones abiertas en memoria
        console.log(`   📍 Posiciones abiertas: ${portfolio.openPositions.length}`);

        // 5. Validar resultados
        console.log('5. Validando resultados...');
        const success = (
            tradesAfter.length === 0 &&
            portfolioState.balance === 10000 &&
            portfolioState.btc_amount === 0 &&
            portfolio.openPositions.length === 0
        );

        if (success) {
            console.log('✅ TEST PASSED: Reset funciona correctamente');
            console.log('   - Trades eliminados: ✅');
            console.log('   - Balance reseteado a $10,000: ✅');
            console.log('   - BTC reseteado a 0: ✅');
            console.log('   - Posiciones abiertas vacías: ✅');
        } else {
            console.log('❌ TEST FAILED: Reset no funciona correctamente');
            console.log('   - Trades eliminados:', tradesAfter.length === 0 ? '✅' : '❌');
            console.log('   - Balance reseteado a $10,000:', portfolioState.balance === 10000 ? '✅' : '❌');
            console.log('   - BTC reseteado a 0:', portfolioState.btc_amount === 0 ? '✅' : '❌');
            console.log('   - Posiciones abiertas vacías:', portfolio.openPositions.length === 0 ? '✅' : '❌');
        }

        // Cerrar conexiones
        await portfolio.close();
        await db.close();

        return success;

    } catch (error) {
        console.error('❌ Error en el test:', error);
        return false;
    }
}

// Ejecutar test si se llama directamente
if (require.main === module) {
    testReset().then(success => {
        process.exit(success ? 0 : 1);
    });
}

module.exports = testReset;