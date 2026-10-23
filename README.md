# Clash War Monitor

Monitor en directo y simulación Monte Carlo de la guerra de clanes de **Clash Royale**.
Escribe el tag de un clan y verás la carrera de hoy contra sus 4 rivales. Además podrás
simular miles de veces la semana para saber qué opciones tienes de ganar.

**Demo sin instalar nada:** abre `public/index.html` en el navegador y pulsa «Ver demo», o
genera un único archivo con `npm run build:demo` (sale en `dist/demo.html`). Ese archivo no
necesita servidor ni API key: tiene tres momentos de la semana y un botón para generar
carreras nuevas, y sirve para colgarlo en GitHub Pages o abrirlo en el móvil.

## Qué hace

Busca cualquier clan por su nombre o por su tag. La web tiene cuatro pestañas.

**01 · Hoy en directo**
- **Resumen en una frase de cómo va tu clan.** Incluye el puesto, las medallas, los mazos que faltan (con su porcentaje), el final esperado y las opciones de ganar el día.
- **Carrera de los 5 clanes.** Cada uno aparece con sus medallas, su final esperado, hasta dónde puede llegar, el % de mazos jugados y la **probabilidad de ganar el día**.
- **Puntos de avance de hoy:** cuánto avanzaría cada barco según el puesto en que quede, más lo que suman sus defensas, con la probabilidad de cada puesto.
- **Detalle de cualquier clan.** Muestra el final esperado, qué pasaría si juegan y ganan todo o si juegan y pierden todo (con el % de subida sobre lo actual) y los topes diarios de 200 mazos y 50 jugadores.
- **Jugadores pendientes ordenados por riesgo de dejarse mazos.** Tiene un botón para copiar la lista al chat del clan.

**02 · Jugadores**
- Fiabilidad de cada miembro en las últimas 10 semanas: % de mazos jugados, % de días y de semanas con fallos, y riesgo de dejarse mazos hoy.
- Se puede consultar para tu clan y para los rivales. La tabla se ordena por cualquier columna.

**03 · Expulsiones**
- Una nota para cada miembro según los mazos que juega cada día y las medallas que consigue en las últimas semanas (de 1 a 10, eliges tú).
- Veredicto por jugador (expulsar, vigilar, bien o sin evaluar), barra con el reparto de sus días y botón para copiar la lista.
- Coeficientes, peso de las medallas y nota mínima ajustables; se recuerdan en el navegador.

**04 · Simulación de la semana (Monte Carlo)**
- Probabilidad de quedar 1º, 2º… 5º y el puesto esperado de cada clan.
- **Medallas esperadas** de cada clan, con su escenario pesimista y optimista.
- Historial de 10 semanas por clan: media diaria, % de semanas ganadas, % de mazos jugados y el puesto de cada semana.

## Cómo se calcula

**Fiabilidad de un jugador.** Cada semana de guerra tiene 16 mazos por jugador: 4 al día durante 4 días. Si el clan cruzó la meta antes, el máximo baja en consecuencia. Para cada semana en que el jugador estaba en el clan se cuentan los **días en que se dejó algún mazo**. Lo habitual es dejarse días enteros, así que 5 mazos sin jugar cuentan como 2 días. El «riesgo hoy» es ese porcentaje **suavizado con la media del clan**, que pesa como 2 semanas de datos, para que alguien con 1 o 2 semanas no salga con 0 % o 100 %. Los jugadores nuevos usan la media del clan.

**Final esperado de hoy (Monte Carlo del día).** Se simula el resto del día 4.000 veces:
- Cada jugador pendiente juega todos sus mazos o se deja alguno, según su riesgo.
- Cada mazo da la media de medallas por mazo del clan hoy. Si aún han jugado poco, se usa la media histórica.
- Se añaden dos variaciones comunes a todo el clan: días en que entra más o menos gente y días en que se gana más o menos.

De ahí salen el final esperado, su rango y la probabilidad de acabar el día 1º.

**Defensas del barco.** Cada clan tiene un barco con hasta 15 defensas (según su liga). Cada
defensa que sigue en pie al cerrar un día de batalla suma puntos de avance: 59, 53, 47, 43, 41, 37,
31, 29, 23, 19, 17, 13, 11, 7 y 5 (con las 15 son 435 al día). Cuando cae una, se pierde la de
más valor: con 14 en pie son 435 − 59 = 376 (comprobado con RoyaleAPI). Las destruidas no vuelven
hasta la semana siguiente. La API da las defensas en pie
al cierre de cada día jugado, así que la web usa las de ayer y supone que hoy no cae ninguna más.
Antes del primer día de batalla se estiman con la semana anterior, porque se reponen cada semana.

**Puntos de avance de hoy.** Para cada clan y cada puesto posible: puntos del puesto por medallas
(3.000 / 1.800 / 1.000 / 600 / 400) + bonus de sus defensas, junto a la probabilidad de quedar en
ese puesto. El «esperado hoy» es la media ponderada por esas probabilidades.

**Nota de expulsión.** Cada día de guerra vale según los mazos que jugó el jugador ese día:

| Mazos en el día | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| Coeficiente | −1 | −3 | −2 | +0,5 | +1 |

```
Nota = media de los coeficientes de sus días + peso × (medallas por día ÷ 1.000)
```

La parte de mazos va de −3 a +1, y las medallas se dividen entre 1.000, que es el máximo de un día
(4 duelos ganados). Por debajo de la nota mínima (0 por defecto): expulsar; hasta 0,75 por encima:
vigilar. Quien tenga menos de 4 días de guerra en el periodo sale como «sin evaluar». Los días
posteriores a cruzar la meta no cuentan.

**Registro diario de mazos.** La API solo da los mazos de cada jugador por semana (0-16), no por
día, y con estos coeficientes el reparto importa mucho: 8 mazos como 4+4+0+0 dan 0, pero como
2+2+2+2 dan −8. Por eso el servidor puede guardar una foto de la carrera cada 10 minutos
(`TRACK_CLANS`) y reconstruir los mazos exactos de cada día. Las semanas sin registro se estiman
repartiendo el total en días completos (13 mazos = 4+4+4+1) y la web las marca como estimadas.
Los datos se guardan en `data/` (unos pocos KB por semana).

**Simulación de la semana.** En cada simulación:
1. Para cada clan se elige al azar una de sus últimas semanas, que es su forma. Sus medallas se reparten entre los días que jugó, con la variabilidad diaria elegida (3,5 % por defecto, que es lo que varía de verdad un clan de un día a otro).
2. Si la semana ya ha empezado, esa forma se mezcla con lo que lleva el clan esta semana: con 1 día jugado pesa un tercio, con 2 la mitad y con 3 tres quintos. Así, un clan que esta semana juega mucho peor que de costumbre no sale favorito solo por su historial.
3. Hoy se simula con el modelo del día de arriba, usando las medallas por mazo de toda la semana (hoy incluido) y no solo las de hoy: a media tarde, la media de hoy sale de pocos mazos y engaña. Los días ya jugados usan su resultado real.
4. Se aplican las reglas:
   - **Carrera normal:** cada día el orden por medallas da 3.000 / 1.800 / 1.000 / 600 / 400 puntos de avance, más el bonus de las defensas en pie, y la meta está en 10.000. Quien cruza la meta deja de sumar; los que la cruzan el mismo día empatan en el 1º, y la web separa «gana solo» de «empata el 1º».
   - **Coliseo:** gana quien suma más medallas.

Todo el modelo está en [`public/js/sim.js`](public/js/sim.js). Las reglas del juego están en `RULES` y los parámetros del modelo en `MODEL`, por si quieres ajustarlos.

**Limitaciones.**
- El historial refleja cómo jugó cada clan, no cómo es hoy: un rival que ha cambiado mucho de miembros puede engañar.
- En los días futuros se supone que no caen más defensas, lo que es algo optimista para todos los clanes.
- El modelo del día no sabe qué hora es: un jugador que no ha entrado a última hora tiene en realidad más riesgo del que se muestra.

## Foto real sin servidor

`scripts/build-demo.js` también monta una web autocontenida con datos reales en lugar de los
inventados. Basta un archivo que defina `window.CWDemo` con `payload()` e `history()` en el mismo
formato que la API del servidor:

```bash
SNAPSHOT=datos.js OUT=dist/foto.html \
CONFIG_JSON='{"snapshot":{"label":"2 oct., día 2","time":"del 2/10","note":"Foto de RoyaleAPI…"}}' \
node scripts/build-demo.js
```

Los clanes de los que solo se conocen los totales pueden ir sin `participants` y con
`aggregate: { decksUsedToday }`: la web los simula como un bloque de mazos pendientes y avisa.

## Estructura

```
├── server.js                 servidor Node sin dependencias: guarda la API key y hace de puente
├── lib/recorder.js           registro diario de mazos (fotos de la carrera cada pocos minutos)
├── public/
│   ├── index.html            estructura de la página
│   ├── css/styles.css        todo el aspecto visual (colores en :root)
│   └── js/
│       ├── config.js         dónde está el servidor (apiBase)
│       ├── calc.js           cálculos de la carrera en directo
│       ├── sim.js            motor Monte Carlo
│       ├── demo.js           datos inventados para la demo
│       └── app.js            interfaz
├── scripts/build-demo.js     genera dist/demo.html (npm run build:demo)
├── test/                     26 tests del modelo y del registro (npm test)
├── deploy/                   servicio systemd
├── Dockerfile
└── .env.example              configuración
```

**¿Quieres cambiar el aspecto?** Todo el estilo está en `public/css/styles.css` y se controla con
las variables de `:root`:
- `--green`, `--amber` y `--red` tienen un significado fijo: tu clan o lo conseguido, lo esperado, y el riesgo.
- `--clan-1` a `--clan-4` son los colores de los clanes rivales (barco, escudo y barras).
- `--water-1` y `--water-2` pintan el río.

Tipografías: Lilita One para títulos y cifras grandes, y JetBrains Mono para datos y textos. Los
iconos, los barcos y los escudos son dibujos propios en SVG (en `index.html` y `app.js`); no se
usa ningún recurso gráfico del juego. La lógica no depende del diseño: `calc.js` y `sim.js` no
tocan el HTML.

## Por qué hace falta un servidor

La API oficial de Clash Royale exige una clave ligada a una IP. RoyaleAPI ofrece un **proxy**
con IP fija para usarla desde cualquier sitio. Si la clave fuera en el navegador, cualquiera
podría copiarla, así que `server.js` la guarda y la web solo habla con él.

Como la web es pública, el servidor limita las consultas por IP y guarda en caché las
respuestas: 30 s los datos en directo y 10 min el historial.

---

## Puesta en marcha

### 1 · Crear la clave de la API

1. Entra en <https://developer.clashroyale.com> y crea una cuenta.
2. *My Account* → *Create New Key*.
3. En **Allowed IP addresses** pon `45.79.218.79`, la IP del proxy de RoyaleAPI.
4. Copia el token.

### 2 · Probarlo en tu ordenador

Necesitas Node 18 o superior (`node -v`). No hay que instalar dependencias.

```bash
git clone https://github.com/ivanius2005/clash-war-monitor.git
cd clash-war-monitor
cp .env.example .env        # en Windows: copy .env.example .env
# edita .env y pega el token en CR_API_KEY
npm start
```

Abre <http://localhost:3055>.
Para comprobar que el modelo funciona, ejecuta `npm test`.

### 3 · Dejarlo funcionando en un servidor Linux (p. ej. una Raspberry Pi)

```bash
sudo apt install -y nodejs git
sudo git clone https://github.com/ivanius2005/clash-war-monitor.git /opt/clash-war-monitor
sudo chown -R $USER: /opt/clash-war-monitor
cd /opt/clash-war-monitor && cp .env.example .env && nano .env

nano deploy/clash-war-monitor.service      # cambia User= por tu usuario (whoami)
sudo cp deploy/clash-war-monitor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now clash-war-monitor
curl http://127.0.0.1:3055/api/health     # → {"ok":true}
```

Para actualizar más adelante:
`cd /opt/clash-war-monitor && git pull && sudo systemctl restart clash-war-monitor`.

### 3b · O con Docker

```bash
docker build -t clash-war-monitor .
docker run -d --name cwm --restart unless-stopped --env-file .env -e TRUST_PROXY=1 -v cwm-data:/app/data -p 127.0.0.1:3055:3055 clash-war-monitor
```

### 4 · Publicarlo con acceso restringido

La web va en su propio subdominio y solo entra quien tú permitas. Los invitados ven
la página de la guerra, **no tu dashboard**: son dos aplicaciones de Access distintas.

**4.1 · Subdominio.** En Cloudflare Zero Trust → *Networks* → *Tunnels* → tu túnel →
*Public Hostname* → *Add*: subdominio `guerra`, dominio `ivanius2005.es`, servicio
`HTTP` · `localhost:3055`.

**4.2 · Quién puede entrar.** Zero Trust → *Access* → *Applications* → *Add an application*
→ *Self-hosted*:

- Dominio: `crwar.ivanius2005.es`
- Política «Clan»: acción *Allow*, *Include* → *Emails* → tu correo y los de las personas
  a las que quieras dar acceso.
- Método de entrada: *One-time PIN* (el mismo que el dashboard: les llega un código al correo).

Para dar o quitar acceso a alguien, edita esa política; no hay que tocar el servidor.

**4.3 · Cerrar la puerta de atrás.** En el `.env`, `REQUIRE_ACCESS=1`. Así el servidor
rechaza cualquier petición que no venga de Access (la página responde «acceso restringido»).

```bash
sudo systemctl restart clash-war-monitor
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3055/api/summary   # → 401: bien, sin Access no entra
```

### Página para los miembros del clan

`https://crwar.ivanius2005.es/clan` muestra la misma tarjeta que el dashboard (la carrera,
la pestaña del clan, miembro del mes, jugadores y el botón de PDF), a pantalla completa y
pensada para el móvil. Es el enlace que se comparte con el clan. Usa la misma aplicación de
Access que el resto de `crwar.ivanius2005.es`.

### 5 · Tarjeta en el dashboard

`deploy/dashboard-card.html` es una tarjeta autónoma (HTML, CSS y JS en un solo bloque) con:

- **Datos clave:** puesto, opciones de terminar 1º (solos o empatados), mazos de hoy y medallas
  de hoy con su previsión.
- **La carrera:** avance, medallas de hoy, mazos jugados y pendientes de los 5 clanes, y la
  probabilidad de terminar la semana en cada puesto (1º a 5º) como mapa de calor.
- **Miembro del mes:** el que más medallas lleva en la temporada en curso y el ganador de la
  temporada terminada, con su podio.
- **Pestaña del clan:** quién queda por atacar hoy, ordenado por el riesgo de que se deje mazos
  (según los días que ha fallado en su historial), cuántos se espera que se queden sin jugar, la
  probabilidad de jugar los 200 y la media por ataque de cada jugador, esta semana y en su historial.
- **Botón Exportar PDF:** el informe del momento (apartado 6).
- **Desplegable de jugadores:** de cada uno, mazos y medallas de hoy, de la semana y de cada día,
  medallas por día jugado y por mazo, sus 3 semanas anteriores y su media. Se ordena tocando
  cualquier columna y se filtra por «con mazos pendientes hoy», «ya no están» o por nombre.
  El detalle por día necesita el registro diario (`TRACK_CLANS`); funciona desde el día en que
  se activa.
 Pide los datos
a `/guerra-api/summary` **en el mismo dominio del dashboard**, así que no hay CORS ni un
segundo inicio de sesión: la protege el Access del dashboard.

1. En el túnel, añade otra regla para el dashboard **por encima** de la que ya tienes:
   subdominio `dashboard`, ruta `^/guerra-api/`, servicio `HTTP` · `localhost:3055`.
   Si usas `config.yml` en vez del panel web:

   ```yaml
   ingress:
     - hostname: dashboard.ivanius2005.es
       path: ^/guerra-api/
       service: http://localhost:3055
     - hostname: dashboard.ivanius2005.es
       service: http://localhost:PUERTO_DEL_DASHBOARD
     - hostname: crwar.ivanius2005.es
       service: http://localhost:3055
     - service: http_status:404
   ```

2. Pega el contenido de `deploy/dashboard-card.html` donde quieras dentro del HTML del dashboard.
3. Comprueba: `https://dashboard.ivanius2005.es/guerra-api/summary` debe devolver un JSON.

### 6 · Exportar a PDF

El botón **Exportar PDF** (en la web y en la tarjeta del dashboard) descarga el informe del
momento, con el mismo diseño que los informes que se mandan al clan por WhatsApp:

1. **La semana:** puesto, probabilidad de ganar la semana (solos o empatados), mazos y medallas
   de hoy, la carrera dibujada y la probabilidad de cada puesto (1º a 5º) de los 5 clanes.
2. **Los clanes ahora mismo:** avance, medallas y mazos de hoy y de la semana, medallas por mazo,
   ataques al barco y defensas de cada clan, con gráficas, y el **miembro del mes**: el de la
   temporada en curso (puede cambiar) y el de la temporada terminada (final).
3. **Nuestros jugadores:** quién tiene mazos pendientes y la tabla de todos con hoy, la semana,
   medallas por día y por mazo, la semana anterior y su media.

Lo genera la Raspberry con Python, así que hace falta una vez:

```bash
sudo apt install -y python3-reportlab fonts-dejavu fonts-freefont-ttf fonts-ipafont-gothic fonts-wqy-zenhei
```

Las fuentes del diseño van en `fonts/`; las del sistema solo se usan para los símbolos raros de
algunos nombres (☢, ⭐, シ…). En el móvil el PDF se abre en el navegador y desde ahí se comparte a
WhatsApp. El informe de las 08:00 también guarda su PDF y lo adjunta al aviso de Discord.

### PDF del desempeño de los jugadores

En el monitor completo (`/monitor`), pestañas «Jugadores» y «Expulsiones»:

- **Informe de jugadores (PDF):** candidatos a expulsión con su nota y motivo, quién mejora y quién
  empeora (media de sus últimas 4 semanas frente a las 6 anteriores) y el ranking de las 10 semanas
  con una minigráfica por jugador.
- **Ficha PDF** de cada jugador (en la lista de expulsiones): sus 10 semanas frente a la media del clan,
  semana a semana y su situación de expulsión.

Usan los mismos ajustes de expulsión que tengas en la web (semanas, peso de medallas, media objetivo por semana, umbral y
coeficientes). Rutas: `GET /api/players.pdf` y `GET /api/player.pdf?tag=%23TAG`.

### 7 · Informe de las 08:00

Durante los días de batalla (mañanas de viernes a lunes) el servidor genera a las 08:00 un
informe con la clasificación, las probabilidades, los cambios desde el informe anterior y
quién tiene mazos pendientes, cuando aún quedan unas horas para que cierre el día.

- Se guarda en `data/reports/AAAA-MM-DD.json` (y su PDF al lado) y aparece en la web (FIG. 00 · Novedades).
- Si pones `DISCORD_WEBHOOK_URL`, también llega como mensaje a ese canal, con el PDF adjunto.
- Si la Raspberry estaba apagada a las 08:00, lo genera al arrancar (hasta las 11:00).
- En días de entrenamiento no se genera nada.

Para probarlo sin esperar:

```bash
cd /opt/clash-war-monitor
node server.js --report-now --no-discord   # genera y guarda el informe, sin avisar
node server.js --report-now                # igual, y lo manda a Discord
journalctl -u clash-war-monitor -n 20      # el servidor dice cuándo toca el próximo
```

### Novedades al entrar en la web

Arriba de la pestaña «Hoy» aparecen dos tarjetas:

- **Informe de las 08:00:** cómo estábamos a esa hora frente a ahora (puesto, opciones de
  terminar 1º, avance y mazos pendientes) y lo que cambió desde el informe anterior.
- **Desde tu última visita:** lo que ha cambiado desde la última vez que esa persona abrió
  la web en ese dispositivo. Verde = buena noticia para el clan, rojo = mala (que un rival
  baje sus opciones sale en verde). Una recarga en menos de 15 minutos cuenta como la misma visita.

## Configuración (.env)

| Variable | Por defecto | Para qué sirve |
|----------|-------------|----------------|
| `CR_API_KEY` | — | Tu clave de la API (obligatoria) |
| `PORT` / `HOST` | `3055` / `127.0.0.1` | Dónde escucha el servidor |
| `CLAN_TAG` | vacío | Fija un único clan. Necesario para el informe y la tarjeta |
| `TRACK_CLANS` | `CLAN_TAG` | Clanes con registro diario de mazos (separados por comas) |
| `TRACK_MINUTES` | `10` | Cada cuánto se guarda una foto de la carrera |
| `DATA_DIR` | `data` | Carpeta del registro diario y de los informes |
| `HISTORY_WEEKS` | `10` | Semanas de historial para simular (máx. 20) |
| `CACHE_SECONDS` | `30` | Caché de los datos en directo |
| `HISTORY_CACHE_SECONDS` | `600` | Caché del historial |
| `RATE_LIMIT_PER_MIN` | `60` | Consultas por minuto y por IP (0 = sin límite) |
| `TRUST_PROXY` | auto | Usar la IP real que envía Cloudflare |
| `CORS_ORIGINS` | vacío | Dominios que pueden usar la API desde otra web |
| `REQUIRE_ACCESS` | `0` | `1` = solo se atiende a quien llega por Cloudflare Access |
| `API_ALIAS` | `/guerra-api` | Ruta alternativa a `/api` (tarjeta del dashboard) |
| `PUBLIC_URL` | vacío | Dirección de la web, para el enlace del aviso de Discord |
| `REPORT_ENABLED` | `1` | `0` = sin informe programado (los guardados se siguen viendo) |
| `REPORT_HOUR` / `REPORT_MINUTE` | `8` / `0` | Hora del informe |
| `REPORT_DAYS` | `fri,sat,sun,mon` | Días del informe (también en español: `vie,sáb,dom,lun`) |
| `REPORT_TZ` | `Europe/Madrid` | Zona horaria (tiene en cuenta el cambio de hora) |
| `DISCORD_WEBHOOK_URL` | vacío | Webhook al que se manda el informe |
| `PDF_ENABLED` | `1` | `0` = sin exportación a PDF |
| `PDF_PYTHON` | `python3` | Python con reportlab que genera el PDF |
| `SUMMARY_RUNS` | `10000` | Simulaciones del resumen en directo (el informe usa 20.000) |
| `SUMMARY_CACHE_SECONDS` | `60` | Cada cuánto se recalcula el resumen |

## API del servidor

Todas las rutas también responden bajo `API_ALIAS` (p. ej. `/guerra-api/summary`).

| Ruta | Devuelve |
|------|----------|
| `GET /api/summary` | Resumen en directo: clasificación, probabilidad de cada puesto, mazos pendientes y jugadores |
| `GET /api/report.pdf` | Informe del momento en PDF |
| `GET /api/report/latest` | Último informe diario (404 si aún no hay) |
| `GET /api/report/latest.pdf` | PDF del último informe diario |
| `GET /api/reports` | Lista de los últimos 30 informes |
| `GET /api/me` | Correo con el que entró la persona (Cloudflare Access) |
| `GET /api/search?q=nombre` | Clanes cuyo nombre contiene el texto (mínimo 3 letras) |
| `GET /api/war/:tag` | Carrera actual y miembros de los 5 clanes |
| `GET /api/history/:tag` | Últimas semanas de los 5 clanes, ya reducidas |
| `GET /api/config` | Clan fijado, semanas de historial y horario del informe |
| `GET /api/health` | `{ ok: true }` (no pide Access: sirve para monitorizar) |

## Recursos

En una Raspberry Pi 4 ocupa unos 50 MB de RAM en reposo y se estabiliza en torno a 100 MB con
uso. El servicio lo limita a 200 MB. Todas las simulaciones se ejecutan en el navegador de cada
usuario, no en el servidor: 10.000 simulaciones de la semana tardan unos 0,2 s.

## Licencia

MIT. Úsalo, modifícalo y publica tu versión.

*Proyecto no oficial, sin relación con Supercell ni con RoyaleAPI. Contenido del juego © Supercell.*


## Web pública (cualquier clan)

Con `ANY_CLAN=1` la portada tiene un buscador «¿Otro clan?» y cada clan tiene su página en `/c/TAG`
(por ejemplo `/c/LVR980LQ`). El monitor completo acepta `?tag=TAG`.

Protecciones para no agotar la API de Clash Royale ni la Raspberry:

- **Caché por clan**: carrera 30 s, historial 10 min, resumen 60 s. 100 personas del mismo clan cuestan casi lo mismo que una.
- **Tope de clanes nuevos** (`NEW_CLANS_PER_MIN`, 10 por defecto): si se supera, se responde «prueba en un minuto». El clan de casa no cuenta.
- **Tags inexistentes** recordados 10 minutos: no se vuelven a pedir a la API.
- **Límite por visitante**: `RATE_LIMIT_PER_MIN` consultas por minuto y por IP.
- **Simulaciones**: las 500.000 del simulador las hace el navegador; el resumen de otros clanes usa `SUMMARY_RUNS_OTHERS` (5.000).
- **PDF**: solo del clan de casa; para los demás aparece «🔒 bloqueado».
- **Uso**: `curl http://127.0.0.1:3055/api/stats` (solo desde la propia máquina).

Contenido de fans, no afiliado ni respaldado por Supercell.

## Ficha de jugador

`/p/TAG` (o el botón «Jugador» del buscador) muestra de cualquier jugador: nivel, trofeos y Path of Legend,
su mazo actual con evoluciones y héroes, las 15 últimas batallas con su porcentaje de victorias,
su actividad en la guerra de su clan actual (esta semana y las 10 últimas) y el reparto de niveles de sus cartas.
API: `GET /api/player/TAG`. Las consultas de jugadores nuevos cuentan para el mismo tope por minuto que los clanes.
