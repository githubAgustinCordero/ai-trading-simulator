const DatabaseManager = require('./database');

async function fixDatabase() {
    const db = new DatabaseManager();
    await db.initialize();

    // Fix portfolio_state
    await db.runQuery("UPDATE portfolio_state SET balance = 10000 WHERE balance IS NULL OR balance < 0");
    await db.runQuery("UPDATE portfolio_state SET btc_amount = 0 WHERE btc_amount IS NULL OR btc_amount < 0");

    // Fix trades
    await db.runQuery("UPDATE trades SET amount = 0 WHERE amount IS NULL OR amount < 0");

    console.log('Database fixed');
    process.exit(0);
}

fixDatabase().catch(console.error);