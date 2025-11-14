#!/usr/bin/env node
(async () => {
    const path = require('path');
    const Portfolio = require(path.join(__dirname, '..', 'portfolio'));

    const p = new Portfolio();
    await p.initialize();

    const shortPos = (p.openPositions || []).find(x => x.side === 'short');
    if (!shortPos) {
        console.log('No short position found to test.');
        process.exit(0);
    }

    const balance = Number(p.balance || 0);
    const entryUsd = Number(shortPos.entryUsd || 0);
    const available = balance + entryUsd;

    // Choose an exit price that makes cost slightly greater than available (by $2)
    const needed = 2;
    const exitPrice = (available + needed) / (shortPos.amountBtc || 1);

    console.log('Triggering short-close diagnostic:');
    console.log(' posId=', shortPos.id, 'amountBtc=', shortPos.amountBtc, 'entryUsd=', entryUsd.toFixed(2));
    console.log(' current balance=', balance.toFixed(2), 'available=', available.toFixed(2), 'exitPrice=', exitPrice.toFixed(2));

    const trade = {
        type: 'BUY', // to close a short we BUY
        positionSide: 'short',
        action: 'close',
        price: exitPrice,
        fee: 0
    };

    const ok = await p.executeTrade(trade);
    console.log('executeShortClose returned:', ok);
    process.exit(0);
})();
