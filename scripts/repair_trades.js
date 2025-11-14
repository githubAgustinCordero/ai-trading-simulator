const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, '..', 'trading_simulator_agustin.db');

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, err => {
  if (err) {
    console.error('Failed to open DB', err.message);
    process.exit(1);
  }
});

function generatePositionId(side) {
  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2, 9);
  return `${side || 'pos'}_${ts}_${rnd}`;
}

(async function main() {
  console.log('DB:', dbPath);
  db.serialize(() => {
    const q = `SELECT id, trade_id, type, action, position_side, position_id, timestamp FROM trades WHERE position_id IS NULL OR position_id = '' OR position_side IS NULL OR position_side = '' ORDER BY timestamp DESC;`;
    db.all(q, (err, rows) => {
      if (err) {
        console.error('Query failed', err.message);
        db.close();
        return;
      }

      if (!rows || rows.length === 0) {
        console.log('No trades found with missing position_id or position_side. Nothing to do.');
        db.close();
        return;
      }

      console.log(`Found ${rows.length} trades with missing metadata. Preparing updates...`);

      const updateSide = db.prepare(`UPDATE trades SET position_side = ? WHERE id = ?`);
      const updateId = db.prepare(`UPDATE trades SET position_id = ? WHERE id = ?`);

      let updated = 0;

      rows.forEach(r => {
        const inferredSide = r.position_side || (r.type === 'BUY' ? 'long' : (r.type === 'SELL' ? 'short' : null));
        if (!r.position_side && inferredSide) {
          updateSide.run(inferredSide, r.id, function(err2) {
            if (err2) console.error('Failed to update position_side for', r.trade_id, err2.message);
            else console.log(`Updated position_side=${inferredSide} for ${r.trade_id}`);
          });
          updated++;
        }

        if ((!r.position_id || r.position_id === '') && r.action === 'open') {
          const pid = generatePositionId(inferredSide || 'pos');
          updateId.run(pid, r.id, function(err3) {
            if (err3) console.error('Failed to update position_id for', r.trade_id, err3.message);
            else console.log(`Generated position_id=${pid} for open trade ${r.trade_id}`);
          });
          updated++;
        } else if ((!r.position_id || r.position_id === '') && r.action !== 'open') {
          console.log(`Skipping close trade without position_id: ${r.trade_id} (action=${r.action})`);
        }
      });

      updateSide.finalize();
      updateId.finalize();

      // Small summary after a short delay to allow statements to finish
      setTimeout(() => {
        console.log(`Done. Rough updated count: ${updated}`);
        db.close();
      }, 500);
    });
  });
})();
