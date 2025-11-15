#!/bin/bash

# Script para simular la secuencia: Abrir LONG manualmente -> Cambiar a SHORT

echo "🚀 Iniciando simulación de posiciones para el bot..."

# Esperar un poco para que el servidor esté listo
sleep 2

echo "📈 Abriendo posición LONG manualmente..."
curl -s -X POST http://localhost:9999/api/test/long \
  -H "Content-Type: application/json" \
  -d '{"action": "open", "amount": 5000}' | python3 -m json.tool

echo ""
sleep 2

echo "📉 Cambiando a SHORT usando señal SELL con indicadores fuertes..."
curl -s -X POST http://localhost:9999/api/test/signal \
  -H "Content-Type: application/json" \
  -d '{
    "signal": "SELL",
    "confidence": 70,
    "reason": "Simulación SELL para cambiar a SHORT"
  }' | python3 -m json.tool

echo ""
echo "✅ Simulación completada. Revisa el dashboard para ver las posiciones."