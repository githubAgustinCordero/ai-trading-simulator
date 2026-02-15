#!/bin/bash

# Script para gestionar el AI Trading Simulator

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Directorio del proyecto
PROJECT_DIR="/var/www/agubot.ddns.net/ai-trading-simulator-old-old"
SERVICE_NAME="ai-trading-simulator"

# Función para mostrar el estado
show_status() {
    echo -e "${BLUE}=== AI Trading Simulator - Estado ===${NC}"
    
    if systemctl is-active --quiet $SERVICE_NAME; then
        echo -e "Estado: ${GREEN}ACTIVO${NC}"
        echo -e "URL: ${BLUE}http://agubot.ddns.net:3001${NC}"
        echo -e "Logs: sudo journalctl -u $SERVICE_NAME -f"
    else
        echo -e "Estado: ${RED}INACTIVO${NC}"
    fi
    
    echo ""
    echo -e "${YELLOW}Comandos disponibles:${NC}"
    echo "  ./manage.sh start    - Iniciar el simulador"
    echo "  ./manage.sh stop     - Detener el simulador"
    echo "  ./manage.sh restart  - Reiniciar el simulador"
    echo "  ./manage.sh logs     - Ver logs en tiempo real"
    echo "  ./manage.sh install  - Instalar como servicio"
    echo "  ./manage.sh dev      - Ejecutar en modo desarrollo"
}

# Función para instalar el servicio
install_service() {
    echo -e "${YELLOW}Instalando servicio del sistema...${NC}"
    
    # Copiar archivo de servicio
    sudo cp "$PROJECT_DIR/ai-trading-simulator.service" "/etc/systemd/system/"
    
    # Recargar systemd
    sudo systemctl daemon-reload
    
    # Habilitar servicio
    sudo systemctl enable $SERVICE_NAME
    
    echo -e "${GREEN}Servicio instalado correctamente${NC}"
}

# Función para iniciar
start_service() {
    echo -e "${YELLOW}Iniciando AI Trading Simulator...${NC}"
    sudo systemctl start $SERVICE_NAME
    
    sleep 2
    
    if systemctl is-active --quiet $SERVICE_NAME; then
        echo -e "${GREEN}✅ Simulador iniciado correctamente${NC}"
        echo -e "${BLUE}Dashboard: http://agubot.ddns.net:3001${NC}"
    else
        echo -e "${RED}❌ Error iniciando el simulador${NC}"
        sudo journalctl -u $SERVICE_NAME -n 20
    fi
}

# Función para detener
stop_service() {
    echo -e "${YELLOW}Deteniendo AI Trading Simulator...${NC}"
    sudo systemctl stop $SERVICE_NAME
    echo -e "${GREEN}✅ Simulador detenido${NC}"
}

# Función para reiniciar
restart_service() {
    echo -e "${YELLOW}Reiniciando AI Trading Simulator...${NC}"
    sudo systemctl restart $SERVICE_NAME
    
    sleep 2
    
    if systemctl is-active --quiet $SERVICE_NAME; then
        echo -e "${GREEN}✅ Simulador reiniciado correctamente${NC}"
        echo -e "${BLUE}Dashboard: http://agubot.ddns.net:3001${NC}"
    else
        echo -e "${RED}❌ Error reiniciando el simulador${NC}"
        sudo journalctl -u $SERVICE_NAME -n 20
    fi
}

# Función para mostrar logs
show_logs() {
    echo -e "${YELLOW}Mostrando logs en tiempo real (Ctrl+C para salir)...${NC}"
    sudo journalctl -u $SERVICE_NAME -f
}

# Función para modo desarrollo
dev_mode() {
    echo -e "${YELLOW}Iniciando en modo desarrollo...${NC}"
    cd "$PROJECT_DIR"
    
    if [ ! -f "node_modules/.bin/nodemon" ]; then
        echo -e "${BLUE}Instalando nodemon...${NC}"
        npm install --save-dev nodemon
    fi
    
    echo -e "${GREEN}Servidor de desarrollo iniciado en http://localhost:3000${NC}"
    echo -e "${YELLOW}Presiona Ctrl+C para detener${NC}"
    npm run dev
}

# Función para actualizar el código
update_code() {
    echo -e "${YELLOW}Actualizando código...${NC}"
    cd "$PROJECT_DIR"
    
    # Detener servicio si está corriendo
    if systemctl is-active --quiet $SERVICE_NAME; then
        stop_service
        WAS_RUNNING=true
    else
        WAS_RUNNING=false
    fi
    
    # Instalar dependencias si es necesario
    npm install
    
    # Reiniciar si estaba corriendo
    if [ "$WAS_RUNNING" = true ]; then
        start_service
    fi
    
    echo -e "${GREEN}✅ Código actualizado${NC}"
}

# Función para mostrar estadísticas
show_stats() {
    echo -e "${BLUE}=== Estadísticas del Sistema ===${NC}"
    
    if systemctl is-active --quiet $SERVICE_NAME; then
        echo -e "PID: $(systemctl show $SERVICE_NAME -p MainPID --value)"
        echo -e "Memoria: $(ps -p $(systemctl show $SERVICE_NAME -p MainPID --value) -o rss= | awk '{print $1/1024 " MB"}')"
        echo -e "Tiempo activo: $(systemctl show $SERVICE_NAME -p ActiveEnterTimestamp --value)"
    else
        echo -e "${RED}Servicio no está corriendo${NC}"
    fi
}

# Función principal
case "$1" in
    start)
        start_service
        ;;
    stop)
        stop_service
        ;;
    restart)
        restart_service
        ;;
    logs)
        show_logs
        ;;
    install)
        install_service
        ;;
    dev)
        dev_mode
        ;;
    update)
        update_code
        ;;
    stats)
        show_stats
        ;;
    status|"")
        show_status
        ;;
    *)
        echo -e "${RED}Comando no válido: $1${NC}"
        show_status
        exit 1
        ;;
esac