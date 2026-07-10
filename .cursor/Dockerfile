FROM node:22-bookworm

RUN corepack enable

# Cloud agents need git (clone/checkout) and sudo for system tasks.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git sudo ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Non-root user expected by Cursor cloud agents.
RUN id -u ubuntu >/dev/null 2>&1 || useradd -m -s /bin/bash ubuntu \
  && usermod -aG sudo ubuntu \
  && echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu

USER ubuntu
WORKDIR /home/ubuntu
