# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM maven:3.9.9-eclipse-temurin-21 AS backend
WORKDIR /build
COPY server/pom.xml server/pom.xml
RUN mvn -B -f server/pom.xml dependency:go-offline
COPY server/src server/src
RUN mvn -B -f server/pom.xml package -DskipTests

FROM eclipse-temurin:21-jre-noble AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --create-home app
WORKDIR /app
COPY --from=backend /build/server/target/o-podoydet-server.jar /app/server.jar
COPY --from=frontend /build/dist /app/dist
COPY data /app/data
COPY agents /app/agents
COPY scripts/jury-demo.py /app/scripts/jury-demo.py
RUN mkdir -p /app/.local/uploads && chown -R app:app /app/.local
USER app
ENV BIND_ADDRESS=0.0.0.0 PORT=8080 DIST_PATH=/app/dist \
    UPLOADS_PATH=/app/.local/uploads ADVISOR_PYTHON=python3 \
    PYTHONUTF8=1 PYTHONDONTWRITEBYTECODE=1 AI_PROVIDER=rules
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=90s --retries=6 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=3).read()"
ENTRYPOINT ["java", "-Dfile.encoding=UTF-8", "-jar", "/app/server.jar"]
