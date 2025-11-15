const DatabaseManager = require('./database');

async function activateBot() {
    const db = new DatabaseManager();
    
    try {
        console.log('🤖 Activando bot de trading...');
        
        await db.initialize();
        
        // Activar el bot
        const config = await db.getBotConfig();
        await db.updateBotConfig({
            maxPositionSize: config.max_position_size,
            stopLoss: config.stop_loss,
            takeProfit: config.take_profit,
            minConfidence: config.min_confidence,
            cooldownPeriod: config.cooldown_period,
            riskPerTrade: config.risk_per_trade,
            maxConsecutiveLosses: config.max_consecutive_losses,
            isActive: true // ¡Activar el bot!
        });
        
        await db.addLog('info', 'Bot de trading activado manualmente', 'admin');
        
        console.log('✅ Bot activado correctamente');
        console.log('🚀 El bot comenzará a operar automáticamente');
        
        await db.close();
    } catch (error) {
        console.error('❌ Error activando bot:', error);
    }
}

activateBot();