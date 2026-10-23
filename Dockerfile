FROM node:20-alpine
# Python + reportlab para los PDF, y fuentes para los símbolos raros de algunos nombres
RUN apk add --no-cache python3 py3-reportlab tzdata font-dejavu font-freefont font-wqy-zenhei
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
COPY scripts/pdf_report.py ./scripts/
COPY fonts ./fonts
COPY deploy/dashboard-card.html ./deploy/
# Carpeta del registro diario de mazos (móntala como volumen para no perderla)
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
ENV HOST=0.0.0.0 PORT=3055 NODE_ENV=production
EXPOSE 3055
USER node
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:3055/api/health || exit 1
CMD ["node", "server.js"]
