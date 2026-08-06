<!-- hy-mt2-i18n:start -->
[English](./README.md) | [中文](./README_zh-CN.md) | [日本語](./README_ja.md) | **Español**
<!-- hy-mt2-i18n:end -->

<p align="center">
  <img src="https://raw.githubusercontent.com/tokyoweb3/LazyGravity/main/docs/assets/LazyGravityBanner.png" alt="Banderín de LazyGravity" width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/lazy-gravity?style=flat-square&color=blue" alt="Versión" />
  <img src="https://img.shields.io/badge/Antigravity-1.19.5-ff6b35?style=flat-square" alt="Antigravity" />
  <img src="https://img.shields.io/badge/node-18.x+-brightgreen?style=flat-square&logo=node.js" alt="Node.js" />
  <img src="https://img.shields.io/badge/discord.js-14.x-5865F2?style=flat-square&logo=discord&logoColor=white" alt="discord.js" />
  <img src="https://img.shields.io/badge/telegram-optional-26A5E4?style=flat-square&logo=telegram&logoColor=white" alt="Telegram" />
  <img src="https://img.shields.io/badge/protocol-CDP%20%2F%20WebSocket-orange?style=flat-square" alt="CDP/WebSocket" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="Licencia" />
</p>

# LazyGravity

**LazyGravity** es un bot local y seguro que le permite operar de forma remota [Antigravity](https://antigravity.dev) desde su PC doméstica, ya sea desde su smartphone o desde cualquier lugar. Es compatible con **Discord** y **Telegram** (opcional).

Envía instrucciones en lenguaje natural como “arregla ese error” o “comienza a diseñar la nueva función” desde tu teléfono. Antigravity las ejecuta localmente en tu PC, utilizando todos sus recursos, y envía los resultados de vuelta a tu plataforma de chat.

https://github.com/user-attachments/assets/08eac63e-5ede-469b-ac6c-1c40ec77b0c0


## Configuración rápida

Requisitos del sistema: **Node >= 18**.

```bash
npm install -g lazy-gravity
lazy-gravity setup
```

El asistente interactivo le guiará paso a paso a través de la creación del bot de Discord, la configuración del token y la configuración del espacio de trabajo. Una vez finalizado:

```bash
lazy-gravity open     # Iniciar Antigravity con CDP habilitado
lazy-gravity start    # Ejecutar el bot (por defecto en Discord, o en ambas plataformas)
```

O ejecútelo directamente sin instalarlo:

```bash
npx lazy-gravity
```

## Funcionalidades

## Características

1. **Totalmente local y seguro**
   - **Sin exposición de servidores o puertos externos**: funciona como un proceso local en su PC, comunicándose directamente con Discord/Telegram.
   - **Control de acceso por lista blanca**: solo los ID de usuario autorizados pueden interactuar con el bot (listas de permisos por plataforma).
   - **Gestión segura de credenciales**: los tokens del bot y las claves API se almacenan localmente (nunca en el código fuente).
   - **Prevención de tránsito por rutas y protección de recursos**: el acceso a directorios en entorno aislado y límites en tareas simultáneas evitan abusos.

2. **Soporte multiplataforma**  
   - **Discord** (por defecto): Conjunto completo de funciones que incluye comandos de barra de tareas, inserciones enriquecidas, reacciones y gestión de canales.  
   - **Telegram** (opcional): Enviar solicitudes, recibir respuestas y utilizar botones de teclado integrados. Requiere [grammy](https://grammy.dev/) (`npm install grammy`).  
   - Ejecutar ambas plataformas simultáneamente desde un mismo proceso, o utilizar cada una de forma independiente.

3. **Gestión de proyectos (Vinculación de canales y directorios)**  
   - **Discord**: Utilice `/project` para vincular un canal a un directorio local de proyecto a través de un menú de selección interactivo.  
   - **Telegram**: Utilice `/project` para vincular una conversación a un directorio del espacio de trabajo.  
   - Los mensajes enviados en un canal/conversación vinculado se reenvían automáticamente a Antigravity con el contexto de proyecto correspondiente.

4. **Respuestas conscientes del contexto**
   - **Discord**: Los resultados se entregan en forma de inserciones enriquecidas. Utilice “Responder” para continuar la conversación manteniendo todo el contexto.
   - **Telegram**: Los resultados se envían como mensajes HTML formateados con botones de teclado integrados.

5. **Monitoreo en tiempo real del progreso**
   - Las tareas de larga duración en Antigravity informan su progreso a través de una serie de mensajes (confirmación de entrega / planificación / análisis / ejecución / implementación / resumen final).

6. **Archivos adjuntos y análisis de contexto**
   - Envíe imágenes (capturas de pantalla, maquetas) o archivos de texto: se reenvían automáticamente a Antigravity como contexto.

## Uso y comandos

### Mensajes en lenguaje natural
Simplemente escribe en cualquier canal vinculado:
> `Refactoriza los componentes de src/components. Haz que el diseño se vea como en la captura de pantalla de ayer` (con imagen adjunta)

### Comandos de barra diagonal

- `📂 /project list` — Navegar por los proyectos mediante un menú desplegable; al seleccionar uno se crea automáticamente una categoría y un canal de sesión  
- `📂 /project create <name>` — Crear un nuevo directorio de proyecto + categoría/canal en Discord  
- `💬 /new` — Iniciar una nueva sesión de chat en Antigravity para el proyecto actual  
- `💬 /chat` — Mostrar la información de la sesión actual y listar todas las sesiones del proyecto  
- `⚙️ /model [name]` — Cambiar el modelo de LLM (por ejemplo, `gpt-4o`, `claude-3-opus`, `gemini-1.5-pro`)  
- `⚙️ /mode` — Cambiar el modo de ejecución mediante un menú desplegable (`code`, `architect`, `ask`, etc.)  
- `📝 /template list` — Mostrar las plantillas registradas con botones de ejecución  
- `📝 /template add <name> <prompt>` — Registrar una nueva plantilla de prompt  
- `📝 /template delete <name>` — Eliminar una plantilla  
- `📅 /schedule list` — Mostrar todas las tareas programadas con sus próximos horarios de ejecución  
- `📅 /schedule add <cron> <prompt>` — Registrar una tarea recurrente para el proyecto asociado al canal actual  
- `📅 /schedule remove <id>` — Eliminar una tarea programada por su ID  
- `📅 /schedule clear` — Eliminar todas las tareas programadas y reiniciar el contador de IDs de tareas  
- `📅 /schedule backup` — Exportar todas las tareas programadas como archivo adjunto en formato JSON  
- `📅 /schedule restore <file>` — Restaurar las tareas programadas desde un archivo adjunto en formato JSON  
- `🔗 /join` — Unirse a una sesión existente en Antigravity (se muestran hasta 20 sesiones recientes)  
- `🔗 /mirror` — Activar o desactivar la replicación de mensajes entre PC y Discord para la sesión actual  
- `🛑 /stop` — Detener forzadamente una tarea en ejecución en Antigravity  
- `🛑 /shutdown` — Apagar el IDE manteniendo las conexiones de proyectos CDP activos y los vínculos de sesiones  
- `📸 /screenshot` — Capturar y enviar la pantalla actual de Antigravity  
- `🔧 /status` — Mostrar el estado de conexión del bot, el modo actual y el proyecto activo  
- `💓 /heartbeat [on|off|status]` — Configurar notificaciones periódicas de actividad del bot  
- `✅ /autoaccept [on|off|status]` — Activar o desactivar la aprobación automática de los diálogos de edición de archivos  
- `📝 /output [embed|plain]` — Cambiar el formato de salida entre texto incrustado y texto plano (el texto plano es más fácil de copiar en dispositivos móviles)  
- `📋 /logs [lines] [level]` — Ver los registros recientes del bot (temporales)  
- `🏓 /ping` — Comprobar la latencia del bot  
- `🧹 /cleanup [days]` — Analizar y eliminar canales de sesiones inactivas (valor predeterminado: 7 días)  
- `❓ /help` — Mostrar la lista de comandos disponibles

### Comandos de Telegram

Los comandos de Telegram utilizan guiones bajos en lugar de sintaxis de subcomandos (Telegram no permite guiones ni espacios en los nombres de los comandos).

- `/project` — Gestionar vinculaciones de espacio de trabajo (listar, seleccionar, crear)  
- `/project_create <name>` — Crear un nuevo directorio de espacio de trabajo  
- `/new` — Iniciar una nueva sesión de chat  
- `/template` — Listar plantillas de prompts con botones de ejecución  
- `/template_add <name> <prompt>` — Agregar una nueva plantilla de prompt  
- `/template_delete <name>` — Eliminar una plantilla de prompt  
- `/mode` — Cambiar el modo de ejecución  
- `/model` — Cambiar el modelo de LLM  
- `/screenshot` — Tomar una captura de pantalla de Antigravity  
- `/autoaccept [on|off]` — Activar o desactivar el modo de aceptación automática  
- `/logs [count]` — Mostrar los últimos registros de logs  
- `/stop` — Interrumpir la generación actual de LLM  
- `/status` — Mostrar el estado y conexiones del bot  
- `/ping` — Verificar la latencia del bot  
- `/help` — Mostrar los comandos disponibles

### Comandos de la CLI

```bash
lazy-gravity              # Automático: ejecuta la configuración si no está definida, de lo contrario inicia el bot
lazy-gravity setup        # Asistente interactivo de configuración
lazy-gravity open         # Abrir Antigravity con CDP (selecciona automáticamente el puerto disponible)
lazy-gravity start        # Iniciar el bot de Discord
lazy-gravity doctor       # Verificar el entorno y las dependencias
lazy-gravity --verbose    # Mostrar registros en nivel de depuración (detalles de CDP, eventos del detector, etc.)
lazy-gravity --quiet      # Mostrar solo errores
lazy-gravity --version    # Mostrar la versión
lazy-gravity --help       # Mostrar ayuda
```

---

## Configuración (detallada)

### Opción A: npm (recomendado)

```bash
npm install -g lazy-gravity
lazy-gravity setup
```

El asistente te guiará a través de 4 pasos:

1. **Token del bot de Discord** — crea un bot en el [Portal de Desarrolladores de Discord](https://discord.com/developers/applications).
   - Activa las Intenciones de Gateway con Privilegios: **PRESENCE, SERVER MEMBERS, MESSAGE CONTENT**.
   - Genera una URL de invitación OAuth2 con los siguientes permisos para el bot: **Manage Channels** (necesario para `/project`), **Send Messages**, **Embed Links**, **Attach Files**, **Read Message History** y **Add Reactions**.
   - Invita al bot a tu servidor y luego copia su token. El ID del cliente se obtiene automáticamente a partir del token.
2. **ID del grupo (servidor)** — necesario para el registro instantáneo de comandos slash (opcional; presiona Enter para omitirlo).
3. **IDs de usuarios autorizados** — usuarios de Discord con permiso para interactuar con el bot.
4. **Directorio del espacio de trabajo** — directorio padre donde se encuentran tus proyectos de programación.

La configuración se guarda en `~/.lazy-gravity/config.json`.

### Opción B: Desde el código fuente

```bash
git clone https://github.com/tokyoweb3/LazyGravity.git
cd LazyGravity
npm install
```

Configure su archivo `.env`:

```bash
cp.env.example.env
```

Edite el archivo `.env` e introduzca los valores requeridos:

```env
DISCORD_BOT_TOKEN=tu_token_del_bot_aquí
GUILD_ID=tu_id_de_guilde_aquí
ALLOWED_USER_IDS=123456789,987654321
WORKSPACE_BASE_DIR=~/Code
# ANTIGRAVITY_PATH=/ruta/a/antigravity.AppImage  # Opcional: Para usuarios de Linux o instalaciones personalizadas
```

Luego inicie el bot:

```bash
npm run start
```

#### Agregar soporte para Telegram (Opcional)

1. Instale grammy: `npm install grammy`  
2. Cree un bot a través de [@BotFather](https://t.me/BotFather) en Telegram y copie el token.  
3. Agregue lo siguiente a su `.env`:

```env
PLATFORMS=discord,telegram        # o simplemente "telegram" para despliegues exclusivos en Telegram
TELEGRAM_BOT_TOKEN=tu_token_del_bot_de_telegram_aquí
TELEGRAM_ALLOWED_USER_IDS=123456789    # Tu ID numérico de usuario en Telegram
```

En las implementaciones exclusivas para Telegram, no se requieren las credenciales de Discord (`DISCORD_BOT_TOKEN`, `CLIENT_ID`, `ALLOWED_USER_IDS`).

Como alternativa, también puede compilar y utilizar la CLI:

```bash
npm run build
node dist/bin/cli.js setup    # o: node dist/bin/cli.js start
```

### Ejecutar Antigravity con CDP

LazyGravity se conecta a Antigravity a través del Protocolo de Herramientas de Desarrollo de Chrome (CDP). Es necesario ejecutar Antigravity con un puerto de depuración remota habilitado.

```bash
# Método más sencillo (selecciona automáticamente un puerto disponible):
lazy-gravity open
```

Si clonaste desde el código fuente, también puedes utilizar los scripts de lanzamiento incluidos (ellos detectan automáticamente un puerto disponible entre 9222 y 9666):

#### macOS
Haga doble clic en **`start_antigravity_mac.command`** en la raíz del repositorio.

- **Primera ejecución**: si aparece un error de permisos, ejecute `chmod +x start_antigravity_mac.command` una vez en la terminal.

#### Windows
Haga doble clic en **`start_antigravity_win.bat`** en la raíz del repositorio.

- **Si no se inicia**: verifique que el IDE Antigravity esté instalado en `"%LOCALAPPDATA%\Programs\Antigravity IDE\Antigravity IDE.exe"`. Si está instalado en otro lugar, haga clic con el botón derecho en el archivo y actualice la ruta del ejecutable.
- **¿Actualizando a Antigravity 2.0?** El ejecutable para Windows fue renombrado a `Antigravity IDE.exe`. Si sigue utilizando la versión antigua `Antigravity.exe`, la función de inicio automático no podrá encontrarla. Por favor, actualice Antigravity o establezca el valor de sobrescritura `ANTIGRAVITY_PATH` en su archivo `.env`.

#### Linux
En Linux (especialmente al usar AppImages), es posible que la orden `antigravity` no esté disponible en todo el sistema.
Puede especificar la ruta exacta de su ejecutable estableciendo la variable de entorno `ANTIGRAVITY_PATH` en su archivo `.env`:
```env
ANTIGRAVITY_PATH=/opt/applications/antigravity.AppImage
```

> **Consejo**: Los puertos CDP se escanean automáticamente entre los valores posibles (9222, 9223, 9333, 9444, 9555, 9666).  
> Ejecute primero Antigravity y luego inicie el bot; se conectará de forma automática.

---

## Solución de problemas

Si el bot no responde o has actualizado el código, reinícialo:

1. **Detener el bot**: presione `Ctrl + C` en la terminal, o:
   ```bash
   pkill -f "lazy-gravity"
   ```
2. **Reiniciar**
   ```bash
   lazy-gravity start
   # o, desde el código fuente: npm run start
   ```

Si se vuelve a iniciar Antigravity, el bot intentará automáticamente reconectar con CDP. El envío de un mensaje provoca una reconexión automática del proyecto.

Ejecuta `lazy-gravity doctor` para diagnosticar problemas de configuración y conectividad.

1. El bot escanea los puertos de depuración (por defecto: 9222) y detecta automáticamente el destino Antigravity.

## Cómo funciona la conexión a CDP

<p align="center">
  <img src="https://raw.githubusercontent.com/tokyoweb3/LazyGravity/main/docs/images/architecture.svg" alt="Arquitectura de LazyGravity" width="100%" />
</p>

1. El bot escanea los puertos de depuración (por defecto: 9222) y detecta automáticamente el destino Antigravity.  
2. Se conecta mediante WebSocket a CDP (utilizando `Runtime.evaluate` para operaciones en el DOM).  
3. Inyecta mensajes en el campo de entrada del chat, monitorea las respuestas de Antigravity y toma capturas de pantalla.

**Al perderse la conexión**: se intentan nuevas conexiones automáticamente hasta 3 veces (`maxReconnectAttempts`). Si todas las tentativas fallan, se envía una notificación de error a la plataforma de chat activa.

## Arquitectura de la plataforma

LazyGravity utiliza una **capa de abstracción de plataforma** para que la lógica principal del bot sea independiente de ella:

```
src/platform/
├── types.ts              # Interfazes comunes (PlatformMessage, PlatformChannel, etc.)
├── adapter.ts            # Interfaz PlatformAdapter
├── richContentBuilder.ts # Constructor inmutable para contenido enriquecido (embeds/HTML)
├── discord/              # Adaptador para Discord (envoltorios de discord.js)
│   ├── discordAdapter.ts
│   └── wrappers.ts
└── telegram/             # Adaptador para Telegram (envoltorios compatibles con grammy)
    ├── telegramAdapter.ts
    ├── telegramFormatter.ts  # Conversión de Markdown a HTML para Telegram
    └── wrappers.ts
```

Ambos adaptadores implementan la misma interfaz `PlatformAdapter` y emiten eventos a través de `PlatformAdapterEvents`. El `EventRouter` distribuye los eventos a los manejadores independientes de la plataforma, mientras que el `WorkspaceQueue` serializa las solicitudes simultáneas por espacio de trabajo en todas las plataformas.

## Licencia

[MIT](LICENSE)
