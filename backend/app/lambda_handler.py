from __future__ import annotations

from mangum import Mangum

from app.main import app

# AWS Lambda entrypoint for API Gateway HTTP API.
handler = Mangum(app, lifespan="off")
