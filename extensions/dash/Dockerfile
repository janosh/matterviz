# Dockerfile for Hugging Face Spaces deployment
FROM python:3.11-slim

# Pin to a specific ref (branch/tag/commit) for reproducible builds.
# Override with: docker build --build-arg MATTERVIZ_REF=v1.0.0 .
ARG MATTERVIZ_REF=main

WORKDIR /app

# Install system dependencies including Node.js for building JS bundle
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pnpm \
    && rm -rf /var/lib/apt/lists/*

# Clone the matterviz repo at specified ref (includes data files)
RUN git clone --depth 1 --branch ${MATTERVIZ_REF} https://github.com/janosh/matterviz.git /app/matterviz

WORKDIR /app/matterviz/extensions/dash

# Build JS bundle
RUN pnpm install && pnpm run build

# Install Python dependencies
RUN pip install --no-cache-dir dash>=3.0 && \
    pip install --no-cache-dir -e .

# Copy the HF demo app from build context (overrides any version from git clone)
COPY hf_demo_app.py /app/matterviz/extensions/dash/hf_demo_app.py

# Expose the port (HF Spaces uses 7860 by default)
EXPOSE 7860

# Set environment variables
ENV DASH_DEBUG=0
ENV DASH_PORT=7860
ENV DASH_HOST=0.0.0.0
ENV MATTERVIZ_ROOT=/app/matterviz

# Run the HF demo app (uses embedded data, no file loading)
CMD ["python", "hf_demo_app.py"]
