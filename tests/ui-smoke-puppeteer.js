const puppeteer = require('puppeteer');

(async () => {
  console.log('🧪 Iniciando UI smoke (headless)...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const consoleMessages = [];

  page.on('console', msg => {
    const text = msg.text();
    consoleMessages.push(text);
    console.log('PAGE CONSOLE:', text);
  });

  // Increase timeout for slow environments
  try {
    await page.goto('http://127.0.0.1:9999', { waitUntil: 'networkidle2', timeout: 15000 });
  } catch (err) {
    console.error('Error cargando la página:', err.message || err);
  }

  // Wait a bit for WebSocket messages and charts to render
  await page.waitForTimeout(6000);

  // Check if invalid-data console message appeared
  const invalidLogs = consoleMessages.filter(m => m.includes('WebSocket recibió datos INVÁLIDOS'));

  // Check if stochastic canvas exists and chart object is present
  const chartExists = await page.$('#stochasticChart15m') !== null;

  const chartObject = await page.evaluate(() => {
    try {
      if (window.dashboard && window.dashboard.stochChart15m) {
        const c = window.dashboard.stochChart15m;
        return {
          datasets: Array.isArray(c.data?.datasets) ? c.data.datasets.length : 0,
          labels: Array.isArray(c.data?.labels) ? c.data.labels.length : 0
        };
      }
      return null;
    } catch (e) {
      return { error: e.message };
    }
  });

  console.log('\n=== UI SMOKE RESULTS ===');
  console.log('Invalid-data console lines found:', invalidLogs.length);
  if (invalidLogs.length > 0) console.log(invalidLogs.join('\n'));
  console.log('Stochastic canvas #stochasticChart15m exists:', chartExists);
  console.log('Stochastic chart object (datasets, labels):', chartObject);

  await browser.close();

  // Exit codes: 0 = success if no invalid logs and chart present
  const success = (invalidLogs.length === 0) && chartExists && chartObject && chartObject.datasets > 0;
  console.log('UI smoke success:', success);
  process.exit(success ? 0 : 2);
})();
