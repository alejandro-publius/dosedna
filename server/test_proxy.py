"""Regression tests for the DoseDNA proxy's claim boundary (BUILD_SPEC §15).

Run with: python3 server/test_proxy.py   (or: make proxy-test)

These tests never make a real network call and never need a real API key.
`ANTHROPIC_API_KEY` is set to an inert placeholder purely so the module's
import-time guard (`sys.exit` if unset) doesn't fire; `_call_claude` and
`client.messages.create` are monkeypatched before any call that would use
it, so nothing is ever sent to Anthropic.

What's under test: BUILD_SPEC §15 says the post-validation denylist that
`scripts/precompute_explanations.py` runs for the offline batch job must
ALSO apply "at runtime too for any live call." Before this fix, the live
call inside `_handle_explain` (the cache-miss fallback for /api/explain,
which is the ONLY path that runs at all right now since explanations.json
has never been generated/committed) returned whatever text the model
produced with zero validation — a specific dose, an imperative instruction,
or a mention of a different drug would reach the patient verbatim. Same
gap, independently, in `_handle_chat`'s final reply when the model answers
without ever calling a tool.
"""

import os
import sys
from pathlib import Path

os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test-placeholder-not-real")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

import proxy  # noqa: E402

pass_count = 0
fail_count = 0
failures = []


def check(name, condition, detail=""):
    global pass_count, fail_count
    if condition:
        pass_count += 1
        print(f"  ✓ {name}")
    else:
        fail_count += 1
        failures.append(f"✗ {name}" + (f"\n    {detail}" if detail else ""))
        print(f"  ✗ {name}")


def section(title):
    print(f"\n{title}")


def pick_allowed_tuple():
    return next(iter(proxy._ALLOWED_TUPLES))


# ─── /api/explain live path: unsafe model output must never reach the user ──
section("_handle_explain — live call is post-validated against the BUILD_SPEC §15 denylist")

gene, phenotype, drug = pick_allowed_tuple()
bundle_key = f"{gene}|{phenotype}|{drug}|confident"
proxy._EXPLANATIONS.pop(bundle_key, None)  # force the live path, not a bundle hit

BAD_TEXT = "You should take 20mg twice daily and stop clopidogrel immediately."


def fake_call_claude_bad(system_text, user_message, max_tokens=500):
    return BAD_TEXT


original_call_claude = proxy._call_claude
proxy._call_claude = fake_call_claude_bad
try:
    req = proxy.ExplainKindRequest(
        kind="explain", gene=gene, phenotype=phenotype, drug=drug, coverage_state="confident"
    )
    resp = proxy._handle_explain(req)
    check(
        "dose + imperative + wrong-drug text is NOT forwarded to the patient",
        resp.explanation != BAD_TEXT,
        f"got explanation={resp.explanation!r}",
    )
    check(
        'rejected live output falls back to source="fallback"',
        resp.source == "fallback",
        f"got source={resp.source!r}",
    )
    check(
        "fallback explanation still names the correct gene/phenotype/drug",
        gene in resp.explanation and drug in resp.explanation,
        f"got explanation={resp.explanation!r}",
    )
finally:
    proxy._call_claude = original_call_claude

# A CLEAN model response (no dose, no imperative, no other-drug mention)
# must still pass through — this is not a "block everything live" change.
GOOD_TEXT = (
    "Your result suggests this medication may work differently for you than "
    "for most people. Ask your pharmacist whether an alternative makes sense."
)


def fake_call_claude_good(system_text, user_message, max_tokens=500):
    return GOOD_TEXT


proxy._call_claude = fake_call_claude_good
try:
    req = proxy.ExplainKindRequest(
        kind="explain", gene=gene, phenotype=phenotype, drug=drug, coverage_state="confident"
    )
    resp = proxy._handle_explain(req)
    check(
        "a clean, denylist-passing live response is still forwarded verbatim",
        resp.explanation == GOOD_TEXT and resp.source == "claude",
        f"got explanation={resp.explanation!r} source={resp.source!r}",
    )
finally:
    proxy._call_claude = original_call_claude


# ─── Chat: a reply that never called a tool must still be dose-checked ──────
section("_handle_chat — a zero-tool-call reply cannot leak a specific dose")


class FakeTextBlock:
    def __init__(self, text):
        self.type = "text"
        self.text = text


class FakeResponse:
    def __init__(self, stop_reason, content):
        self.stop_reason = stop_reason
        self.content = content


def make_fake_create(reply_text):
    def _fake_create(**kwargs):
        return FakeResponse("end_turn", [FakeTextBlock(reply_text)])

    return _fake_create


original_create = proxy.client.messages.create

BAD_CHAT_TEXT = "Take 20mg of clopidogrel once daily until your next visit."
proxy.client.messages.create = make_fake_create(BAD_CHAT_TEXT)
try:
    chat_req = proxy.ChatKindRequest(kind="chat", message="Is clopidogrel safe for me?")
    resp = proxy._handle_chat(chat_req)
    check(
        "a dose-bearing zero-tool-call reply is not forwarded to the user",
        resp.reply != BAD_CHAT_TEXT,
        f"got reply={resp.reply!r}",
    )
    check(
        'dose-bearing chat reply is reported as source="fallback"',
        resp.source == "fallback",
        f"got source={resp.source!r}",
    )
finally:
    proxy.client.messages.create = original_create

GOOD_CHAT_TEXT = (
    "I don't have your CYP2C19 status loaded yet, so I can't say. Load your "
    "DNA file first, then ask again."
)
proxy.client.messages.create = make_fake_create(GOOD_CHAT_TEXT)
try:
    chat_req = proxy.ChatKindRequest(kind="chat", message="Is clopidogrel safe for me?")
    resp = proxy._handle_chat(chat_req)
    check(
        "a dose-free zero-tool-call reply still reaches the user unmodified",
        resp.reply == GOOD_CHAT_TEXT and resp.source == "claude",
        f"got reply={resp.reply!r} source={resp.source!r}",
    )
finally:
    proxy.client.messages.create = original_create


# ─── Summary ─────────────────────────────────────────────────────────────────
print(f"\n{pass_count} passed, {fail_count} failed")
if fail_count > 0:
    print("\n" + "\n".join(failures))
    sys.exit(1)
