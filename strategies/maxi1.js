// MAXI1 strategy module
// Exports a single function processSignals(bot, signals, marketData)
// which implements the strict MAXI1 rules: always maintain a single LONG or SHORT
// position and switch on 15m stochastic crosses combined with overbought/oversold.
const { safeNum } = require('../lib/utils');

module.exports = {
    async processSignals(bot, signals, marketData) {
        // Defensive: ensure signals is an object
        if (!signals || typeof signals !== 'object') {
            console.warn('🔶 [MAXI1] signals undefined or invalid — using fallback signals');
            signals = { signal: 'HOLD', confidence: 0, indicators: { stoch: { '15m': {} } } };
        }

        // Ensure bot has up-to-date currentPosition
        if (typeof bot.syncCurrentPosition === 'function') await bot.syncCurrentPosition();

        const st15 = signals.indicators?.stoch?.['15m'] || {};
        const k = (typeof st15.k === 'number') ? st15.k : null;
        const kPrev = (typeof st15.kPrev === 'number') ? st15.kPrev : null;
        const d = (typeof st15.d === 'number') ? st15.d : null;
        const dPrev = (typeof st15.dPrev === 'number') ? st15.dPrev : null;

        const crossDown = (kPrev !== null && dPrev !== null && kPrev > dPrev && k !== null && d !== null && k < d);
        const crossUp = (kPrev !== null && dPrev !== null && kPrev < dPrev && k !== null && d !== null && k > d);

        const wasOverbought = (kPrev !== null && dPrev !== null && kPrev > 80 && dPrev > 80);
        const wasOversold = (kPrev !== null && dPrev !== null && kPrev < 20 && dPrev < 20);

    console.log('🔍 [MAXI1 DEBUG] stoch15m:', { k, kPrev, d, dPrev, crossDown, crossUp, wasOverbought, wasOversold, crossDownFromTop: st15.crossDownFromTop || false, crossUpFromBottom: st15.crossUpFromBottom || false });

        // If no position, open initial according to the provided signals (prefer explicit signals)
        if (!bot.currentPosition) {
            console.log('🔍 [MAXI1] No hay posición actual — abriendo posición inicial (usando signals)');
            try {
                const sig = signals.signal || 'HOLD';
                const price = marketData && marketData.price ? marketData.price : (await bot.marketData.getCurrentPrice()).price;
                const confidence = safeNum(signals.confidence, 80);

                if (sig === 'BUY') {
                    await bot.openLong(price, confidence, ['Posición inicial: BUY signal desde MAXI1'], signals);
                    return;
                }
                if (sig === 'SELL') {
                    await bot.openShort(price, confidence, ['Posición inicial: SELL signal desde MAXI1'], signals);
                    return;
                }

                // Fallback to stochastic heuristic from provided indicators
                const st15 = signals.indicators?.stoch?.['15m'] || {};
                if (typeof st15.k === 'number' && st15.k < 50) {
                    await bot.openLong(price, confidence, ['Posición inicial: heurística estocástico K<50 (MAXI1)'], signals);
                } else {
                    await bot.openShort(price, confidence, ['Posición inicial: heurística estocástico K>=50 (MAXI1)'], signals);
                }
            } catch (e) {
                // If anything fails, fallback to existing helper which may use marketData internals
                if (typeof bot.openInitialPosition === 'function') {
                    await bot.openInitialPosition();
                }
            }
            return;
        }

        const crossDownStrict = (crossDown && wasOverbought) || Boolean(st15.crossDownFromTop);
        const crossUpStrict = (crossUp && wasOversold) || Boolean(st15.crossUpFromBottom);

        const currentPrice = marketData.price;
        const effectiveConfidence = safeNum(signals.confidence, 100);

        if (bot.currentPosition.side === 'long' && crossDownStrict) {
            console.log('🔄 [MAXI1] Condición cumplida: cambiar LONG -> SHORT');
            if (typeof bot.closeLong === 'function') await bot.closeLong(currentPrice, effectiveConfidence, ['MAXI1: cambiar LONG -> SHORT por estocástico 15m']);
            if (typeof bot.openShort === 'function') await bot.openShort(currentPrice, effectiveConfidence, ['MAXI1: apertura SHORT por estocástico 15m'], signals);
            return;
        }

        if (bot.currentPosition.side === 'short' && crossUpStrict) {
            console.log('🔄 [MAXI1] Condición cumplida: cambiar SHORT -> LONG');
            if (typeof bot.closeShort === 'function') await bot.closeShort(currentPrice, effectiveConfidence, ['MAXI1: cambiar SHORT -> LONG por estocástico 15m']);
            if (typeof bot.openLong === 'function') await bot.openLong(currentPrice, effectiveConfidence, ['MAXI1: apertura LONG por estocástico 15m'], signals);
            return;
        }

        // Otherwise, keep position
        console.log('🔍 [MAXI1] Mantener posición actual:', bot.currentPosition.side);
        return;
    }
};
