.PHONY: install proxy web all clean smoketest test pgx-test parser-test privacy-test known-answer-test getrm agent-test pgxqa-test lit-test benchmark proxy-test

install:
	cd server && pip install -r requirements.txt

proxy:
	cd server && uvicorn proxy:app --reload --port 8001

web:
	python3 -m http.server 8000

all:
	@echo "Run in two terminals:"
	@echo "  make proxy   # http://localhost:8001"
	@echo "  make web     # http://localhost:8000/"

pgx-test:
	@node tests/pgx.test.mjs

parser-test:
	@node tests/parser.test.mjs

privacy-test:
	@node tests/privacy-boundary.test.mjs

known-answer-test:
	@node tests/diplotype-known-answers.test.mjs

getrm:
	@node tests/getrm.test.mjs

agent-test:
	@node tests/agent.test.mjs

pgxqa-test:
	@node tests/pgxqa.test.mjs

lit-test:
	@node tests/literature-grounded.test.mjs

benchmark:
	@node tests/patient-benchmark.test.mjs

# Offline — never calls Anthropic. ANTHROPIC_API_KEY only needs to be set to
# SOMETHING (proxy.py exits without one); every function that would talk to
# the model is monkeypatched before it's called. See server/test_proxy.py.
proxy-test:
	@ANTHROPIC_API_KEY=$${ANTHROPIC_API_KEY:-sk-ant-test-placeholder-not-real} python3 server/test_proxy.py

smoketest:
	@bash scripts/smoketest.sh

test: pgx-test privacy-test known-answer-test proxy-test
	@echo
	@echo "Run 'make smoketest' separately while 'make proxy' is up."
	@echo "Run 'make getrm' separately for CDC GeT-RM known-answer fixtures."

clean:
	find . -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true
	find . -name '*.pyc' -delete 2>/dev/null || true
