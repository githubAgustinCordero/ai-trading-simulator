#!/bin/bash

# Script para mostrar las estrategias y frecuencias en tiempo real

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

clear

echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║           ${BOLD}🤖 AI TRADING STRATEGIES${NC}${CYAN}                   ║${NC}"
echo -e "${CYAN}║              Análisis en Tiempo Real                 ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Función para obtener datos de la API
get_api_data() {
    curl -s http://localhost:3001/api/status 2>/dev/null || echo "{\"success\": false}"
}

# Función para extraer valor JSON
extract_json_value() {
    local json="$1"
    local key="$2"
    echo "$json" | grep -o "\"$key\":[0-9.-]*" | cut -d':' -f2 | head -1
}

# Función para extraer string JSON
extract_json_string() {
    local json="$1"
    local key="$2"
    echo "$json" | grep -o "\"$key\":\"[^\"]*\"" | cut -d':' -f2 | tr -d '"'
}

# Obtener datos
echo -e "${YELLOW}📡 Obteniendo datos del mercado...${NC}"
API_DATA=$(get_api_data)

if echo "$API_DATA" | grep -q '"success":true'; then
    echo -e "${GREEN}✅ Conexión exitosa${NC}"
    echo ""
    
    # Extraer datos
    BTC_PRICE=$(extract_json_value "$API_DATA" "price")
    TOTAL_RETURN=$(extract_json_value "$API_DATA" "totalReturn")
    IS_ACTIVE=$(extract_json_string "$API_DATA" "isActive")
    CONFIDENCE=$(extract_json_value "$API_DATA" "confidence")
    SIGNAL=$(extract_json_string "$API_DATA" "signal")
    TOTAL_TRADES=$(extract_json_value "$API_DATA" "totalTrades")
    
    # Mostrar información actual
    echo -e "${BOLD}📊 ESTADO ACTUAL DEL MERCADO${NC}"
    echo -e "${BLUE}════════════════════════════════════════${NC}"
    echo -e "${BOLD}₿ Precio Bitcoin:${NC} \$$(printf "%'.0f" $BTC_PRICE 2>/dev/null || echo "N/A")"
    echo -e "${BOLD}📈 Rendimiento:${NC} $(printf "%.2f" $TOTAL_RETURN 2>/dev/null || echo "0.00")%"
    echo -e "${BOLD}🤖 Bot Estado:${NC} $([ "$IS_ACTIVE" = "true" ] && echo "${GREEN}ACTIVO${NC}" || echo "${RED}INACTIVO${NC}")"
    echo -e "${BOLD}🎯 Señal Actual:${NC} $SIGNAL"
    echo -e "${BOLD}📊 Confianza:${NC} $(printf "%.0f" $CONFIDENCE 2>/dev/null || echo "0")%"
    echo -e "${BOLD}💹 Operaciones:${NC} $(printf "%.0f" $TOTAL_TRADES 2>/dev/null || echo "0")"
    echo ""
else
    echo -e "${RED}❌ Error de conexión${NC}"
    echo ""
fi

echo -e "${BOLD}🧠 ESTRATEGIAS IMPLEMENTADAS${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"

echo -e "${GREEN}1. SMA (Simple Moving Average)${NC}"
echo -e "   📊 Períodos: SMA20, SMA50"
echo -e "   🎯 Señal: Precio > SMA20 > SMA50 → COMPRAR"
echo -e "   💪 Peso: +20% confianza"
echo ""

echo -e "${GREEN}2. RSI (Relative Strength Index)${NC}"
echo -e "   📊 Período: 14 períodos"
echo -e "   🎯 Sobreventa (RSI < 30) → COMPRAR"
echo -e "   🎯 Sobrecompra (RSI > 70) → VENDER"
echo -e "   💪 Peso: +25% confianza"
echo ""

echo -e "${GREEN}3. MACD (Moving Average Convergence Divergence)${NC}"
echo -e "   📊 Configuración: EMA12 - EMA26"
echo -e "   🎯 Cruce alcista → COMPRAR"
echo -e "   🎯 Cruce bajista → VENDER"
echo -e "   💪 Peso: +15% confianza"
echo ""

echo -e "${GREEN}4. Bollinger Bands${NC}"
echo -e "   📊 Período: 20, Desviación: 2σ"
echo -e "   🎯 Identificación de volatilidad"
echo -e "   💪 Uso: Confirmación de señales"
echo ""

echo -e "${BOLD}⏰ FRECUENCIAS DE ACTUALIZACIÓN${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"

echo -e "${CYAN}🔄 Análisis de Mercado:${NC}"
echo -e "   ⏱️  Cada 30 segundos"
echo -e "   🎯 Función: executeStrategy()"
echo -e "   📊 Actividades: Precio, indicadores, señales, operaciones"
echo ""

echo -e "${CYAN}💹 Datos de CoinGecko:${NC}"
echo -e "   ⏱️  Cada 30 segundos"
echo -e "   🎯 Función: getCurrentPrice()"
echo -e "   📊 Datos: Precio, volumen, cambio 24h"
echo ""

echo -e "${CYAN}📱 Dashboard Web:${NC}"
echo -e "   ⏱️  Tiempo real (WebSocket)"
echo -e "   🎯 Función: broadcastUpdate()"
echo -e "   📊 Actualiza: Métricas, estado, operaciones"
echo ""

echo -e "${CYAN}📈 Reportes de Estado:${NC}"
echo -e "   ⏱️  Cada 5 minutos"
echo -e "   🎯 Función: Estado del portafolio"
echo -e "   📊 Info: Balance, BTC, rendimiento"
echo ""

echo -e "${BOLD}🛡️ GESTIÓN DE RIESGO${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"

echo -e "${YELLOW}⚙️ Configuración Actual:${NC}"
echo -e "   💰 Posición máxima: 80% del capital"
echo -e "   🛑 Stop Loss: 5% automático"
echo -e "   🎯 Take Profit: 10% automático"
echo -e "   🎲 Riesgo por trade: 2% del capital"
echo -e "   ⏱️  Cooldown: 5 minutos entre operaciones"
echo -e "   ❌ Límite pérdidas: 3 consecutivas"
echo ""

echo -e "${YELLOW}🎯 Umbral de Confianza:${NC}"
echo -e "   📊 Mínimo para operar: 40%"
echo -e "   💡 Cálculo: SMA(20%) + RSI(25%) + MACD(15%)"
echo ""

echo -e "${BOLD}📈 PRÓXIMO ANÁLISIS${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"

# Calcular próximo análisis
NEXT_ANALYSIS=$(date -d '+30 seconds' '+%H:%M:%S')
echo -e "${GREEN}⏰ Próximo análisis: ${NEXT_ANALYSIS}${NC}"
echo -e "${GREEN}🔄 Estado del bot: $([ "$IS_ACTIVE" = "true" ] && echo "Monitoreando mercado" || echo "En espera")${NC}"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║            🔧 COMANDOS               ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo -e "${GREEN}Ver dashboard:${NC} http://agubot.ddns.net:3001"
echo -e "${GREEN}Gestión completa:${NC} ./manage.sh"
echo -e "${GREEN}Logs en tiempo real:${NC} ./manage.sh logs"
echo -e "${GREEN}Estado detallado:${NC} ./manage.sh status"

echo ""