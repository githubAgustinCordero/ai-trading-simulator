# 🤖 AI Trading Simulator - Guía de Usuario

## 🎯 ¿Qué es?

El **AI Trading Simulator** es un simulador de trading automático que utiliza inteligencia artificial para gestionar $10,000 virtuales en el mercado spot de Bitcoin. Está inspirado en las competencias reales donde diferentes IAs (como DeepSeek, Grok, Gemini, ChatGPT) compiten por obtener el mejor rendimiento.

## 🚀 Características Principales

### 💰 Gestión de Capital
- **Capital inicial**: $10,000 USD simulados
- **Mercado**: Bitcoin (BTC/USD) Spot
- **Fees realistas**: 0.1% por operación
- **Stop Loss**: 5% automático
- **Take Profit**: 10% automático

### 🧠 Inteligencia Artificial
- **Análisis técnico avanzado**: RSI, MACD, SMA, EMA, Bollinger Bands
- **Toma de decisiones autónoma**: El bot decide cuándo comprar/vender
- **Gestión de riesgo**: Máximo 2% del capital por operación
- **Control de pérdidas**: Límite de 3 operaciones perdedoras consecutivas

### 📊 Visualización en Tiempo Real
- **Dashboard interactivo**: Métricas actualizadas cada 30 segundos
- **WebSocket**: Actualizaciones instantáneas
- **Historial completo**: Todas las operaciones registradas
- **Estadísticas detalladas**: Win rate, drawdown, Sharpe ratio

## 🎮 Cómo Usar

### 1. Acceso al Sistema
- **URL principal**: [http://agubot.ddns.net:3001](http://agubot.ddns.net:3001)
- **Acceso rápido**: Desde el portafolio principal en "🤖 Inteligencia Artificial"

### 2. Control del Bot
```bash
# Panel web (recomendado)
- Botón "▶️ Iniciar Bot" 
- Botón "⏹️ Detener Bot"
- Botón "🔄 Reiniciar" (borra todo el historial)

# Terminal (avanzado)
cd /var/www/agubot.ddns.net/ai-trading-simulator-old-old
./manage.sh start    # Iniciar bot
./manage.sh stop     # Detener bot
./manage.sh restart  # Reiniciar
./manage.sh logs     # Ver logs en tiempo real
./manage.sh status   # Estado actual
```

### 3. Interpretando el Dashboard

#### 💼 Portafolio
- **Valor Total**: Capital actual (USD + BTC convertido)
- **Balance USD**: Dinero disponible para compras
- **Bitcoin**: Cantidad de BTC en posesión
- **Rendimiento**: Ganancia/pérdida porcentual

#### 📈 Datos de Mercado
- **Precio BTC**: Precio actual de Bitcoin (CoinGecko API)
- **Cambio 24h**: Variación en las últimas 24 horas
- **Estado del Bot**: Activo/Inactivo

#### 🧠 Análisis de IA
- **Señal Actual**: BUY/SELL/HOLD
- **Confianza**: Nivel de certeza (0-100%)
- **Indicadores**: RSI, SMA20/50, MACD

#### 📊 Estadísticas
- **Total Operaciones**: Número de trades realizados
- **Tasa de Éxito**: Porcentaje de operaciones ganadoras
- **Max Drawdown**: Máxima pérdida desde el pico

## 🔧 Configuración Técnica

### Servicios del Sistema
```bash
# El simulador funciona como servicio systemd
sudo systemctl status ai-trading-simulator
sudo systemctl start ai-trading-simulator
sudo systemctl stop ai-trading-simulator

# Logs del sistema
sudo journalctl -u ai-trading-simulator -f
```

### Archivos Importantes
```
ai-trading-simulator/
├── server.js           # Servidor principal Express + WebSocket
├── marketData.js       # Conexión con APIs de mercado
├── tradingBot.js       # Lógica de trading con IA
├── portfolio.js        # Gestión de portafolio y operaciones
├── index.html          # Dashboard principal
├── access.html         # Página de acceso rápido
├── manage.sh          # Script de gestión
├── package.json       # Dependencias Node.js
└── data/
    └── portfolio.json  # Base de datos de operaciones
```

### APIs Utilizadas
- **CoinGecko API**: Datos de precios de Bitcoin en tiempo real
- **WebSocket**: Actualizaciones push al dashboard
- **Express REST API**: Control del bot y consultas

## 💡 Estrategia de la IA

### Indicadores Técnicos
1. **SMA (Simple Moving Average)**: Tendencia a corto (20) y largo plazo (50)
2. **RSI (Relative Strength Index)**: Sobrecompra (>70) y sobreventa (<30)
3. **MACD**: Momentum y cruces de señal
4. **EMA (Exponential Moving Average)**: Respuesta más rápida a cambios
5. **Bollinger Bands**: Volatilidad y niveles extremos

### Lógica de Decisión
```javascript
// Ejemplo simplificado de la lógica
if (precio > SMA20 && SMA20 > SMA50 && RSI < 70 && confianza > 40%) {
    COMPRAR // Tendencia alcista + no sobrecomprado
}
else if (precio < SMA20 && SMA20 < SMA50 && RSI > 30 && confianza > 40%) {
    VENDER // Tendencia bajista + no sobrevendido  
}
else {
    MANTENER // Condiciones no claras
}
```

### Gestión de Riesgo
- **Posición máxima**: 80% del capital
- **Riesgo por operación**: 2% del capital total
- **Stop Loss**: 5% de pérdida automática
- **Take Profit**: 10% de ganancia automática
- **Cooldown**: 5 minutos entre operaciones
- **Límite de pérdidas**: 3 consecutivas

## 🏆 Métricas de Rendimiento

### KPIs Principales
- **ROI Total**: Rendimiento sobre inversión
- **Win Rate**: Porcentaje de operaciones exitosas
- **Sharpe Ratio**: Retorno ajustado por riesgo
- **Max Drawdown**: Mayor pérdida temporal
- **Número de operaciones**: Actividad del bot
- **Tiempo promedio de posición**: Duración de trades

### Benchmarks
- **Target ROI**: >5% mensual
- **Win Rate objetivo**: >55%
- **Max Drawdown límite**: <15%
- **Sharpe ratio**: >1.0 (excelente >2.0)

## 🔍 Monitoreo y Logs

### Dashboard en Tiempo Real
- Actualizaciones cada 30 segundos
- Estado del mercado en vivo
- Operaciones en tiempo real
- Logs de actividad

### Logs Detallados
```bash
# Ver logs en tiempo real
./manage.sh logs

# Logs específicos
journalctl -u ai-trading-simulator -n 100
```

### Alertas Automáticas
- ✅ Operaciones exitosas
- 🛑 Stop Loss activado
- 🎯 Take Profit alcanzado
- ⚠️ Límite de pérdidas consecutivas
- 📊 Reportes periódicos de estado

## 🚨 Consideraciones Importantes

### ⚠️ Limitaciones
1. **Solo simulación**: No utiliza dinero real
2. **Mercado específico**: Solo Bitcoin spot
3. **Dependiente de APIs**: Requiere conexión a internet
4. **Backtesting limitado**: Basado en datos recientes

### 🔒 Seguridad
- Todos los datos se almacenan localmente
- No se requieren APIs de intercambio reales
- Sin acceso a fondos reales
- Código fuente disponible para auditoría

### 🎯 Casos de Uso
- **Aprendizaje**: Entender algoritmos de trading
- **Investigación**: Probar estrategias sin riesgo
- **Demostración**: Mostrar capacidades de IA
- **Competencia**: Comparar contra otros bots

## 🔮 Futuras Mejoras

### Funcionalidades Planificadas
- [ ] Múltiples criptomonedas (ETH, ADA, etc.)
- [ ] Estrategias personalizables
- [ ] Backtesting histórico completo
- [ ] Machine Learning avanzado
- [ ] Integración con exchanges reales (modo sandbox)
- [ ] Comparación con otros bots
- [ ] Exportación de reportes PDF
- [ ] Notificaciones push/email

### Optimizaciones Técnicas
- [ ] Base de datos PostgreSQL
- [ ] Cache Redis para performance
- [ ] Microservicios arquitectura
- [ ] Deploy con Docker
- [ ] Monitoreo con Grafana
- [ ] Tests automatizados

## 📞 Soporte

Para consultas, problemas o sugerencias:

1. **Logs del sistema**: Revisar `./manage.sh logs`
2. **Dashboard**: Verificar estado en tiempo real
3. **Reinicio**: Probar `./manage.sh restart`
4. **Documentación**: Este archivo README.md

---

**🎲 ¡Que gane el mejor algoritmo!** 🚀

*Simulador creado con fines educativos y de demostración. No constituye asesoramiento financiero.*