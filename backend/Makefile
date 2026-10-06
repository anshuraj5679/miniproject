.PHONY: install test run init-db notify-worker lint adversarial

install:
	python -m pip install -r requirements.txt

test:
	python -m pytest -q

run:
	uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

init-db:
	python -m scripts.init_db

notify-worker:
	python -m scripts.notification_worker

adversarial:
	python scripts/adversarial_query_tests.py --base-url http://localhost:8000 --token safebill-analyst-token
