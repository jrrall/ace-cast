# Build from the card-forge directory: docker build -t card-forge:local card-forge
FROM ghcr.io/astral-sh/uv:0.8.22 AS uv
FROM docker.io/library/python:3.13-slim-bookworm AS builder
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock README.md ./
COPY forge ./forge
RUN uv sync --frozen --no-dev --no-editable

FROM docker.io/library/python:3.13-slim-bookworm
LABEL org.opencontainers.image.title="Card Forge" \
      org.opencontainers.image.source="https://github.com/jrrall/ace-cast" \
      org.opencontainers.image.description="Generate pending cards for human review on unholy.cards"
RUN useradd --uid 10001 --create-home forge
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY scripts/live_smoke.py /app/scripts/live_smoke.py
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    CONTENT_API_URL="https://unholy.cards" \
    LLM_BASE_URL="http://host.docker.internal:11434/v1"
USER 10001:10001
ENTRYPOINT ["card-forge"]
