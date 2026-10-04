FROM python:3.12-slim
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:0.10.9 /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
COPY src ./src
ARG CANDIDATE_DEPS=false
RUN if [ "$CANDIDATE_DEPS" = "true" ]; then uv sync --locked --no-dev --extra candidates; else uv sync --locked --no-dev; fi
RUN useradd --uid 10001 --create-home classifier
USER classifier
ENV PYTHONDONTWRITEBYTECODE=1
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8080
CMD ["uvicorn", "grit_ml.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8080", "--limit-concurrency", "8"]
