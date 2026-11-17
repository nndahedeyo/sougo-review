"""相互レビューの決まり（GitHubに触れない部分）。

記録（data/ledger.jsonl）は1行1件の出来事で、券の数も依頼の状態も、すべてこの記録から数え直す。
あとでチェーンに写すときは、この記録をそのまま写せばよい。
"""
import hashlib
import json
import re
from datetime import datetime, timedelta, timezone

ROLES_AI = {"AI"}                        # AIだけで書いたレビュー
KINDS = {"人": "人", "AI": "AI", "人+AI": "人+AI", "人＋AI": "人+AI"}


def now_iso(t=None):
    return (t or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_t(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def digest(text):
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


# ---------- 記録から状態を作る ----------
class State:
    def __init__(self, ledger, rules):
        self.rules = rules
        self.req = {}          # issue番号 -> 依頼の状態
        self.earned, self.spent, self.refund = {}, {}, {}
        self.users = []        # 参加した順
        self.last_review = {}  # レビューした人 -> 最後にレビューした相手
        for e in ledger:
            self.apply(e)

    def _join(self, u):
        if u not in self.users:
            self.users.append(u)

    def apply(self, e):
        k, n, u = e["kind"], e.get("issue"), e.get("user")
        r = self.req.get(n)
        if k == "request":
            self._join(u)
            self.spent[u] = self.spent.get(u, 0) + 1
            self.req[n] = {"issue": n, "by": u, "genre": e["genre"], "repo": e["repo"], "status": "open",
                           "assignee": None, "since": e["t"], "passed": [], "ai_ok": e.get("ai_ok", True)}
        elif r is None:
            return
        elif k == "assign":
            self._join(u); r.update(status="assigned", assignee=u, since=e["t"])
        elif k == "take":
            r.update(status="taken", assignee=u, since=e["t"])
        elif k == "pass":
            r["passed"].append({"user": u, "reason": e.get("reason", "")})
            r.update(status="open", assignee=None, since=e["t"])
        elif k == "submit":
            r.update(status="submitted", since=e["t"], review_kind=e["review_kind"], digest=e["digest"])
        elif k in ("helpful", "not_helpful"):
            r["status"] = "done"
            r["result"] = k
            if k == "helpful" and (r.get("review_kind") != "AI" or self.rules["ai_only_earns_ticket"]):
                self.earned[r["assignee"]] = self.earned.get(r["assignee"], 0) + 1
            self.last_review[r["assignee"]] = r["by"]
        elif k == "refund":
            r["status"] = "closed"
            self.refund[r["by"]] = self.refund.get(r["by"], 0) + 1

    def tickets(self, u):
        return self.rules["start_tickets"] + self.earned.get(u, 0) + self.refund.get(u, 0) - self.spent.get(u, 0)

    def busy(self, u):
        return sum(1 for r in self.req.values() if r["assignee"] == u and r["status"] in ("assigned", "taken"))

    def pick_reviewer(self, n):
        """依頼nを頼む相手を選ぶ。本人・パスした人・依頼した人が直前にレビューした相手（お返しの褒め合いを防ぐ）は除く。
        手の空いている人、参加の早い人の順。"""
        r = self.req[n]
        skip = {r["by"]} | {p["user"] for p in r["passed"]}
        recip = {self.last_review[r["by"]]} if r["by"] in self.last_review else set()   # 依頼した人が直前にレビューした相手
        cands = [u for u in self.users if u not in skip and u not in recip]
        cands.sort(key=lambda u: (self.busy(u), self.users.index(u)))
        return cands[0] if cands else None


# ---------- 依頼のフォームを読む ----------
def parse_form(body):
    out, key = {}, None
    for line in (body or "").splitlines():
        m = re.match(r"^###\s+(.+?)\s*$", line)
        if m:
            key = m.group(1); out[key] = ""
        elif key is not None:
            out[key] += line + "\n"
    return {k: v.strip() for k, v in out.items()}


def check_request(form, author, rules):
    """依頼のフォームの中身を確かめる。戻り値は (問題の一覧, 読み取った値)。"""
    errs = []
    repo = form.get("アプリのリポジトリ", "")
    m = re.match(r"^https://github\.com/([A-Za-z0-9-]+)/([A-Za-z0-9._-]+?)/?$", repo)
    if not m:
        errs.append("アプリのリポジトリは https://github.com/持ち主/名前 の形で書いてください。")
    elif m.group(1).lower() != author.lower():
        errs.append("自分のアカウントのリポジトリだけ依頼できます（アプリの作り手であることの確認）。")
    names = {g["name"]: g["id"] for g in rules["genres"]}
    genre = names.get(form.get("ジャンル", ""))
    if not genre:
        errs.append("ジャンルが選ばれていません。")
    if not form.get("見てほしい点"):
        errs.append("見てほしい点を書いてください。")
    ai_ok = "いいえ" not in form.get("AIだけのレビューを受けるか", "")
    return errs, {"repo": repo, "genre": genre, "ai_ok": ai_ok, "version": form.get("どの版か", "")}


# ---------- コメントの命令を読む ----------
def parse_command(body):
    """コメントの1行目が / で始まるときだけ命令として読む。"""
    first, _, rest = (body or "").strip().partition("\n")
    m = re.match(r"^/(\S+)\s*(.*)$", first.strip())
    if not m:
        return None
    return m.group(1).lower(), m.group(2).strip(), rest.strip()


def review_kind(arg):
    return KINDS.get(arg.replace(" ", ""))
