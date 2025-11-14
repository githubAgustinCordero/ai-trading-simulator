# Monitor ligero para `ai-trading-simulator`

Archivos:
- `monitor_alerts.sh`: script bash que ejecuta comprobaciones sencillas.

Qué revisa:
- `GET /api/status` — verifica que la API responda y que `bot.isActive` sea `true`.
- Revisa la base de datos `trades` para posiciones abiertas (última acción `open` para un `position_id`).
- Escanea `journalctl` del servicio `ai-trading-simulator` para detectar mensajes repetidos de bloqueo ("Omitiendo apertura duplicada").

Alertas:
- Registra alertas en `monitor/alerts.log`.
- Si exportas la variable de entorno `ALERT_WEBHOOK` con una URL, el script hará POST JSON con `{timestamp,message}`.

Ejecución manual:
```bash
cd /var/www/agubot.ddns.net/ai-trading-simulator
./monitor/monitor_alerts.sh
```

Ejecutarlo periódicamente (ejemplo cron cada 1 minuto):
```cron
* * * * * cd /var/www/agubot.ddns.net/ai-trading-simulator && ./monitor/monitor_alerts.sh >/dev/null 2>&1
```

Ejemplo systemd unit (opcional): copiar `monitor/ai-trading-monitor.service.sample` a `/etc/systemd/system/ai-trading-monitor.service`, editar y `systemctl enable --now ai-trading-monitor`.
