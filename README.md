# uso-max

Mod para Claude Code que muestra, al lado del chat, cuánto llevas usado de tu plan Max y en qué se fue.

- **Panel "Uso del plan Max"**: límites de 5 horas y semanales con semáforo de color y hora de reinicio.
- **Desglose del gasto** de la semana por tipo de trabajo, proyecto, modelo y día (teclas 1 a 4, R para actualizar).
- **Barra de estado** bajo el prompt con el resumen de los límites.
- **Comando `/uso`** para abrir el panel.

Los límites vienen del propio Claude Code. El desglose es una estimación calculada sobre los transcripts locales en `~/.claude/projects`, con este peso: entrada ×1, escritura de caché ×2, lectura de caché ×0,1, salida ×5. Nada sale de tu equipo.

Requiere `python3` en el PATH.

## Instalación

En el prompt de una sesión de terminal de Claude Code:

```
/plugin install uso-max --marketplace digitalanke-debug/uso-max
```

Responde `y` para agregar el marketplace y elige el alcance (usuario, con Enter).

Desde una shell:

```
claude plugin install uso-max --marketplace digitalanke-debug/uso-max
```

En la app de escritorio, donde `/plugin` no corre: clic en + junto al prompt, luego Plugins, Add marketplace con `digitalanke-debug/uso-max`, y Add plugin.

## Nombres de conectores (opcional)

Los conectores con ID aleatorio se pueden nombrar creando `~/.claude/uso-max-nombres.json`:

```json
{ "id-del-conector": "Nombre legible" }
```
