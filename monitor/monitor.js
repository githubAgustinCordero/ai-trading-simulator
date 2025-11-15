#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const fetch = global.fetch || require('node-fetch');

const BASE = path.join(__dirname);
const LOG = path.join(BASE, 'monitor.log');
const PID = path.join(BASE, 'monitor.pid');
const SERVER_LOG = path.join(__dirname, '..', 'server.log');

const INTERVAL_SECS = process.env.MONITOR_INTERVAL_SECS ? Number(process.env.MONITOR_INTERVAL_SECS) : 60; // default 60s
const ITERATIONS = process.env.MONITOR_ITERATIONS ? Number(process.env.MONITOR_ITERATIONS) : 120; // default ~2 hours
const API_URL = process.env.MONITOR_API_URL || 'http://127.0.0.1:9999/api/status';

function append(line) {
  try { fs.appendFileSync(LOG, line + '\n'); } catch (e) { console.error('Failed writing monitor log', e); }
}

(async function main(){
  try {
    fs.writeFileSync(PID, String(process.pid));
  } catch(e){}

  append('--- Monitor start: ' + new Date().toISOString() + ' ---');
  append(`config: API=${API_URL} interval_s=${INTERVAL_SECS} iterations=${ITERATIONS}`);

  for (let i=0;i<ITERATIONS;i++){
    const ts = new Date().toISOString();
    try {
      const res = await fetch(API_URL, { timeout: 15000 });
      const txt = await res.text();
      append('['+ts+'] API snapshot:');
      append(txt);
    } catch (e) {
      append('['+ts+'] API error: '+(e && e.message ? e.message : String(e)));
    }

    // append tail of server.log
    try {
      const s = fs.readFileSync(SERVER_LOG, 'utf8');
      const lines = s.split(/\r?\n/).filter(Boolean);
      const tail = lines.slice(-200).join('\n');
      append('['+ts+'] server.log tail:');
      append(tail);
    } catch(e) {
      append('['+ts+'] server.log read error: '+(e && e.message ? e.message : String(e)));
    }

    // sleep
    if (i < ITERATIONS-1) await new Promise(r=>setTimeout(r, INTERVAL_SECS*1000));
  }

  append('--- Monitor finished: ' + new Date().toISOString() + ' ---');
  try { fs.unlinkSync(PID); } catch(e){}
  process.exit(0);
})();
