#!/bin/bash

# Script de acceso rápido al AI Trading Simulator
# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

clear

echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║            ${BOLD}🤖 AI TRADING SIMULATOR${NC}${CYAN}                  ║${NC}"
echo -e "${CYAN}║                 Competencia $10,000                  ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Verificar estado del servicio
if systemctl is-active --quiet ai-trading-simulator; then
    STATUS="${GREEN}✅ ACTIVO${NC}"
    COLOR=$GREEN
else
    STATUS="${RED}❌ INACTIVO${NC}"
    COLOR=$RED
fi

echo -e "${BOLD}Estado del Sistema:${NC} $STATUS"
echo ""

# Obtener datos en tiempo real
echo -e "${YELLOW}📊 Obteniendo datos en tiempo real...${NC}"
if curl -s http://localhost:3001/api/status >/dev/null 2>&1; then
    DATA=$(curl -s http://localhost:3001/api/status)
    
    # Extraer datos usando grep y sed
    BALANCE=$(echo "$DATA" | grep -o '"totalValue":[0-9.]*' | cut -d':' -f2)
    BTC_PRICE=$(echo "$DATA" | grep -o '"price":[0-9.]*' | cut -d':' -f2)
    TOTAL_RETURN=$(echo "$DATA" | grep -o '"totalReturn":[0-9.-]*' | cut -d':' -f2)
    IS_ACTIVE=$(echo "$DATA" | grep -o '"isActive":[a-z]*' | cut -d':' -f2)
    TRADES=$(echo "$DATA" | grep -o '"totalTrades":[0-9]*' | cut -d':' -f2)
    
    echo -e "${BOLD}💰 Capital Total:${NC} \$$(printf "%.2f" $BALANCE)"
    echo -e "${BOLD}₿ Precio Bitcoin:${NC} \$$(printf "%'.0f" $BTC_PRICE)"
    echo -e "${BOLD}📈 Rendimiento:${NC} $(printf "%.2f" $TOTAL_RETURN)%"
    echo -e "${BOLD}🤖 Bot Activo:${NC} $([ "$IS_ACTIVE" = "true" ] && echo "${GREEN}Sí${NC}" || echo "${RED}No${NC}")"
    echo -e "${BOLD}💹 Operaciones:${NC} $TRADES"
else
    echo -e "${RED}❌ No se pudo conectar con la API${NC}"
fi

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║             🔧 OPCIONES               ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}1)${NC} 🚀 Abrir Dashboard (navegador)"
echo -e "${GREEN}2)${NC} ▶️  Iniciar Bot de Trading"
echo -e "${GREEN}3)${NC} ⏹️  Detener Bot de Trading"
echo -e "${GREEN}4)${NC} 📊 Ver Estado Detallado"
echo -e "${GREEN}5)${NC} 📋 Ver Logs en Tiempo Real"
echo -e "${GREEN}6)${NC} 🔄 Reiniciar Sistema"
echo -e "${GREEN}7)${NC} 📈 Ver Página de Acceso"
echo -e "${RED}0)${NC} ❌ Salir"
echo ""

read -p "$(echo -e ${BOLD}Selecciona una opción [0-7]:${NC} )" choice

case $choice in
    1)
        echo -e "${BLUE}🌐 Abriendo dashboard en el navegador...${NC}"
        if command -v xdg-open > /dev/null; then
            xdg-open http://agubot.ddns.net:3001
        elif command -v firefox > /dev/null; then
            firefox http://agubot.ddns.net:3001 &
        elif command -v chromium-browser > /dev/null; then
            chromium-browser http://agubot.ddns.net:3001 &
        else
            echo -e "${YELLOW}Abre manualmente: ${BOLD}http://agubot.ddns.net:3001${NC}"
        fi
        ;;
    2)
        echo -e "${GREEN}▶️ Iniciando bot de trading...${NC}"
        cd /var/www/agubot.ddns.net/ai-trading-simulator && ./manage.sh start
        ;;
    3)
        echo -e "${YELLOW}⏹️ Deteniendo bot de trading...${NC}"
        cd /var/www/agubot.ddns.net/ai-trading-simulator && ./manage.sh stop
        ;;
    4)
        echo -e "${BLUE}📊 Estado detallado del sistema:${NC}"
        cd /var/www/agubot.ddns.net/ai-trading-simulator && ./manage.sh status
        ;;
    5)
        echo -e "${CYAN}📋 Logs en tiempo real (Ctrl+C para salir):${NC}"
        cd /var/www/agubot.ddns.net/ai-trading-simulator && ./manage.sh logs
        ;;
    6)
        echo -e "${YELLOW}🔄 Reiniciando sistema...${NC}"
        read -p "$(echo -e ${RED}¿Estás seguro? Esto borrará el historial [y/N]:${NC} )" confirm
        if [[ $confirm =~ ^[Yy]$ ]]; then
            cd /var/www/agubot.ddns.net/ai-trading-simulator
            curl -X POST http://localhost:3001/api/bot/reset
            echo -e "${GREEN}✅ Sistema reiniciado${NC}"
        else
            echo -e "${BLUE}Operación cancelada${NC}"
        fi
        ;;
    7)
        echo -e "${BLUE}📈 Abriendo página de acceso...${NC}"
        if command -v xdg-open > /dev/null; then
            xdg-open http://agubot.ddns.net/ai-trading-simulator/access.html
        else
            echo -e "${YELLOW}Abre manualmente: ${BOLD}http://agubot.ddns.net/ai-trading-simulator/access.html${NC}"
        fi
        ;;
    0)
        echo -e "${GREEN}👋 ¡Hasta luego!${NC}"
        exit 0
        ;;
    *)
        echo -e "${RED}❌ Opción inválida${NC}"
        ;;
esac

echo ""
echo -e "${CYAN}Presiona Enter para continuar...${NC}"
read