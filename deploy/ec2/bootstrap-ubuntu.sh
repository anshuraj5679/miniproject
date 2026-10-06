#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git

if ! command -v docker >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

if id -u ubuntu >/dev/null 2>&1; then
  sudo usermod -aG docker ubuntu || true
fi
sudo mkdir -p /opt/safebill
if id -u ubuntu >/dev/null 2>&1; then
  sudo chown -R ubuntu:ubuntu /opt/safebill
fi

cat <<'EOF'
Bootstrap complete.

Next steps on the EC2 instance:
  cd /opt/safebill
  git clone https://github.com/SCARPxVeNOM/SAFE.git
  cd SAFE
  cp deploy/ec2/app.env.example deploy/ec2/.env
  nano deploy/ec2/.env
  docker compose -f deploy/ec2/docker-compose.yml --env-file deploy/ec2/.env up -d --build

Public app URL:
  http://<EC2_PUBLIC_IP>
EOF
