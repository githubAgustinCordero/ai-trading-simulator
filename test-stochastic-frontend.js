const puppeteer = require('puppeteer');

async function testStochasticFrontend() {
    console.log('🧪 Probando frontend estocástico...');
    
    const browser = await puppeteer.launch({ 
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        const page = await browser.newPage();
        
        // Escuchar logs de consola
        page.on('console', msg => {
            console.log('CONSOLE:', msg.text());
        });
        
        // Ir al dashboard
        await page.goto('http://localhost:9999');
        
        // Esperar a que cargue
        await page.waitForTimeout(3000);
        
        // Verificar si el gráfico existe
        const chartExists = await page.$('#stochasticChart15m');
        console.log('Canvas existe:', !!chartExists);
        
        // Intentar ejecutar la función de debug
        const result = await page.evaluate(() => {
            if (window.dashboard && typeof window.dashboard.debugUpdateStochastic === 'function') {
                window.dashboard.debugUpdateStochastic(50, 60);
                return 'Función ejecutada';
            } else {
                return 'Función no encontrada';
            }
        });
        
        console.log('Resultado debug:', result);
        
        // Esperar para ver si se actualiza
        await page.waitForTimeout(2000);
        
        // Verificar datos del gráfico
        const chartData = await page.evaluate(() => {
            if (window.dashboard && window.dashboard.stochChart15m) {
                return {
                    labels: window.dashboard.stochChart15m.data.labels,
                    kData: window.dashboard.stochChart15m.data.datasets[0].data,
                    dData: window.dashboard.stochChart15m.data.datasets[1].data
                };
            }
            return null;
        });
        
        console.log('Datos del gráfico:', chartData);
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        // No cerrar el browser para que puedas verlo
        console.log('Browser abierto - puedes interactuar manualmente');
    }
}

testStochasticFrontend();
