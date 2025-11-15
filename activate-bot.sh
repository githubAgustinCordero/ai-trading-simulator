#!/bin/bash

echo "🚀 Activando bot de trading en modo automático..."

cd /var/www/agubot.ddns.net/ai-trading-simulator

# Iniciar servidor en background
echo "📡 Iniciando servidor..."
node server.js &
SERVER_PID=$!

# Esperar a que esté listo
echo "⏳ Esperando servidor..."
for i in {1..10}; do
    if curl -s http://localhost:9999/api/status > /dev/null 2>&1; then
        echo "✅ Servidor listo"
        break
    fi
    sleep 1
done

# Verificar que esté corriendo
if ! curl -s http://localhost:9999/api/status > /dev/null 2>&1; then
    echo "❌ Servidor no responde"
    kill $SERVER_PID 2>/dev/null
    exit 1
fi

# Configurar estrategia
echo "🎯 Configurando estrategia estocastico909..."
curl -s -X POST http://localhost:9999/api/bot/strategy \
    -H "Content-Type: application/json" \
    -d '{"strategy": "maxi1"}' > /dev/null

# Activar bot
echo "🤖 Activando bot..."
RESPONSE=$(curl -s -X POST http://localhost:9999/api/bot/start \
  -H "Content-Type: application/json" \
  -d '{}')

if echo "$RESPONSE" | grep -q '"success":true'; then
    echo "✅ Bot activado exitosamente!"
    echo "📊 El bot está operando con estrategia 90-9 Estocástico"
    echo "🔄 Monitorea el dashboard en: http://agubot.ddns.net:9999"
else
    echo "❌ Error activando bot: $RESPONSE"
    kill $SERVER_PID 2>/dev/null
    exit 1
fi

echo ""
echo "💡 El bot ahora:"
echo "   • Abrirá LONG con señales alcistas"
echo "   • Cambiará a SHORT con señales bajistas"
echo "   • Gestionará posiciones automáticamente"
echo ""

# Mantener el script corriendo para que el servidor siga vivo
echo "🔄 Servidor corriendo en background (PID: $SERVER_PID)"
echo "💡 Presiona Ctrl+C para detener"

# Función de cleanup
cleanup() {
    echo ""
    echo "🛑 Deteniendo servidor..."
    kill $SERVER_PID 2>/dev/null
    wait $SERVER_PID 2>/dev/null
    echo "✅ Servidor detenido"
}

trap cleanup EXIT

# Mantener vivo
while true; do
    sleep 1
    # Verificar que el servidor siga vivo
    if ! kill -0 $SERVER_PID 2>/dev/null; then
        echo "❌ Servidor se detuvo inesperadamente"
        exit 1
    fi
done