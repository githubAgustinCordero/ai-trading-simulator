#!/usr/bin/env bash
# Minimal safe monitor runner (temporary)
BASE_DIR="/var/www/agubot.ddns.net/ai-trading-simulator-old"
ALERT_LOG="$BASE_DIR/monitor/alerts.log"
mkdir -p "$BASE_DIR/monitor"
echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') MONITOR: heartbeat" >> "$ALERT_LOG"
exit 0
#!/usr/bin/env bash
# Lightweight monitor for ai-trading-simulator
# - checks /api/status
# - scans DB for residual open positions below threshold
# - scans journalctl for repeated duplicate-open warnings
# - logs alerts to monitor/alerts.log and optionally POSTs to $ALERT_WEBHOOK

BASE_DIR="/var/www/agubot.ddns.net/ai-trading-simulator-old"
API_URL="http://localhost:8080/api/status"
DB_PATH="$BASE_DIR/trading_simulator_agustin.db"
ALERT_LOG="$BASE_DIR/monitor/alerts.log"
SMALL_THRESHOLD=${SMALL_POSITION_USD:-200}
JOURNAL_PATTERN="Omitiendo apertura duplicada"

timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

log_alert() {
  local msg="$1"
  echo "$(timestamp) ALERT: $msg" | tee -a "$ALERT_LOG"
  # If webhook configured, POST JSON
  if [ -n "$ALERT_WEBHOOK" ]; then
    curl -sS -X POST -H "Content-Type: application/json" -d 
      "{\"timestamp\":\"$(timestamp)\",\"message\":\"$msg\"}" "$ALERT_WEBHOOK" >/dev/null 2>&1 || true
  #!/usr/bin/env bash
  # Lightweight monitor for ai-trading-simulator
  # - checks /api/status
  # - scans DB for residual open positions below threshold
  # - scans journalctl for repeated duplicate-open warnings
  # - logs alerts to monitor/alerts.log and optionally POSTs to $ALERT_WEBHOOK

  BASE_DIR="/var/www/agubot.ddns.net/ai-trading-simulator-old"
  API_URL="http://localhost:8080/api/status"
  DB_PATH="$BASE_DIR/trading_simulator_agustin.db"
  ALERT_LOG="$BASE_DIR/monitor/alerts.log"
  SMALL_THRESHOLD=${SMALL_POSITION_USD:-200}
  JOURNAL_PATTERN="Omitiendo apertura duplicada"

  timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

  log_alert() {
    local msg="$1"
    echo "$(timestamp) ALERT: $msg" | tee -a "$ALERT_LOG"
    # If webhook configured, POST JSON
    if [ -n "$ALERT_WEBHOOK" ]; then
      curl -sS -X POST -H "Content-Type: application/json" -d "$(printf '%s' "{\"timestamp\":\"%s\",\"message\":\"%s\"}" "$(timestamp)" "${msg//"/\"}")" "$ALERT_WEBHOOK" >/dev/null 2>&1 || true
    #!/usr/bin/env bash
    # Lightweight monitor for ai-trading-simulator
    # - checks /api/status
    # - scans DB for residual open positions below threshold
    # - scans journalctl for repeated duplicate-open warnings
    # - logs alerts to monitor/alerts.log and optionally POSTs to $ALERT_WEBHOOK

    BASE_DIR="/var/www/agubot.ddns.net/ai-trading-simulator-old"
    API_URL="http://localhost:8080/api/status"
    DB_PATH="$BASE_DIR/trading_simulator_agustin.db"
    ALERT_LOG="$BASE_DIR/monitor/alerts.log"
    SMALL_THRESHOLD=${SMALL_POSITION_USD:-200}
    JOURNAL_PATTERN="Omitiendo apertura duplicada"

    timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

    log_alert() {
      local msg="$1"
      echo "$(timestamp) ALERT: $msg" | tee -a "$ALERT_LOG"
      # If webhook configured, POST JSON
      if [ -n "$ALERT_WEBHOOK" ]; then
        local payload
        payload=$(printf '%s' "{\"timestamp\":\"%s\",\"message\":\"%s\"}" "$(timestamp)" "${msg//"/\"}")
        curl -sS -X POST -H "Content-Type: application/json" -d "$payload" "$ALERT_WEBHOOK" >/dev/null 2>&1 || true
      #!/usr/bin/env bash
      # Lightweight monitor for ai-trading-simulator
      # - checks /api/status
      # - scans DB for residual open positions below threshold
      # - scans journalctl for repeated duplicate-open warnings
      # - logs alerts to monitor/alerts.log and optionally POSTs to $ALERT_WEBHOOK

      BASE_DIR="/var/www/agubot.ddns.net/ai-trading-simulator-old"
      API_URL="http://localhost:8080/api/status"
      DB_PATH="$BASE_DIR/trading_simulator_agustin.db"
      ALERT_LOG="$BASE_DIR/monitor/alerts.log"
      SMALL_THRESHOLD=${SMALL_POSITION_USD:-200}
      JOURNAL_PATTERN="Omitiendo apertura duplicada"

      timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

      log_alert() {
        local msg="$1"
        echo "$(timestamp) ALERT: $msg" | tee -a "$ALERT_LOG"
        # If webhook configured, POST JSON
        if [ -n "$ALERT_WEBHOOK" ]; then
          local payload
          payload=$(printf '%s' "{\"timestamp\":\"%s\",\"message\":\"%s\"}" "$(timestamp)" "${msg//"/\"}")
          curl -sS -X POST -H "Content-Type: application/json" -d "$payload" "$ALERT_WEBHOOK" >/dev/null 2>&1 || true
        #!/usr/bin/env bash
        # Lightweight monitor for ai-trading-simulator
        # - checks /api/status
        # - scans DB for residual open positions below threshold
        # - scans journalctl for repeated duplicate-open warnings
        # - logs alerts to monitor/alerts.log and optionally POSTs to $ALERT_WEBHOOK

        BASE_DIR="/var/www/agubot.ddns.net/ai-trading-simulator-old"
        API_URL="http://localhost:8080/api/status"
        DB_PATH="$BASE_DIR/trading_simulator_agustin.db"
        ALERT_LOG="$BASE_DIR/monitor/alerts.log"
        SMALL_THRESHOLD=${SMALL_POSITION_USD:-200}
        JOURNAL_PATTERN="Omitiendo apertura duplicada"

        timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

        log_alert() {
          local msg="$1"
          echo "$(timestamp) ALERT: $msg" | tee -a "$ALERT_LOG"
          # If webhook configured, POST JSON
          if [ -n "$ALERT_WEBHOOK" ]; then
            local payload
            payload=$(printf '%s' "{\"timestamp\":\"%s\",\"message\":\"%s\"}" "$(timestamp)" "${msg//"/\"}")
            curl -sS -X POST -H "Content-Type: application/json" -d "$payload" "$ALERT_WEBHOOK" >/dev/null 2>&1 || true
          fi
        }

        check_api() {
          local out
          out=$(curl -sS --max-time 5 "$API_URL" ) || { log_alert "Cannot reach $API_URL"; return 1; }
          # check bot active
          local isActive
          isActive=$(echo "$out" | grep -o '"isActive"[[:space:]]*:[[:space:]]*true' || true)
          if [ -z "$isActive" ]; then
            log_alert "API reachable but bot.isActive != true"
          fi
        }

        check_db_residuals() {
          # Find position_ids whose last trade action is 'open' (i.e. no corresponding close)
          sqlite3 -separator '|' "$DB_PATH" <<'SQL' | while IFS='|' read -r pid side usd price ts; do
        SELECT t.position_id, t.position_side, t.usd_amount, t.price, t.timestamp
        FROM trades t
        WHERE t.position_id IS NOT NULL
          AND t.timestamp = (SELECT max(timestamp) FROM trades t2 WHERE t2.position_id = t.position_id)
          AND t.action = 'open'
        ORDER BY t.usd_amount ASC;
        SQL
              if [ -z "$pid" ] || [ -z "$usd" ]; then continue; fi
              # normalize usd to float
              usd_num=$(echo "$usd" | tr -d -c '0-9.' )
              usd_num=${usd_num:-0}
              usd_floor=$(printf "%.2f" "$usd_num")
              if awk -v u="$usd_num" -v th="$SMALL_THRESHOLD" 'BEGIN{ if(u+0 < th+0) print "small" }' | grep -q "small"; then
                log_alert "Small residual open position: $pid side=$side usd=$usd_floor price=$price ts=$ts"
                continue
              fi
              log_alert "Open position detected: $pid side=$side usd=$usd_floor price=$price ts=$ts"
            done
        }

        check_journal() {
          if command -v journalctl >/dev/null 2>&1; then
            local hits
            hits=$(sudo journalctl -u ai-trading-simulator -n 200 --no-pager | grep -c "$JOURNAL_PATTERN" || true)
            if [ -n "$hits" ] && [ "$hits" -gt 5 ]; then
              log_alert "Detected $hits occurrences of '$JOURNAL_PATTERN' in recent logs"
            fi
          fi
        }

        main() {
          mkdir -p "$BASE_DIR/monitor"
          check_api
          check_db_residuals
          check_journal
        }

        if [ "${BASH_SOURCE[0]}" = "$0" ]; then
          main
        fi
