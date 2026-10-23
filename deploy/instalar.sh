#!/usr/bin/env bash
# Instalador del monitor de guerra en la Raspberry (Raspberry Pi OS / Debian).
#
#   CR_API_KEY='…' DISCORD_WEBHOOK_URL='…' bash /opt/clash-war-monitor/deploy/instalar.sh
#
# Se puede repetir sin problema: instala lo que falte, actualiza el .env y reinicia el servicio.
# Si aún no hay clave de la API de Clash Royale, lo deja todo listo pero sin arrancar.
set -euo pipefail
DEST="$(cd "$(dirname "$0")/.." && pwd)"
ME="$(id -un)"
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✖\033[0m %s\n' "$*"; exit 1; }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

step "1/6 Paquetes del sistema"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs curl python3-reportlab \
  fonts-dejavu fonts-freefont-ttf fonts-ipafont-gothic fonts-wqy-zenhei >/dev/null
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node $(node -v) es demasiado antiguo: hace falta la 18 o superior"
ok "Node $(node -v) y $(python3 -c 'import reportlab; print("reportlab", reportlab.Version)')"

step "2/6 Proyecto en $DEST"
sudo chown -R "$ME": "$DEST"
cd "$DEST"
RES="$(node --test 2>&1 | grep -E '^# (pass|fail)' | tr '\n' ' ' || true)"
case "$RES" in *"fail 0"*) ok "tests: $RES" ;; *) die "fallan los tests: $RES" ;; esac

step "3/6 Configuración (.env)"
[ -f .env ] || cp .env.example .env
set_env() { # set_env CLAVE valor (si la línea estaba comentada, la activa)
  if grep -qE "^#? ?$1=" .env; then sed -i -E "s|^#? ?$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
if [ -n "${CR_API_KEY:-}" ]; then set_env CR_API_KEY "$CR_API_KEY"; fi
if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then set_env DISCORD_WEBHOOK_URL "$DISCORD_WEBHOOK_URL"; fi
chmod 600 .env
mkdir -p data
KEY="$(grep -E '^CR_API_KEY=' .env | cut -d= -f2- || true)"
HOOK="$(grep -E '^DISCORD_WEBHOOK_URL=' .env | cut -d= -f2- || true)"
if [ -z "$KEY" ] || [ "$KEY" = "pega_aqui_tu_token" ]; then HAVE_KEY=0; warn "Falta la clave de la API de Clash Royale (CR_API_KEY)"
else HAVE_KEY=1; ok "clave de la API puesta"; fi
if [ -n "$HOOK" ]; then ok "webhook de Discord puesto"; else warn "sin webhook de Discord: no habrá avisos"; fi

step "4/6 Servicio"
PORT="$(grep -E '^PORT=' .env | cut -d= -f2- || true)"; PORT="${PORT:-3055}"
sed -e "s|^User=.*|User=$ME|" -e "s|/opt/clash-war-monitor|$DEST|g" deploy/clash-war-monitor.service \
  | sudo tee /etc/systemd/system/clash-war-monitor.service >/dev/null
sudo systemctl daemon-reload
if [ "$HAVE_KEY" = 0 ]; then
  sudo systemctl disable --now clash-war-monitor >/dev/null 2>&1 || true
  warn "Servicio instalado pero sin arrancar. Cuando tengas la clave:"
  warn "  CR_API_KEY='tu_clave' bash $DEST/deploy/instalar.sh"
  exit 0
fi
if ss -ltn 2>/dev/null | grep -q ":$PORT " && ! systemctl is-active -q clash-war-monitor; then
  die "El puerto $PORT ya lo usa otro programa: cambia PORT en $DEST/.env y repite"
fi
sudo systemctl enable -q clash-war-monitor
sudo systemctl restart clash-war-monitor
for _ in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 || { journalctl -u clash-war-monitor -n 15 --no-pager; die "el servicio no responde"; }
ok "servicio activo en http://127.0.0.1:$PORT"

step "5/6 Comprobaciones con datos reales"
H="Cf-Access-Authenticated-User-Email: instalador@local"
SUM="$(curl -s -H "$H" "http://127.0.0.1:$PORT/api/summary" || true)"
case "$SUM" in
  '{"at"'*) ok "datos de la carrera: $(printf '%s' "$SUM" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const o=j.clans.find(c=>c.own)||j.clans[0];console.log(`${o.name} ${o.position}º · ${j.race.label}`)})')" ;;
  *) printf '%s\n' "$SUM" | head -c 400; echo; die "la API de Clash Royale no responde bien (¿la clave tiene la IP 45.79.218.79?)" ;;
esac
curl -s -H "$H" -o /tmp/cw-prueba.pdf "http://127.0.0.1:$PORT/api/report.pdf" || true
if head -c 5 /tmp/cw-prueba.pdf 2>/dev/null | grep -q '%PDF-'; then ok "PDF del momento: $(du -h /tmp/cw-prueba.pdf | cut -f1)"
else warn "el PDF no se generó (mira: journalctl -u clash-war-monitor -n 30)"; fi

step "6/6 Aviso de prueba en Discord"
if [ -n "$HOOK" ]; then
  if curl -fsS -H 'Content-Type: application/json' \
       -d '{"username":"Monitor de guerra","content":"✅ Monitor de guerra instalado en la Raspberry. Los días de guerra llegará aquí el informe de las 08:00 con su PDF."}' \
       "$HOOK" >/dev/null; then ok "mensaje enviado"; else warn "Discord no aceptó el mensaje"; fi
else warn "sin webhook: me lo salto"; fi

echo
journalctl -u clash-war-monitor -n 6 --no-pager | sed 's/^/  /'
printf '\n\033[32mListo.\033[0m Falta Cloudflare: crwar.ivanius2005.es → localhost:%s y su aplicación de Access.\n' "$PORT"
