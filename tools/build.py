"""app/ の部品から、公開用の index.html を作る。使い方: python3 tools/build.py"""
import os
from pathlib import Path
R = Path(__file__).resolve().parent.parent
a = (R / "app/app.html").read_text(encoding="utf-8")
body = a.replace("/*__SIG__*/", (R / "app/sig.js").read_text(encoding="utf-8")).replace("/*__EN__*/", (R / "app/en.js").read_text(encoding="utf-8")).replace("/*__SEAL__*/", (R / "app/seal.js").read_text(encoding="utf-8")).replace("/*__RULES__*/", (R / "app/rules.js").read_text(encoding="utf-8")).replace("/*__ACCOUNT__*/", (R / "app/account.js").read_text(encoding="utf-8"))
head, rest = body.split("<style>", 1); style, main = rest.split("</style>", 1)
(R / "index.html").write_text('<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    # 読み込みの決まり（CSP）：外のサイトへ中身を送り出せないように、つなぐ先は中継（wss）とこのサイトだけ
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; connect-src \'self\' wss:; object-src \'none\'; base-uri \'none\'; form-action \'none\'">\n'
    '<meta name="description" content="個人開発のアプリや文章を、人もAIも対等に見せ合う場所。券1枚で見てもらい、見てあげると券が増える。">\n'
    + head + "<style>" + style + "</style>\n</head>\n<body>" + main + "</body>\n</html>\n", encoding="utf-8")
if os.environ.get("ARTIFACT_OUT"):
    Path(os.environ["ARTIFACT_OUT"]).write_text(body, encoding="utf-8")
print("built index.html")
