const Portfolio = require('../portfolio');

(async () => {
  try {
    const p = new Portfolio(10000);
    console.log('Inicializando portfolio...');
    await p.initialize();
    console.log('Reconstruyendo posiciones desde trades...');
    p.rebuildOpenPositionsFromTrades();
    console.log('Open positions after rebuild:', p.openPositions);
    const price = await p.getCurrentBtcPrice();
    console.log('Precio actual (para recálculos):', price);
    await p.saveToDatabase();
    console.log('Estado guardado. Portfolio stats:');
    const stats = await p.getPortfolioStats(price);
    console.log(JSON.stringify(stats, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error en rebuild script:', err);
    process.exit(1);
  }
})();
