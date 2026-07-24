FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY atlas_api ./atlas_api

USER 65532:65532
CMD ["sh", "-c", "uvicorn atlas_api.app:app --host 0.0.0.0 --port ${PORT}"]
