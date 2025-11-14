#!/bin/bash

# Script para generar logs de ejemplo en el AI Trading Simulator

echo "🧪 Generando logs de ejemplo para demostrar el sistema..."

# Función para enviar logs al dashboard
send_log() {
    local message="$1"
    local level="$2"
    
    curl -s -X POST http://localhost:3001/api/test-log \
         -H "Content-Type: application/json" \
         -d "{\"message\": \"$message\", \"level\": \"$level\"}" > /dev/null
}

# Generar logs de ejemplo
echo "📊 Enviando logs de prueba..."

send_log "Sistema iniciado correctamente" "success"
sleep 1

send_log "Conectado a la API de CoinGecko" "info"
sleep 1

send_log "Precio de Bitcoin actualizado: \$67,234" "info"
sleep 1

send_log "Análisis técnico completado - RSI: 45.2" "info"
sleep 1

send_log "Señal de compra detectada - Confianza: 78%" "trade"
sleep 1

send_log "Ejecutando compra: 0.00145 BTC" "trade"
sleep 1

send_log "Compra ejecutada exitosamente" "success"
sleep 1

send_log "Stop loss configurado en 5%" "warning"
sleep 1

send_log "Análisis de mercado en progreso..." "info"
sleep 1

send_log "Rendimiento actual: +2.34%" "success"

echo "✅ Logs de ejemplo enviados al dashboard"
echo "🌐 Abre http://agubot.ddns.net:3001 para ver los resultados"