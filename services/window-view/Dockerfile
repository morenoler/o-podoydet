FROM python:3.12-slim
WORKDIR /app
COPY window_view ./window_view
COPY data ./data
COPY openapi.json ./openapi.json
RUN useradd --create-home app && mkdir /app/.cache && chown app:app /app/.cache
USER app
EXPOSE 8011
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8011/health', timeout=2)"
CMD ["python", "-m", "window_view", "serve", "--host", "0.0.0.0"]
