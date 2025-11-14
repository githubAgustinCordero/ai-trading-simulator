const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

async function testStochasticData() {
    console.log('🧪 Probando indicadores estocásticos en el frontend...');

    let serverProcess = null;

    try {
        // Iniciar servidor
        console.log('🚀 Iniciando servidor...');
        serverProcess = spawn('/usr/bin/node', ['server.js'], {
            cwd: path.dirname(__filename),
            stdio: ['ignore', 'pipe', 'pipe']
        });

        // Esperar a que el servidor esté listo
        await new Promise((resolve, reject) => {
            let ready = false;
            const timeout = setTimeout(() => {
                if (!ready) reject(new Error('Timeout esperando servidor'));
            }, 10000);

            serverProcess.stdout.on('data', (data) => {
                const output = data.toString();
                if (output.includes('🚀 AI Trading Simulator iniciado y listo')) {
                    ready = true;
                    clearTimeout(timeout);
                    setTimeout(resolve, 1000); // Esperar un poco más
                }
            });

            serverProcess.stderr.on('data', (data) => {
                console.log('Server stderr:', data.toString());
            });
        });

        console.log('✅ Servidor iniciado correctamente');

        // Hacer petición al endpoint /api/status
        console.log('📡 Consultando /api/status...');
        const response = await new Promise((resolve, reject) => {
            const req = http.get('http://localhost:9999/api/status', (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(5000, () => reject(new Error('Timeout en petición')));
        });

        if (!response.success) {
            console.log('❌ Error en la respuesta del servidor');
            return;
        }

        // Extraer indicadores estocásticos
        const stoch = response.data?.bot?.signals?.indicators?.stoch || {};

        console.log('📊 Indicadores Estocásticos encontrados:');
        console.log('=====================================');

        for (const [timeframe, values] of Object.entries(stoch)) {
            console.log(`⏰ ${timeframe}:`);
            console.log(`   K: ${values.k !== undefined ? values.k.toFixed(2) : 'N/A'}`);
            console.log(`   D: ${values.d !== undefined ? values.d.toFixed(2) : 'N/A'}`);
            console.log(`   K Prev: ${values.kPrev !== undefined ? values.kPrev.toFixed(2) : 'N/A'}`);
            console.log(`   D Prev: ${values.dPrev !== undefined ? values.dPrev.toFixed(2) : 'N/A'}`);
            console.log(`   Cross Up: ${values.crossUp || false}`);
            console.log(`   Cross Down: ${values.crossDown || false}`);
            console.log('');
        }

        // Verificar si hay datos para 15m (que es lo que usa el frontend)
        const st15m = stoch['15m'];
        if (st15m && st15m.k !== null && st15m.d !== null) {
            console.log('✅ Los indicadores estocásticos están disponibles para el gráfico');
            console.log(`   Frontend debería mostrar K=${st15m.k.toFixed(2)}, D=${st15m.d.toFixed(2)}`);
        } else {
            console.log('❌ No hay datos estocásticos para 15m - el gráfico no se actualizará');
            console.log('   Posibles causas:');
            console.log('   - No hay suficientes datos de velas (necesita al menos 14)');
            console.log('   - Error en el cálculo del indicador');
            console.log('   - Los datos no se están enviando desde el backend');
        }

    } catch (error) {
        console.error('❌ Error en la prueba:', error.message);
    } finally {
        // Detener servidor
        if (serverProcess) {
            console.log('🛑 Deteniendo servidor...');
            serverProcess.kill('SIGTERM');
            setTimeout(() => {
                if (!serverProcess.killed) {
                    serverProcess.kill('SIGKILL');
                }
            }, 2000);
        }
    }
}

// Ejecutar la prueba
testStochasticData();