#!/usr/bin/env node
const Portfolio = require('./portfolio');
const BinanceMarketData = require('./binanceMarketData');
const TradingBot = require('./tradingBot');
const maxi1 = require('./strategies/maxi1');

function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function randFloat(a,b){ return a + Math.random()*(b-a); }
async function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function runOne(runId, steps=8){
    const portfolio = new Portfolio(10000);
    await portfolio.initialize();
    await portfolio.resetPortfolio();
    const marketData = new BinanceMarketData();
    const bot = new TradingBot(portfolio, marketData);

    let stats = { runId, steps, expectedTriggers:0, successfulTriggers:0, events:[] };

    for (let i=0;i<steps;i++){
        // generate random stoch values covering full spectrum
        const kPrev = randInt(0,100);
        // make k near kPrev with some probability of crossing
        let k = kPrev + randInt(-30,30);
        k = Math.max(0, Math.min(100, k));
        const dPrev = randInt(0,100);
        let d = dPrev + randInt(-30,30);
        d = Math.max(0, Math.min(100, d));

        const crossDown = (kPrev > dPrev && k < d);
        const crossUp = (kPrev < dPrev && k > d);
        const wasOverbought = (kPrev>80 && dPrev>80);
        const wasOversold = (kPrev<20 && dPrev<20);
        const crossDownStrict = (crossDown && wasOverbought) || (Math.random()<0.05 && crossDown);
        const crossUpStrict = (crossUp && wasOversold) || (Math.random()<0.05 && crossUp);

        const simulatedSignals = {
            signal: 'HOLD',
            confidence: 90,
            indicators: { stoch: { '15m': { k,kPrev,d,dPrev, crossUpFromBottom: crossUpStrict, crossDownFromTop: crossDownStrict } } }
        };

        const price = 100000 + (i-steps/2)*500 + randInt(-200,200);
        marketData.currentPrice = price;

        // expected
        let expect = null;
        if (crossDownStrict) { expect = 'short'; stats.expectedTriggers++; }
        if (crossUpStrict) { expect = 'long'; stats.expectedTriggers++; }

        // call strategy
        await maxi1.processSignals(bot, simulatedSignals, { price });
        await sleep(50);

        const open = portfolio.openPositions.slice().map(p=>p.side);
        let success = false;
        if (expect){
            if (open.length>0 && open[0]===expect) success = true;
            // also accept if no open but there was a close+open sequence in trades
            const last = portfolio.trades[0];
            if (!success && last){
                if (expect==='short' && last.position_side==='short' && last.action==='open') success = true;
                if (expect==='long' && last.position_side==='long' && last.action==='open') success = true;
            }
        }
        if (success) stats.successfulTriggers++;
        stats.events.push({ step:i+1, kPrev,dPrev,k,d, crossDownStrict, crossUpStrict, expect, open, success });
    }

    return stats;
}

async function main(){
    const runs = 100;
    const all = [];
    let totalExpected=0, totalSuccess=0;
    for (let r=0;r<runs;r++){
        const s = await runOne(r+1, 8);
        all.push(s);
        totalExpected += s.expectedTriggers;
        totalSuccess += s.successfulTriggers;
        if ((r+1) % 10 === 0) console.log(`Completed ${r+1}/${runs}`);
    }

    console.log('\n=== MONTECARLO SUMMARY ===');
    console.log(`Runs: ${runs}, total expected triggers: ${totalExpected}, total successful triggers: ${totalSuccess}`);
    const rate = totalExpected>0 ? (totalSuccess/totalExpected)*100 : 0;
    console.log(`Success rate: ${rate.toFixed(2)}%`);

    // Save a compact JSON result file for inspection
    const fs = require('fs');
    fs.writeFileSync('ai-trading-simulator/montecarlo_results.json', JSON.stringify({ runs, totalExpected, totalSuccess, rate, all }, null, 2));

    process.exit(0);
}

main().catch(e=>{ console.error('Montecarlo fail:', e); process.exit(1); });
