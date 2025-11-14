#!/usr/bin/env node
const Portfolio = require('./portfolio');
const BinanceMarketData = require('./binanceMarketData');
const TradingBot = require('./tradingBot');
const maxi1 = require('./strategies/maxi1');

async function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function run() {
    console.log('🔬 Iniciando simulación estocástico - series de cruces');

    const portfolio = new Portfolio(10000);
    const dbOk = await portfolio.initialize();
    if (!dbOk) return console.error('❌ No se pudo inicializar portfolio/DB');

    const marketData = new BinanceMarketData();

    const bot = new TradingBot(portfolio, marketData);

    // Forzar posición inicial LONG para observar cambios LONG->SHORT->LONG
    console.log('⚙️ Forzando apertura inicial LONG de prueba');
    // Asegurar un precio válido al abrir la posición inicial
    const basePrice = 100000;
    marketData.currentPrice = basePrice;
    await bot.openLong(basePrice, 80, ['Simulación: apertura inicial LONG']);
    await sleep(200);

    // Serie de pasos: cada elemento es {kPrev,dPrev,k,d, crossUpFromBottom?, crossDownFromTop?}
    const series = [
        // Desde estado LONG: provocar cruce DOWN desde sobrecompra -> abrir SHORT
        { kPrev: 90, dPrev: 85, k: 70, d: 80, crossDownFromTop: true },
        // Luego provocar cruce UP desde sobreventa -> abrir LONG
        { kPrev: 15, dPrev: 10, k: 25, d: 5, crossUpFromBottom: true },
        // Otra vez a sobrecompra con cruce DOWN
        { kPrev: 88, dPrev: 86, k: 60, d: 82, crossDownFromTop: true },
        // Y de nuevo a sobreventa con cruce UP
        { kPrev: 12, dPrev: 14, k: 30, d: 10, crossUpFromBottom: true },
        // Variante: cruce con kPrev<dPrev both <20 -> crossUpStrict via logic (no explicit flag)
        { kPrev: 10, dPrev: 15, k: 22, d: 8 },
        // Variante: cruce con kPrev>dPrev both >80 -> crossDownStrict via logic
        { kPrev: 85, dPrev: 82, k: 78, d: 83 }
    ];

    const executedTrades = [];

    for (let i = 0; i < series.length; i++) {
        const s = series[i];
        // Construir simulatedSignals con estructura que espera la estrategia
        const simulatedSignals = {
            signal: 'HOLD',
            confidence: 90,
            reasons: ['Simulación estocástico'],
            indicators: {
                stoch: {
                    '15m': {
                        k: s.k,
                        d: s.d,
                        kPrev: s.kPrev,
                        dPrev: s.dPrev,
                        crossUpFromBottom: s.crossUpFromBottom || false,
                        crossDownFromTop: s.crossDownFromTop || false
                    }
                }
            }
        };

        // Forzar y variar un precio válido para este paso (evita price=0 en cierres)
        const stepPrice = basePrice + ((i % 2 === 0) ? (i * 500) : -(i * 400));
        marketData.currentPrice = stepPrice;
        console.log(`\n--- Paso ${i+1}/${series.length} — inyectando stoch 15m: kPrev=${s.kPrev}, dPrev=${s.dPrev}, k=${s.k}, d=${s.d} — price=${stepPrice}`);

        // Llamar directamente a la estrategia (misma que usa el bot internamente)
        try {
            await maxi1.processSignals(bot, simulatedSignals, { price: stepPrice });
        } catch (e) {
            console.error('Error ejecutando strategy.processSignals:', e && e.message ? e.message : e);
        }

        // Pequeña espera para que el portfolio procese y la BD persista
        await sleep(300);

        // Extraer últimas trades guardadas
        const recent = portfolio.trades.slice(0, 6).map(t => ({ id: t.trade_id || t.id || t.tradeId || t.id, action: t.action, position_side: t.position_side || t.positionSide, price: t.price, timestamp: t.timestamp }));
        console.log('Últimas trades en memoria (más recientes primero):', recent.slice(0,5));

        executedTrades.push({ step: i+1, recent });
    }

    console.log('\n✅ Simulación completada. Resumen de trades:');
    executedTrades.forEach(r => {
        console.log(`Paso ${r.step}: ${r.recent.map(t => `${t.action || 'N/A'}:${t.position_side||'N/A'}@$${t.price||0}`).join(' | ')}`);
    });

    console.log('\nPosiciones abiertas finales:', portfolio.openPositions);
    console.log('Balance final:', portfolio.balance, 'BTC:', portfolio.btcAmount);

    process.exit(0);
}

run().catch(e=>{ console.error('Simulación fallo:', e); process.exit(1); });
