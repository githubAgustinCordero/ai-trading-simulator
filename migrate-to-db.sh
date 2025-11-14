#!/bin/bash

echo "🔄 Iniciando migración a base de datos SQLite..."

# Detener el servicio si está corriendo
echo "⏹️  Deteniendo servicio..."
sudo systemctl stop ai-trading-simulator 2>/dev/null || echo "Servicio no estaba corriendo"

# Crear directorio de respaldos
mkdir -p backup-migration-$(date +%Y%m%d)

# Respaldar archivos JSON existentes
echo "💾 Creando respaldos..."
if [ -d "data" ]; then
    cp -r data backup-migration-$(date +%Y%m%d)/
    echo "✅ Datos JSON respaldados"
fi

# Asegurar que el directorio data existe
mkdir -p data

echo "📦 Instalando dependencias adicionales..."
npm install fs-extra

# Probar la conexión a la base de datos
echo "🔍 Probando sistema de base de datos..."
node -e "
const DatabaseManager = require('./database');
const db = new DatabaseManager();

async function test() {
    try {
        console.log('Inicializando base de datos...');
        const success = await db.initialize();
        if (success) {
            console.log('✅ Base de datos inicializada correctamente');
            
            // Probar inserción de datos
            await db.addLog('info', 'Migración iniciada', 'migration');
            console.log('✅ Sistema de logs funcionando');
            
            await db.close();
            console.log('✅ Conexión cerrada correctamente');
        } else {
            console.error('❌ Error inicializando base de datos');
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Error en prueba:', error);
        process.exit(1);
    }
}

test();
"

if [ $? -eq 0 ]; then
    echo "✅ Prueba de base de datos exitosa"
else
    echo "❌ Error en prueba de base de datos"
    exit 1
fi

# Migrar datos existentes si existen
if [ -f "data/portfolio.json" ]; then
    echo "📊 Migrando datos de portfolio existentes..."
    node -e "
const fs = require('fs');
const DatabaseManager = require('./database');

async function migrate() {
    try {
        const portfolioData = JSON.parse(fs.readFileSync('data/portfolio.json', 'utf8'));
        console.log('📄 Datos de portfolio encontrados');
        
        const db = new DatabaseManager();
        await db.initialize();
        
        // Migrar configuración de portfolio
        if (portfolioData.balance !== undefined) {
            await db.runQuery(\`
                UPDATE portfolio_state 
                SET balance = ?, btc_amount = ?, start_date = ?
                WHERE id = 1
            \`, [
                portfolioData.balance,
                portfolioData.btcAmount || 0,
                portfolioData.startDate || new Date().toISOString()
            ]);
            console.log('✅ Estado de portfolio migrado');
        }
        
        // Migrar operaciones si existen
        if (portfolioData.trades && portfolioData.trades.length > 0) {
            console.log(\`🔄 Migrando \${portfolioData.trades.length} operaciones...\`);
            
            for (const trade of portfolioData.trades) {
                try {
                    await db.saveTrade({
                        id: trade.id || \`migrated_\${Date.now()}_\${Math.random()}\`,
                        type: trade.type,
                        amount: trade.amount,
                        price: trade.price,
                        usdAmount: trade.usdAmount,
                        fee: trade.fee || 0,
                        confidence: trade.confidence || 50,
                        reasons: trade.reasons || [],
                        stopLoss: trade.stopLoss,
                        takeProfit: trade.takeProfit,
                        balanceAfter: trade.balanceAfter,
                        btcAfter: trade.btcAfter
                    });
                } catch (error) {
                    console.warn(\`⚠️  Error migrando operación: \${error.message}\`);
                }
            }
            console.log('✅ Operaciones migradas');
        }
        
        await db.addLog('info', 'Migración de datos JSON completada', 'migration');
        await db.close();
        
        console.log('✅ Migración completada exitosamente');
    } catch (error) {
        console.error('❌ Error en migración:', error);
    }
}

migrate();
"
else
    echo "ℹ️  No se encontraron datos previos para migrar"
fi

echo "🚀 Iniciando servidor con nuevo sistema..."
npm start

echo ""
echo "✅ Migración completada!"
echo "📊 El sistema ahora usa SQLite para persistencia de datos"
echo "🔍 Base de datos ubicada en: data/trading_simulator.db"
echo "📈 Dashboard disponible en: http://localhost:3001"