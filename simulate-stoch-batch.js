#!/usr/bin/env node
const Portfolio = require('./portfolio');
const BinanceMarketData = require('./binanceMarketData');
const TradingBot = require('./tradingBot');
const maxi1 = require('./strategies/maxi1');

async function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

// Helper to run one scenario
async function runScenario(name, scenario) {
    console.log('\n=== Ejecutando escenario:', name, '===');

    const portfolio = new Portfolio(10000);
    await portfolio.initialize();

    // Reset to clean state for each scenario
    await portfolio.resetPortfolio();

    const marketData = new BinanceMarketData();
    const bot = new TradingBot(portfolio, marketData);

    // Optionally set an initial position
    if (scenario.initial === 'long') {
        marketData.currentPrice = scenario.basePrice || 100000;
        await bot.openLong(marketData.currentPrice, 80, ['Scenario init long']);
        await sleep(150);
    } else if (scenario.initial === 'short') {
        marketData.currentPrice = scenario.basePrice || 100000;
        await bot.openShort(marketData.currentPrice, 80, ['Scenario init short']);
        await sleep(150);
    }

    const events = [];

    for (let i = 0; i < scenario.steps.length; i++) {
        const s = scenario.steps[i];
        const stepPrice = (scenario.basePrice || 100000) + ((i % 2 === 0) ? (i * 500) : -(i * 400));
        marketData.currentPrice = stepPrice;

        const simulatedSignals = {
            signal: 'HOLD',
            confidence: 90,
            reasons: ['Simulación batch'],
            indicators: {
                stoch: {
                    '15m': {
                        k: s.k,
                        d: s.d,
                        kPrev: s.kPrev,
                        dPrev: s.dPrev,
                        crossUpFromBottom: !!s.crossUpFromBottom,
                        crossDownFromTop: !!s.crossDownFromTop
                    }
                }
            }
        };

        console.log(`\n[${name}] Paso ${i+1}/${scenario.steps.length} price=${stepPrice} k=${s.k} d=${s.d} kPrev=${s.kPrev} dPrev=${s.dPrev}`);
        await maxi1.processSignals(bot, simulatedSignals, { price: stepPrice });
        await sleep(200);

        // Snapshot
        const open = portfolio.openPositions.map(p=>({ id: p.id, side: p.side, amount: p.amountBtc, entryPrice: p.entryPrice }));
        const recent = portfolio.trades.slice(0,6).map(t=>({ id: t.trade_id || t.id, action: t.action, side: t.position_side || t.positionSide, price: t.price }));
        console.log(' OpenPositions:', open);
        console.log(' Recent trades:', recent.slice(0,5));
        events.push({ step: i+1, open, recent });
    }

    // Evaluate expected conditions
    let passed = true;
    if (scenario.expectFinal) {
        const finalSides = portfolio.openPositions.map(p=>p.side);
        if (!finalSides.includes(scenario.expectFinal)) {
            passed = false;
        }
    }

    console.log(`\n=== Resultado escenario: ${name} -> ${passed ? 'PASS' : 'FAIL'} ===`);
    console.log('Final open positions:', portfolio.openPositions);
    console.log('Balance final:', portfolio.balance, 'BTC:', portfolio.btcAmount);

    return { name, passed, events, final: { open: portfolio.openPositions, balance: portfolio.balance } };
}

async function main() {
    const scenarios = {
        'overbought_cross_down': {
            initial: null,
            basePrice: 100000,
            steps: [ { kPrev:90,dPrev:85,k:70,d:80,crossDownFromTop:true } ],
            expectFinal: 'short'
        },
        'oversold_cross_up': {
            initial: null,
            basePrice: 100000,
            steps: [ { kPrev:15,dPrev:10,k:25,d:5,crossUpFromBottom:true } ],
            expectFinal: 'long'
        },
        'long_to_short_flip': {
            initial: 'long',
            basePrice: 100000,
            steps: [ { kPrev:90,dPrev:85,k:70,d:80,crossDownFromTop:true } ],
            expectFinal: 'short'
        },
        'short_to_long_flip': {
            initial: 'short',
            basePrice: 100000,
            steps: [ { kPrev:15,dPrev:10,k:25,d:5,crossUpFromBottom:true } ],
            expectFinal: 'long'
        },
        'rapid_alternation': {
            initial: null,
            basePrice: 100000,
            steps: [
                { kPrev:90,dPrev:85,k:70,d:80,crossDownFromTop:true },
                { kPrev:15,dPrev:10,k:25,d:5,crossUpFromBottom:true },
                { kPrev:88,dPrev:86,k:60,d:82,crossDownFromTop:true },
                { kPrev:12,dPrev:14,k:30,d:10,crossUpFromBottom:true }
            ],
            expectFinal: 'long'
        },
        'no_cross': {
            initial: null,
            basePrice: 100000,
            steps: [ { kPrev:50,dPrev:50,k:48,d:49 }, { kPrev:49,dPrev:48,k:50,d:49 } ],
            expectFinal: null
        }
    };

    const results = [];
    for (const [name, sc] of Object.entries(scenarios)) {
        const res = await runScenario(name, sc);
        results.push(res);
    }

    console.log('\n=== RESUMEN BATCH ===');
    for (const r of results) {
        console.log(`${r.name}: ${r.passed ? 'PASS' : 'FAIL'} - finalOpen=${(r.final.open||[]).map(p=>p.side).join(',')}`);
    }

    process.exit(0);
}

main().catch(e=>{ console.error('Batch fallo:', e); process.exit(1); });
