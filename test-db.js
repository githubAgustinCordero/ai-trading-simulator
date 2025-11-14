const DatabaseManager = require('./database');

async function testDatabase() {
    const db = new DatabaseManager();
    
    try {
        console.log('🔍 Iniciando prueba de base de datos...');
        
        const success = await db.initialize();
        if (success) {
            console.log('✅ Base de datos inicializada correctamente');
            
            // Probar inserción de log
            await db.addLog('info', 'Prueba de base de datos', 'test');
            console.log('✅ Log insertado correctamente');
            
            // Probar obtención de configuración
            const config = await db.getBotConfig();
            console.log('✅ Configuración obtenida:', config ? 'Sí' : 'No');
            
            // Cerrar conexión
            await db.close();
            console.log('✅ Base de datos cerrada correctamente');
            
            console.log('🎉 Todas las pruebas pasaron');
        } else {
            console.error('❌ Error inicializando base de datos');
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Error en prueba:', error);
        process.exit(1);
    }
}

testDatabase();