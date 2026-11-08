FROM golang:1.23-bookworm AS tdx
WORKDIR /src
COPY vendor/tdx ./vendor/tdx
COPY services/tdx-api ./services/tdx-api
WORKDIR /src/services/tdx-api
RUN CGO_ENABLED=0 go build -o /tdx-api-service .

FROM python:3.12-slim-bookworm
WORKDIR /app
COPY requirements-web.txt .
RUN pip install --no-cache-dir -r requirements-web.txt
COPY . .
COPY --from=tdx /tdx-api-service ./tdx-api-service
ENV LIANGCE_DATA_DIR=/data LIANGCE_V2_RESULT_ROOTS=/tasks
VOLUME ["/data", "/tasks"]
EXPOSE 8765
CMD ["gunicorn","--bind","0.0.0.0:8765","--workers","1","--threads","16","--timeout","120","web_wsgi:application"]
