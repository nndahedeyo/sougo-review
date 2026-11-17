"""相互レビューの係（GitHub Actions から動く）。

- 依頼（Issue）が立ったとき：中身と券を確かめ、レビューする人を選ぶ
- コメントが付いたとき：/take /pass /done /helpful /not-helpful /tickets を処理する
- 毎日1回：返事のない割り当てを次の人に回す、確認のない提出を「役に立った」として閉じる

記録は data/ledger.jsonl に1行ずつ足す。券の数はこの記録から毎回数え直す。
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from core import State, check_request, digest, now_iso, parse_command, parse_form, parse_t, review_kind  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LEDGER = ROOT / "data" / "ledger.jsonl"
RULES = json.loads((ROOT / "data" / "rules.json").read_text(encoding="utf-8"))
LABEL = "依頼"


class GitHub:
    def __init__(self, repo, token):
        self.repo, self.token = repo, token

    def req(self, path, method="GET", body=None):
        url = path if path.startswith("http") else "https://api.github.com" + path
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}", "User-Agent": "sougo-review", "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(r, timeout=30) as f:
            out = f.read()
        return json.loads(out or b"null")

    def comment(self, n, text):
        self.req(f"/repos/{self.repo}/issues/{n}/comments", "POST", {"body": text})

    def assign(self, n, users):
        cur = self.req(f"/repos/{self.repo}/issues/{n}")["assignees"]
        if cur:
            self.req(f"/repos/{self.repo}/issues/{n}/assignees", "DELETE", {"assignees": [a["login"] for a in cur]})
        if users:
            self.req(f"/repos/{self.repo}/issues/{n}/assignees", "POST", {"assignees": users})

    def close(self, n, reason="completed"):
        self.req(f"/repos/{self.repo}/issues/{n}", "PATCH", {"state": "closed", "state_reason": reason})

    def account_days(self, user):
        u = self.req(f"/users/{urllib.parse.quote(user)}")
        if u.get("type") != "User":
            return -1
        return (datetime.now(timezone.utc) - datetime.fromisoformat(u["created_at"].replace("Z", "+00:00"))).days


def load():
    if not LEDGER.exists():
        return []
    return [json.loads(l) for l in LEDGER.read_text(encoding="utf-8").splitlines() if l.strip()]


class Bot:
    def __init__(self, gh, ledger, t=None):
        self.gh, self.ledger, self.t = gh, ledger, t or datetime.now(timezone.utc)
        self.state = State(ledger, RULES)

    def add(self, **e):
        e["t"] = now_iso(self.t)
        self.ledger.append(e)
        self.state.apply(e)

    def genre(self, gid):
        return next(g for g in RULES["genres"] if g["id"] == gid)

    def assign_next(self, n):
        r = self.state.req[n]
        if len(r["passed"]) >= RULES["max_passes"]:
            self.add(kind="refund", issue=n, user=r["by"])
            reasons = "、".join(p["reason"] or "理由なし" for p in r["passed"])
            self.gh.comment(n, f"{RULES['max_passes']}人に見送られたので、いったん閉じて券を1枚お返ししました（見送りの理由：{reasons}）。\n\n"
                               "見てほしい点を1つに絞るか、範囲を小さくして、もう一度依頼してみてください。")
            self.gh.assign(n, []); self.gh.close(n, "not_planned")
            return
        who = self.state.pick_reviewer(n)
        if not who:
            self.gh.assign(n, [])
            self.gh.comment(n, "いま頼める人がいません。参加者が増えたら自動で割り当てます。引き受けてくれる人は、このIssueに `/take` と書いてください。")
            return
        self.add(kind="assign", issue=n, user=who)
        self.gh.assign(n, [who])
        g = self.genre(r["genre"])
        self.gh.comment(n, f"@{who} さん、このレビューをお願いできますか？（{g['name']}・目安{g['minutes']}分）\n\n"
                           f"- 引き受けるとき：`/take`\n- 見送るとき：`/pass 理由`（{' / '.join(RULES['pass_reasons'])}）\n\n"
                           f"{RULES['answer_days']}日以内に返事がなければ、次の人に回ります。見送っても、何も減りません。")

    # ---------- 依頼 ----------
    def on_request(self, issue):
        n, author = issue["number"], issue["user"]["login"]
        if n in self.state.req:
            return
        form = parse_form(issue.get("body"))
        errs, v = check_request(form, author, RULES)
        days = self.gh.account_days(author)
        if days < RULES["min_account_days"]:
            errs.append(f"作られてから{RULES['min_account_days']}日以上たったアカウントで参加できます（使い捨てのアカウントを防ぐため）。")
        if self.state.tickets(author) < 1:
            errs.append("券がありません。だれかのレビューをして「役に立った」と言われると、1枚もらえます。")
        if errs:
            self.gh.comment(n, "この依頼は受け付けられませんでした。\n\n" + "\n".join(f"- {e}" for e in errs) + "\n\n直して、新しく依頼を立て直してください。")
            self.gh.close(n, "not_planned")
            return
        self.add(kind="request", issue=n, user=author, repo=v["repo"], genre=v["genre"], ai_ok=v["ai_ok"],
                 version=v["version"], digest=digest(issue.get("body") or ""))
        self.gh.comment(n, f"受け付けました。券を1枚使いました（残り{self.state.tickets(author)}枚）。")
        self.assign_next(n)

    # ---------- コメント ----------
    def on_comment(self, issue, comment):
        n, who, body = issue["number"], comment["user"]["login"], comment.get("body") or ""
        cmd = parse_command(body)
        if not cmd:
            return
        name, arg, rest = cmd
        if name == "tickets":
            return self.gh.comment(n, f"@{who} さんの券：{self.state.tickets(who)}枚")
        r = self.state.req.get(n)
        if not r or r["status"] in ("done", "closed"):
            return
        if name == "take":
            if who == r["by"]:
                return self.gh.comment(n, "自分の依頼は引き受けられません。")
            if r["status"] == "assigned" and r["assignee"] != who:
                return self.gh.comment(n, f"いまは @{r['assignee']} さんに頼んでいます。")
            if r["status"] not in ("open", "assigned"):
                return
            if r["assignee"] != who and self.gh.account_days(who) < RULES["min_account_days"]:
                return self.gh.comment(n, f"作られてから{RULES['min_account_days']}日以上たったアカウントで引き受けられます。")
            self.add(kind="take", issue=n, user=who)
            self.gh.assign(n, [who])
            g = self.genre(r["genre"])
            return self.gh.comment(n, f"@{who} さんが引き受けました。{RULES['review_days']}日以内に、次の形でコメントしてください。\n\n"
                                      "```\n/done 人      ← 書いた人：人 / AI / 人+AI のどれか\n"
                                      + "\n".join(f"## {c}\n..." for c in g["checklist"]) + "\n```\n\n"
                                      + ("" if r["ai_ok"] else "依頼した人は、AIだけで書いたレビューを望んでいません。\n\n")
                                      + "画面の写真を付けるときは、アドレスや残高が写っていないか確かめてください。")
        if name == "pass" and who == r["assignee"] and r["status"] in ("assigned", "taken"):
            reason = arg if arg in RULES["pass_reasons"] else (arg or "その他")
            self.add(kind="pass", issue=n, user=who, reason=reason)
            self.gh.comment(n, f"見送りを受け付けました（{reason}）。次の人を探します。")
            return self.assign_next(n)
        if name == "done" and who == r["assignee"] and r["status"] == "taken":
            kind = review_kind(arg)
            if not kind:
                return self.gh.comment(n, "1行目を `/done 人`、`/done AI`、`/done 人+AI` のどれかにしてください。")
            if kind == "AI" and not r["ai_ok"]:
                return self.gh.comment(n, "この依頼は、AIだけで書いたレビューを受けていません。")
            if len(rest) < RULES["min_review_chars"]:
                return self.gh.comment(n, f"レビューが短すぎます（{RULES['min_review_chars']}文字以上）。決まった型の項目を埋めてください。")
            self.add(kind="submit", issue=n, user=who, review_kind=kind, digest=digest(rest), comment=comment.get("html_url", ""))
            return self.gh.comment(n, f"@{r['by']} さん、レビューが届きました。\n\n- 役に立ったとき：`/helpful`\n- 役に立たなかったとき：`/not-helpful`\n\n"
                                      f"{RULES['confirm_days']}日たっても返事がなければ「役に立った」として閉じます。")
        if name in ("helpful", "not-helpful") and who == r["by"] and r["status"] == "submitted":
            self.finish(n, name.replace("-", "_"))

    def finish(self, n, result, auto=False):
        r = self.state.req[n]
        before = self.state.tickets(r["assignee"])
        self.add(kind=result, issue=n, user=r["by"], auto=auto)
        got = self.state.tickets(r["assignee"]) - before
        msg = ("確認がなかったので、" if auto else "") + ("「役に立った」で閉じました。" if result == "helpful" else "「役に立たなかった」で閉じました。")
        if got:
            msg += f" @{r['assignee']} さんに券が1枚入りました。"
        elif result == "helpful":
            msg += " AIだけで書いたレビューなので、券は増えません。"
        self.gh.comment(n, msg)
        self.gh.close(n)

    # ---------- 毎日 ----------
    def on_schedule(self):
        for n, r in list(self.state.req.items()):
            age = self.t - parse_t(r["since"])
            if r["status"] == "assigned" and age > timedelta(days=RULES["answer_days"]):
                self.add(kind="pass", issue=n, user=r["assignee"], reason="期限")
                self.assign_next(n)
            elif r["status"] == "taken" and age > timedelta(days=RULES["review_days"]):
                self.add(kind="pass", issue=n, user=r["assignee"], reason="期限")
                self.gh.comment(n, "期限までにレビューが届かなかったので、次の人に回します。")
                self.assign_next(n)
            elif r["status"] == "open" and r["assignee"] is None:
                self.assign_next(n) if self.state.pick_reviewer(n) else None
            elif r["status"] == "submitted" and age > timedelta(days=RULES["confirm_days"]):
                self.finish(n, "helpful", auto=True)


def main():
    ev = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8")) if os.environ.get("GITHUB_EVENT_PATH") else {}
    name = os.environ.get("GITHUB_EVENT_NAME", "schedule")
    gh = GitHub(os.environ["GITHUB_REPOSITORY"], os.environ["GH_TOKEN"])
    ledger = load()
    bot = Bot(gh, ledger)
    issue = ev.get("issue") or {}
    if issue.get("pull_request"):
        return
    labels = {l["name"] for l in issue.get("labels", [])}
    if name == "issues" and LABEL in labels:
        bot.on_request(issue)
    elif name == "issue_comment" and not ev["comment"]["user"]["login"].endswith("[bot]"):
        bot.on_comment(issue, ev["comment"])
    elif name in ("schedule", "workflow_dispatch"):
        bot.on_schedule()
    LEDGER.parent.mkdir(exist_ok=True)
    LEDGER.write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in ledger), encoding="utf-8")


if __name__ == "__main__":
    main()
