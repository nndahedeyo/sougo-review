"""相互レビューの流れを、GitHubの代わりの見本で確かめる。使い方: python3 tests/test_flow.py"""
import sys, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import bot as B

T0 = datetime(2026, 11, 20, tzinfo=timezone.utc)

class FakeGH:
    def __init__(self, ages=None):
        self.comments, self.assignees, self.closed, self.ages = [], {}, {}, ages or {}
    def comment(self, n, text): self.comments.append((n, text))
    def assign(self, n, users): self.assignees[n] = list(users)
    def close(self, n, reason="completed"): self.closed[n] = reason
    def account_days(self, u): return self.ages.get(u, 400)
    def last(self, n): return [c for i, c in self.comments if i == n][-1]

def form(owner, repo="app", genre="アプリの使い心地", ai="はい"):
    return (f"### アプリのリポジトリ\n\nhttps://github.com/{owner}/{repo}\n\n### どの版か\n\nv1.0\n\n### ジャンル\n\n{genre}\n\n"
            f"### 見てほしい点\n\n最初の画面で迷わないか\n\n### AIだけのレビューを受けるか\n\n{ai}\n")
def issue(n, user, body): return {"number": n, "user": {"login": user}, "body": body}
def cm(user, body): return {"user": {"login": user}, "body": body, "html_url": "u"}
REVIEW = "## 確かめた端末\niPhone 15 / Safari\n" + "とても丁寧に見ました。" * 30

class Flow(unittest.TestCase):
    def setUp(self):
        self.gh, self.ledger = FakeGH(), []
    def bot(self, days=0):
        return B.Bot(self.gh, self.ledger, T0 + timedelta(days=days))

    def test_full_cycle_and_tickets(self):
        b = self.bot(); b.on_request(issue(1, "alice", form("alice")))
        self.assertIn("いま頼める人がいません", self.gh.last(1))           # まだ一人
        b.on_request(issue(2, "bob", form("bob")))                       # bob が来ると alice に頼む
        self.assertEqual(self.gh.assignees[2], ["alice"])
        b = self.bot(); b.on_schedule()                                  # 1の依頼に bob が割り当たる
        self.assertEqual(self.gh.assignees[1], ["bob"])
        b.on_comment(issue(1, "alice", ""), cm("bob", "/take"))
        b.on_comment(issue(1, "alice", ""), cm("bob", "/done 人\n" + REVIEW))
        self.assertEqual(b.state.req[1]["status"], "submitted")
        self.assertTrue(b.state.req[1]["digest"].startswith("sha256:"))
        b.on_comment(issue(1, "alice", ""), cm("alice", "/helpful"))
        self.assertEqual(b.state.tickets("bob"), 1)                      # 1枚使って1枚もらった
        self.assertEqual(b.state.tickets("alice"), 0)
        self.assertEqual(self.gh.closed[1], "completed")

    def test_reject_others_repo_young_account_no_ticket(self):
        self.gh.ages = {"newbie": 10}
        b = self.bot(); b.on_request(issue(1, "carol", form("someoneelse")))
        self.assertIn("自分のアカウントのリポジトリ", self.gh.last(1))
        b.on_request(issue(2, "newbie", form("newbie")))
        self.assertIn("90日", self.gh.last(2))
        b.on_request(issue(3, "carol", form("carol")))
        b.on_request(issue(4, "carol", form("carol", "app2")))
        self.assertIn("券がありません", self.gh.last(4))

    def test_pass_three_times_refunds(self):
        b = self.bot()
        for i, u in enumerate(["a", "b", "c", "d"]):
            b.on_request(issue(10 + i, u, form(u)))
        b = self.bot()
        n = 13   # d の依頼
        for _ in range(3):
            who = b.state.req[n]["assignee"] or b.state.pick_reviewer(n)
            if not b.state.req[n]["assignee"]: b.assign_next(n); who = b.state.req[n]["assignee"]
            b.on_comment(issue(n, "d", ""), cm(who, "/pass 重すぎる"))
        self.assertEqual(self.gh.closed[n], "not_planned")
        self.assertIn("券を1枚お返し", self.gh.last(n))
        self.assertEqual(b.state.tickets("d"), 1)

    def test_no_answer_moves_on_and_auto_helpful(self):
        b = self.bot(); b.on_request(issue(1, "a", form("a"))); b.on_request(issue(2, "b", form("b"))); b.on_request(issue(3, "c", form("c")))
        first = b.state.req[3]["assignee"]
        b = self.bot(4); b.on_schedule()
        self.assertNotEqual(b.state.req[3]["assignee"], first)          # 返事がないので次の人へ
        who = b.state.req[3]["assignee"]
        b.on_comment(issue(3, "c", ""), cm(who, "/take")); b.on_comment(issue(3, "c", ""), cm(who, "/done 人+AI\n" + REVIEW))
        b = self.bot(12); b.on_schedule()
        self.assertEqual(b.state.req[3]["result"], "helpful")

    def test_ai_only_review_earns_nothing_and_can_be_refused(self):
        b = self.bot(); b.on_request(issue(1, "a", form("a", ai="いいえ"))); b.on_request(issue(2, "b", form("b")))
        b = self.bot(); b.on_schedule()
        who = b.state.req[1]["assignee"]
        b.on_comment(issue(1, "a", ""), cm(who, "/take"))
        b.on_comment(issue(1, "a", ""), cm(who, "/done AI\n" + REVIEW))
        self.assertIn("AIだけで書いたレビューを受けていません", self.gh.last(1))
        r2 = b.state.req[2]["assignee"]
        b.on_comment(issue(2, "b", ""), cm(r2, "/take")); b.on_comment(issue(2, "b", ""), cm(r2, "/done AI\n" + REVIEW))
        before = b.state.tickets(r2); b.on_comment(issue(2, "b", ""), cm("b", "/helpful"))
        self.assertEqual(b.state.tickets(r2), before)
        self.assertIn("券は増えません", self.gh.last(2))

    def test_no_direct_return_favor(self):
        b = self.bot()
        for i, u in enumerate(["a", "b", "c"]): b.on_request(issue(i + 1, u, form(u)))
        b = self.bot(); b.on_schedule()
        # a の依頼を誰かが仕上げる
        who = b.state.req[1]["assignee"]
        b.on_comment(issue(1, "a", ""), cm(who, "/take")); b.on_comment(issue(1, "a", ""), cm(who, "/done 人\n" + REVIEW)); b.on_comment(issue(1, "a", ""), cm("a", "/helpful"))
        b.on_request(issue(9, who, form(who, "app9")))
        self.assertNotEqual(b.state.pick_reviewer(9), "a")              # レビューしてもらった a が、すぐお返しする形にしない

    def test_only_right_people_can_act(self):
        b = self.bot(); b.on_request(issue(1, "a", form("a"))); b.on_request(issue(2, "b", form("b")))
        b.on_comment(issue(2, "b", ""), cm("b", "/take"))
        self.assertIn("自分の依頼", self.gh.last(2))
        b.on_comment(issue(2, "b", ""), cm("z", "/done 人\n" + REVIEW))
        self.assertEqual(b.state.req[2]["status"], "assigned")

if __name__ == "__main__":
    unittest.main(verbosity=1)
