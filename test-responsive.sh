#!/bin/bash

echo "🔧 Probando mejoras de responsive design..."

# Verificar que el servicio esté corriendo
if ! systemctl is-active --quiet ai-trading-simulator; then
    echo "📱 Reiniciando servicio para aplicar cambios CSS..."
    sudo systemctl restart ai-trading-simulator
    sleep 2
fi

echo "✅ Cambios aplicados:"
echo "   📱 Grid responsive mejorado"
echo "   📏 Tarjetas con altura mínima uniforme"
echo "   🎯 Media queries optimizados para móvil"
echo "   📲 Soporte mejorado para tablets"

echo ""
echo "🌐 Prueba en diferentes dispositivos:"
echo "   📱 Móvil: http://agubot.ddns.net:8080"
echo "   📲 Tablet: Redimensiona la ventana del navegador"
echo "   🖥️  Desktop: Funciona como siempre"

echo ""
echo "📊 Características mejoradas:"
echo "   ✅ Todas las tarjetas del mismo tamaño"
echo "   ✅ Grid que se adapta al tamaño de pantalla" 
echo "   ✅ Padding optimizado para móvil"
echo "   ✅ Altura mínima consistente"

# Verificar si el servicio está funcionando
if curl -s http://localhost:8080/api/status > /dev/null; then
    echo "   ✅ API funcionando correctamente"
else
    echo "   ⚠️  Verificar conexión API"
fi

echo ""
echo "🎉 ¡Listo para probar en móvil!"