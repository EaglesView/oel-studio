# Static site build for DigitalOcean App Platform (`dockerfile_path` in .do/app.yaml). A Dockerfile instead of
# buildpacks: the root Cargo.toml makes App Platform pick its Rust buildpack, which tries `cargo install`.
# The site needs Node and Rust together; App Platform publishes `output_dir` (/app/apps/web/dist) from the image.
# Pinned: Node as in .nvmrc, by digest so a rebuild gets the same image. To update, take the digest of the new
# tag (`skopeo inspect --raw docker://docker.io/library/node:<version>-bookworm | sha256sum`) and change .nvmrc too.
FROM node:24.22.1-bookworm@sha256:6449e19d8184d84062525b6a7524def03146c2cb04a7f08b076680d0e8e4240a

# rustup only; the Rust version comes from rust-toolchain.toml once the repository is copied.
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /app
COPY . .
RUN rustup toolchain install
RUN npm ci --no-audit --no-fund
# `solo` (single user) unless App Platform passes PUBLIC_EDITION as a build-time variable.
ARG PUBLIC_EDITION=solo
ENV PUBLIC_EDITION=${PUBLIC_EDITION}
# Visit counting (apps/web/src/analytics.ts): off unless App Platform passes the PostHog key at build time.
ARG PUBLIC_POSTHOG_KEY=
ARG PUBLIC_POSTHOG_HOST=
ENV PUBLIC_POSTHOG_KEY=${PUBLIC_POSTHOG_KEY} PUBLIC_POSTHOG_HOST=${PUBLIC_POSTHOG_HOST}
RUN bash scripts/build-site.sh
