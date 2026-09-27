#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""形象卡补丁工具（Python 版）

跟 `whale-chan/bin/card.mjs` 是同一件事的两个入口，格式完全一样 ——
哪个顺手用哪个。它只动「形象卡.md」这一份文件，不碰 persona_rinrin.md /
memory_rinrin.md（那两份是素材，形象卡才是活的）。

第一次跑（还没有卡）会自动把发行包自带的那张复制到记忆目录，
所以命令可以直接敲，不需要先 `init`。

    python card.py show                                 她在读哪份卡、好感度、分量
    python card.py log "今天把 console.log 都换掉了"
    python card.py session "第一次会话"                  追加日志并 sessions_count +1
    python card.py favor +8                             好感度动一下（夹在 0..favor_max）
    python card.py set address_user_as 主人              改状态里的一个字段
    python card.py patch 补丁.json                       按一份补丁批量改
    python card.py path                                 只打印卡的路径
    python card.py init                                 没有卡就从发行包复制一张

选项（可放在任意位置）：
    --card <文件>    指定卡
    --dir <目录>     记忆目录（默认 ~/.dsh/whale-chan，可用 WHALE_MEMORY_DIR 覆盖）
    --cwd <目录>     工作目录（默认当前目录）

补丁是一份 JSON，字段都可以省：

    {
      "state": { "address_user_as": "主人", "favor": 88 },
      "favor": "+8",
      "log": ["一行", "另一行"],
      "session": true
    }

state 直接合并进卡里的状态 JSON；favor 带 +/- 当增量、不带当绝对值；
log 一行一个项目符号；session=true 时 sessions_count +1。
"""

import json
import os
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

# Windows 控制台默认是 GBK 代码页，中文直接 print 会变成乱码。
# 这里把标准输出掰成 UTF-8 —— 踩过：输出乱码害我以为命令没执行。
for _stream in (sys.stdout, sys.stderr):
    try:
        if (_stream.encoding or "").lower().replace("-", "") != "utf8":
            _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError, OSError):
        pass

BOM = "\ufeff"
CARD_NAME = "形象卡.md"
STATE_HEADING = "## 一、状态（机器可读）"
PERSONA_HEADING = "## 三、人设"
MEMORY_HEADING = "## 四、记忆"
LOG_HEADING = "## 五、会话日志（新条目追加在最上面）"
SECTION_RE = re.compile(r"^##\s+", re.MULTILINE)
STATE_RE = re.compile(r"```json\s*(\{.*?\})\s*```", re.DOTALL)

# 发行包自带的那张卡（装了 VS Code 扩展 / 复制过发行包的话就在这几处）
_HERE = Path(__file__).resolve().parent
BUNDLED_CANDIDATES = [
    _HERE / CARD_NAME,
    _HERE / "whale-chan" / "assets" / "cards" / "rinrin.md",
    _HERE / "assets" / "cards" / "rinrin.md",
    # 本脚本就住在 whale-chan/bin/ 里的时候，卡在隔壁的 assets/cards/ 下面。
    _HERE.parent / "assets" / "cards" / "rinrin.md",
    Path(os.environ["WHALE_CARD"]) if os.environ.get("WHALE_CARD") else None,
]
BUNDLED = next((p for p in BUNDLED_CANDIDATES if p and p.is_file()), BUNDLED_CANDIDATES[1])


# ----------------------------------------------------------------- 基础读写

def strip_bom(text):
    return text[1:] if text.startswith(BOM) else text


def read_text(path):
    """读文件：去 BOM、CRLF 归一成 LF。"""
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        return strip_bom(handle.read()).replace("\r\n", "\n")


def write_text(path, text):
    """写文件：统一带 BOM，行尾 LF。

    带 BOM 是因为 Windows 上一堆编辑器（记事本、PowerShell 的
    Set-Content -Encoding UTF8）默认就写 BOM，统一带上才不会来回打架。
    """
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(BOM + text)


def memory_dir(explicit=None):
    if explicit:
        return Path(explicit)
    env = os.environ.get("WHALE_MEMORY_DIR")
    if env:
        return Path(env)
    home = Path(os.environ.get("DSH_HOME") or (Path.home() / ".dsh"))
    return home / "whale-chan"


# ----------------------------------------------------------------- 解析形象卡

class Card(object):
    """一份形象卡：整份文本 + 状态 JSON + 日志小节的正文区间。"""

    def __init__(self, path, text):
        self.path = Path(path)
        self.text = text
        state_match = STATE_RE.search(text)
        if not state_match:
            raise ValueError("卡里找不到 ```json 状态块")
        self.state_span = state_match.span(1)
        self.state = json.loads(state_match.group(1))
        log_at = text.find(LOG_HEADING)
        if log_at < 0:
            raise ValueError("卡里找不到「%s」小节" % LOG_HEADING)
        self.log_head = log_at + len(LOG_HEADING)
        # 日志小节的正文，到下一个 ## 为止
        nxt = SECTION_RE.search(text, self.log_head)
        self.log_end = nxt.start() if nxt else len(text)
        self._reindex()

    def _reindex(self):
        self.body = self.text[self.log_head:self.log_end]
        self.tail = self.text[self.log_end:]

    def _body_of(self, heading):
        at = self.text.find(heading)
        if at < 0:
            return ""
        nxt = SECTION_RE.search(self.text, at + len(heading))
        return self.text[at + len(heading):nxt.start() if nxt else len(self.text)]

    # ---- 状态

    def dump_state(self):
        block = "```json\n%s\n```" % json.dumps(self.state, ensure_ascii=False, indent=2)
        self.text = self.text[:self.state_span[0]] + block + self.text[self.state_span[1]:]
        # 状态块换长度了，日志区间要跟着挪
        delta = len(block) - (self.state_span[1] - self.state_span[0])
        self.state_span = (self.state_span[0], self.state_span[0] + len(block))
        self.log_head += delta
        self.log_end += delta
        self._reindex()

    def set_state(self, patch):
        self.state.update(patch)
        self.dump_state()
        return self.state

    def bump_favor(self, delta):
        before = int(self.state.get("favor") or 0)
        top = int(self.state.get("favor_max") or 100)
        after = max(0, min(top, before + int(delta)))
        self.set_state({"favor": after})
        return before, after

    # ---- 日志

    def append_log(self, lines, stamp=None, bump_session=False):
        if isinstance(lines, str):
            lines = lines.split("\n")
        lines = [str(line).strip() for line in lines if str(line).strip()]
        if not lines:
            return
        stamp = stamp or datetime.now().strftime("%Y-%m-%d %H:%M")
        block = "\n".join(["### %s" % stamp, ""] + ["- %s" % line for line in lines])
        body = self.body
        if body.startswith("\n\n"):
            body = body[2:]
        elif body.startswith("\n"):
            body = body[1:]
        self.body = (block + "\n\n" + body) if body else (block + "\n")
        self.text = self.text[:self.log_head] + self.body + self.tail
        self.log_end += len(self.body) - (self.log_end - self.log_head)
        if bump_session:
            self.set_state({"sessions_count": int(self.state.get("sessions_count") or 0) + 1})
        self.set_state({"updated": stamp})

    def save(self):
        write_text(self.path, self.text)

    def summary(self):
        parts = [str(self.state.get("name") or self.state.get("card") or "（没名字）")]
        if self.state.get("favor") is not None:
            parts.append("好感度 %s%%" % self.state.get("favor"))
        if self.state.get("address_user_as"):
            parts.append("称呼「%s」" % self.state["address_user_as"])
        if self.state.get("sessions_count") is not None:
            parts.append("第 %d 次会话" % (int(self.state["sessions_count"]) + 1))
        return " · ".join(parts)

    def weight(self):
        persona = len(self._body_of(PERSONA_HEADING))
        memory = len(self._body_of(MEMORY_HEADING))
        log = len(self.body)
        return {"persona": persona, "memory": memory, "log": log,
                "total": persona + memory + log}


# ----------------------------------------------------------------- 找卡

def find_card(explicit=None, cwd=None, mem_dir=None, create=False):
    if explicit and explicit != "off":
        path = Path(explicit).expanduser()
        if path.is_file():
            return path
        raise SystemExit("指定的形象卡不存在：%s" % path)

    cwd = Path(cwd or os.getcwd())
    mem_dir = memory_dir(mem_dir)

    candidates = [cwd / CARD_NAME]
    card_dir = cwd / "形象卡"
    if card_dir.is_dir():
        candidates += sorted(card_dir.glob("*.md"))
    candidates.append(mem_dir / CARD_NAME)

    for path in candidates:
        if path.is_file():
            return path

    if create:
        target = mem_dir / CARD_NAME
        if BUNDLED.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(str(BUNDLED), str(target))
            return target
        raise SystemExit("没找到形象卡，发行包里也没有自带的那张（%s）" % BUNDLED)

    raise SystemExit(
        "没找到形象卡。放一份到下面任意位置，或用 --card 指定：\n"
        "  1. %s\n  2. %s\\*.md\n  3. %s" % (cwd / CARD_NAME, card_dir, mem_dir / CARD_NAME)
    )


def open_card(options, create=False):
    path = find_card(options.get("card"), options.get("cwd"), options.get("dir"), create=create)
    return Card(path, read_text(path))


def show(card):
    weight = card.weight()
    print("形象卡：%s" % card.path)
    print("状态：%s" % card.summary())
    print("分量：人设 %d 字 · 记忆 %d 字 · 日志 %d 字（每轮都带）"
          % (weight["persona"], weight["memory"], weight["log"]))


# ----------------------------------------------------------------- 命令行

def parse_argv(argv):
    options = {"command": "", "rest": [], "card": None, "dir": None, "cwd": None}
    args = list(argv)
    while args:
        item = args.pop(0)
        if item == "--card":
            options["card"] = args.pop(0) if args else None
        elif item == "--dir":
            options["dir"] = args.pop(0) if args else None
        elif item == "--cwd":
            options["cwd"] = args.pop(0) if args else None
        elif item in ("-h", "--help"):
            options["command"] = "help"
        elif not options["command"]:
            options["command"] = item
        else:
            options["rest"].append(item)
    if not options["command"]:
        options["command"] = "show"
    return options


def coerce(raw):
    text = str(raw)
    if re.match(r"^-?\d+$", text):
        return int(text)
    if re.match(r"^-?\d+\.\d+$", text):
        return float(text)
    if text == "true":
        return True
    if text == "false":
        return False
    if text == "null":
        return None
    return text


def run(options):
    command = options["command"]
    if command == "help":
        print(__doc__.strip())
        return 0

    if command == "path":
        print(find_card(options.get("card"), options.get("cwd"), options.get("dir"), create=True))
        return 0

    if command == "init":
        show(open_card(options, create=True))
        return 0

    card = open_card(options, create=True)

    if command == "show":
        show(card)
        return 0

    if command in ("log", "session"):
        body = " ".join(options["rest"]).strip()
        if not body:
            raise SystemExit('用法：card.py %s "内容"' % command)
        card.append_log(body, bump_session=(command == "session"))
        card.save()
        show(card)
        return 0

    if command == "favor":
        raw = options["rest"][0] if options["rest"] else None
        if raw is None:
            raise SystemExit("用法：favor +8 · favor -3 · favor 45")
        before = int(card.state.get("favor") or 0)
        delta = int(raw) if re.match(r"^[+-]\d+$", raw) else int(raw) - before
        before, after = card.bump_favor(delta)
        card.save()
        show(card)
        print("好感度：%d → %d" % (before, after))
        return 0

    if command == "set":
        if len(options["rest"]) < 2:
            raise SystemExit("用法：set 字段 值")
        key = options["rest"][0]
        value = coerce(" ".join(options["rest"][1:]))
        card.set_state({key: value})
        card.save()
        show(card)
        print("%s = %s" % (key, json.dumps(value, ensure_ascii=False)))
        return 0

    if command == "patch":
        if not options["rest"]:
            raise SystemExit("用法：patch 补丁.json")
        # 去 BOM：PowerShell 的 Set-Content -Encoding UTF8 会写，json.loads 会炸。
        raw = strip_bom(Path(options["rest"][0]).read_text(encoding="utf-8"))
        patch = json.loads(raw)
        if isinstance(patch.get("state"), dict):
            card.set_state(patch["state"])
        if patch.get("favor") is not None:
            text = str(patch["favor"])
            delta = int(text) if re.match(r"^[+-]\d+$", text) else int(text) - int(card.state.get("favor") or 0)
            card.bump_favor(delta)
        if patch.get("log"):
            card.append_log(patch["log"], bump_session=bool(patch.get("session")))
        card.save()
        show(card)
        return 0

    raise SystemExit("不认识的动作：%s（敲 --help 看用法）" % command)


def main():
    options = parse_argv(sys.argv[1:])
    try:
        return run(options)
    except SystemExit as error:
        if error.code:
            print(str(error), file=sys.stderr)
        return error.code or 0
    except (ValueError, json.JSONDecodeError, OSError) as error:
        print("%s: %s" % (type(error).__name__, error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
