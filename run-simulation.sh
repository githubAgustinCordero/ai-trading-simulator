#!/bin/bash

echo "🚀 Iniciando simulación directa..."

cd /var/www/agubot.ddns.net/ai-trading-simulator

# Iniciar servidor
echo "📡 Iniciando servidor..."
node server.js &
SERVER_PID=$!

# Función para cleanup
cleanup() {
    echo "� Deteniendo servidor..."
    kill $SERVER_PID 2>/dev/null
    wait $SERVER_PID 2>/dev/null
}

# Configurar cleanup en exit
trap cleanup EXIT

# Esperar a que el servidor esté listo (máximo 10 segundos)
echo "⏳ Esperando servidor..."
for i in {1..10}; do
    if curl -s http://localhost:9999/api/status > /dev/null 2>&1; then
        echo "✅ Servidor listo"
        break
    fi
    sleep 1
done

# Verificar una vez más
if ! curl -s http://localhost:9999/api/status > /dev/null 2>&1; then
    echo "❌ Servidor no responde después de 10 segundos"
    exit 1
fi

# Cambiar estrategia
echo "🎯 Configurando estrategia estocastico909..."
curl -s -X POST http://localhost:9999/api/bot/strategy \
    -H "Content-Type: application/json" \
    -d '{"strategy": "maxi1"}' > /dev/null

# Ejecutar simulación
echo "📈 Ejecutando simulación..."
./simulate-trades.sh

echo "✅ Simulación completada"