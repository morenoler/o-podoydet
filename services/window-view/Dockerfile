FROM python:3.13-slim-bookworm
WORKDIR /service
COPY window_view window_view
COPY data data
COPY openapi.json openapi.json
RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --create-home app \
    && mkdir -p /service/.cache && chown app:app /service/.cache
USER app
ENV PYTHONUTF8=1 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 8011
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8011/health', timeout=3).read()"
CMD ["python", "-m", "window_view", "serve", "--host", "0.0.0.0", "--port", "8011"]
