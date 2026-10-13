# Static site build for DigitalOcean App Platform (`dockerfile_path` in .do/app.yaml). A Dockerfile instead of
# buildpacks: the root Cargo.toml makes App Platform pick its Rust buildpack, which tries `cargo install`.
# The site needs Node and Rust together; App Platform publishes `output_dir` (/app/apps/web/dist) from the image.
FROM node:24-bookworm

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain stable --target wasm32-unknown-unknown
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund
# `solo` (single user) unless App Platform passes PUBLIC_EDITION as a build-time variable.
ARG PUBLIC_EDITION=solo
ENV PUBLIC_EDITION=${PUBLIC_EDITION}
# Visit counting (apps/web/src/analytics.ts): off unless App Platform passes the PostHog key at build time.
ARG PUBLIC_POSTHOG_KEY=
ARG PUBLIC_POSTHOG_HOST=
ENV PUBLIC_POSTHOG_KEY=${PUBLIC_POSTHOG_KEY} PUBLIC_POSTHOG_HOST=${PUBLIC_POSTHOG_HOST}
RUN bash scripts/build-site.sh
