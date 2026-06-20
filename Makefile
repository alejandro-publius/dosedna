.PHONY: install proxy web all clean smoketest

install:
	cd server && pip install -r requirements.txt

proxy:
	cd server && uvicorn proxy:app --reload --port 8001

web:
	python3 -m http.server 8000

all:
	@echo "Run in two terminals:"
	@echo "  make proxy   # http://localhost:8001"
	@echo "  make web     # http://localhost:8000/dev/test.html"

smoketest:
	@curl -sS http://localhost:8001/ | python3 -m json.tool
	@echo "--- /api/explain ---"
	@curl -sS -X POST http://localhost:8001/api/explain \
	  -H 'Content-Type: application/json' \
	  -d '{"gene":"CYP2C19","phenotype":"Poor metabolizer","drug":"clopidogrel"}' \
	  | python3 -m json.tool

clean:
	find . -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true
	find . -name '*.pyc' -delete 2>/dev/null || true
