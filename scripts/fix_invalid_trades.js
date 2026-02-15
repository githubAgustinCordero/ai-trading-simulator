const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB = path.join(__dirname, '..', 'trading_simulator_agustin.db');

function run() {
  const db = new sqlite3.Database(DB, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
      console.error('Error opening DB:', err.message);
      process.exit(1);
    }
  });

  db.serialize(async () => {
    try {
      // Ensure sanitized columns exist
      db.all("PRAGMA table_info(trades)", (err, cols) => {
        if (err) { console.error(err); return; }
        const names = cols.map(c => c.name);
        if (!names.includes('sanitized')) {
          console.log('Adding column sanitized to trades');
          db.run("ALTER TABLE trades ADD COLUMN sanitized INTEGER DEFAULT 0");
        }
        if (!names.includes('sanitized_note')) {
          console.log('Adding column sanitized_note to trades');
          db.run("ALTER TABLE trades ADD COLUMN sanitized_note TEXT DEFAULT NULL");
        }
      });

      // Find suspect trades
      const suspectsSql = `SELECT id, trade_id, timestamp, usd_amount, price, entry_price FROM trades WHERE price = 0 OR entry_price = 0 OR price IS NULL LIMIT 1000`;
      db.all(suspectsSql, async (err, rows) => {
        if (err) { console.error('Error querying suspects:', err.message); db.close(); return; }
        if (!rows || rows.length === 0) {
          console.log('No suspect trades found (price==0)');
          db.close();
          return;
        }

        console.log(`Found ${rows.length} suspect trades; attempting to find fallback prices`);

        for (const r of rows) {
          const ts = r.timestamp || new Date().toISOString();
          // Query nearest market_data price
          const marketSql = `SELECT price, timestamp FROM market_data WHERE price > 0 ORDER BY ABS(strftime('%s', timestamp) - strftime('%s', ?)) LIMIT 1`;
          const tradeFallback = await new Promise(resolve => {
            db.get(marketSql, [ts], (e, m) => resolve({err:e, row:m}));
          });

          let fallbackPrice = null;
          if (tradeFallback && tradeFallback.row && tradeFallback.row.price > 0) {
            fallbackPrice = tradeFallback.row.price;
            console.log(`trade ${r.trade_id} -> fallback from market_data ${fallbackPrice} (ts ${tradeFallback.row.timestamp})`);
          } else {
            // fallback to nearest other trade with price > 0
            const tradesSql = `SELECT price, timestamp FROM trades WHERE price > 0 ORDER BY ABS(strftime('%s', timestamp) - strftime('%s', ?)) LIMIT 1`;
            const other = await new Promise(resolve => db.get(tradesSql, [ts], (e, trow) => resolve({err:e, row:trow})));
            if (other && other.row && other.row.price > 0) {
              fallbackPrice = other.row.price;
              console.log(`trade ${r.trade_id} -> fallback from other trade ${fallbackPrice} (ts ${other.row.timestamp})`);
            }
          }

          if (fallbackPrice) {
            // Update trade: set price and entry_price if zero, mark sanitized
            const note = `fixed_price_from_fallback:${fallbackPrice}`;
            const updSql = `UPDATE trades SET price = ?, entry_price = CASE WHEN entry_price = 0 THEN ? ELSE entry_price END, sanitized = 1, sanitized_note = ? WHERE id = ?`;
            await new Promise((resolve, reject) => db.run(updSql, [fallbackPrice, fallbackPrice, note, r.id], function(err) {
              if (err) { console.error('Error updating trade', r.id, err.message); resolve(false); } else { resolve(true); }
            }));
          } else {
            const note = 'flagged_no_fallback';
            const updSql = `UPDATE trades SET sanitized = 1, sanitized_note = ? WHERE id = ?`;
            await new Promise((resolve, reject) => db.run(updSql, [note, r.id], function(err) {
              if (err) { console.error('Error flagging trade', r.id, err.message); resolve(false); } else { resolve(true); }
            }));
            console.log(`trade ${r.trade_id} flagged (no fallback found)`);
          }
        }

        // Insert system log summary
        const summary = `Sanitization run: processed ${rows.length} trades`;
        db.run(`INSERT INTO system_logs (level, message, component) VALUES (?, ?, ?)`, ['info', summary, 'migration']);

        console.log('Sanitization completed.');
        db.close();
      });
    } catch (e) {
      console.error('Unexpected error in sanitization script:', e && e.message ? e.message : e);
      db.close();
    }
  });
}

run();

// Usage: node scripts/fix_invalid_trades.js
