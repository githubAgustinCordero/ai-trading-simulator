const WebSocket = require('ws');

const url = process.env.WS_URL || 'ws://127.0.0.1:9999';
const ws = new WebSocket(url);

let received = 0;

ws.on('open', () => {
  console.log('[smoke] connected to', url);
  // Request an immediate update
  ws.send(JSON.stringify({ type: 'requestUpdate' }));
});

ws.on('message', (msg) => {
  try {
    const data = JSON.parse(msg.toString());
    received += 1;
    console.log('[smoke] message', received, JSON.stringify(data).slice(0, 1000));

    if (data.type === 'update') {
      const totalValue = (data.data && (data.data.portfolio && data.data.portfolio.totalValue)) || (data.data && data.data.stats && data.data.stats.totalValue) || null;
      console.log('[smoke] update.totalValue=', totalValue, 'stats.balance=', data.data && data.data.stats && data.data.stats.balance);
    }
  } catch (err) {
    console.error('[smoke] failed parsing message', err);
  }
});

ws.on('close', () => {
  console.log('[smoke] connection closed');
});

ws.on('error', (e) => {
  console.error('[smoke] ws error', e);
});

// Close after 12 seconds
setTimeout(() => {
  console.log('[smoke] closing after timeout, received messages:', received);
  ws.close();
}, 12000);
