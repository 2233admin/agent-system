import json, random

random.seed(42)

elements = []
_id_counter = [0]

DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
LETTERS = "abcdefghijklmnopqrstuvwxyz"

def next_index():
    n = _id_counter[0]
    _id_counter[0] += 1
    leading = LETTERS[n // len(DIGITS)]
    trailing = DIGITS[n % len(DIGITS)]
    idx = leading + trailing
    assert len(idx) == 2, idx
    return idx

_uid = [0]
def next_id(prefix):
    _uid[0] += 1
    return f"{prefix}{_uid[0]}"

def base_props():
    return dict(
        angle=0,
        strokeWidth=1,
        strokeStyle="solid",
        roughness=1,
        opacity=100,
        groupIds=[],
        frameId=None,
        roundness=None,
        seed=random.randint(1, 2**31 - 1),
        version=1,
        versionNonce=random.randint(1, 2**31 - 1),
        isDeleted=False,
        boundElements=None,
        updated=1755820800000,
        link=None,
        locked=False,
    )

def rect(x, y, w, h, stroke="#1e1e1e", bg="transparent", fill="solid", strokeStyle="solid", strokeWidth=1):
    e = base_props()
    e.update(
        id=next_id("rect"),
        type="rectangle",
        x=x, y=y, width=w, height=h,
        strokeColor=stroke,
        backgroundColor=bg,
        fillStyle=fill,
        strokeStyle=strokeStyle,
        strokeWidth=strokeWidth,
        index=next_index(),
    )
    elements.append(e)
    return e

def line(x, y, w, h, points, stroke="#1e1e1e", strokeStyle="solid", strokeWidth=1):
    e = base_props()
    e.update(
        id=next_id("line"),
        type="line",
        x=x, y=y, width=w, height=h,
        strokeColor=stroke,
        backgroundColor="transparent",
        fillStyle="solid",
        strokeStyle=strokeStyle,
        strokeWidth=strokeWidth,
        points=points,
        lastCommittedPoint=None,
        startBinding=None,
        endBinding=None,
        startArrowhead=None,
        endArrowhead=None,
        index=next_index(),
    )
    elements.append(e)
    return e

def text(x, y, s, size=16, color="#1e1e1e", align="left", width=None, font=1, italic_hint=False):
    lines = s.split("\n")
    line_h = size * 1.25
    w = width if width is not None else max(len(l) for l in lines) * size * 0.6
    h = line_h * len(lines)
    e = base_props()
    e.update(
        id=next_id("text"),
        type="text",
        x=x, y=y, width=w, height=h,
        strokeColor=color,
        backgroundColor="transparent",
        fillStyle="solid",
        strokeWidth=1,
        text=s,
        fontSize=size,
        fontFamily=font,
        textAlign=align,
        verticalAlign="top",
        baseline=size,
        containerId=None,
        originalText=s,
        lineHeight=1.25,
        index=next_index(),
    )
    elements.append(e)
    return e

def arrow(x, y, w, h, points, stroke="#1e1e1e", strokeWidth=2, strokeStyle="solid", start_id=None, end_id=None):
    e = base_props()
    e.update(
        id=next_id("arrow"),
        type="arrow",
        x=x, y=y, width=w, height=h,
        strokeColor=stroke,
        backgroundColor="transparent",
        fillStyle="solid",
        strokeStyle=strokeStyle,
        strokeWidth=strokeWidth,
        points=points,
        lastCommittedPoint=None,
        startBinding={"elementId": start_id, "focus": 0, "gap": 4} if start_id else None,
        endBinding={"elementId": end_id, "focus": 0, "gap": 4} if end_id else None,
        startArrowhead=None,
        endArrowhead="triangle",
        index=next_index(),
    )
    elements.append(e)
    return e

BLACK = "#1e1e1e"
GRAY = "#868e96"
RED = "#e03131"
GREEN = "#2f9e44"
ORANGE = "#e8590c"

# ---------------------------------------------------------------
# SCREEN 1: Browse list  (x=0..700, y=100..550)
# ---------------------------------------------------------------
S1_X, S1_Y, S1_W, S1_H = 0, 100, 700, 450
s1_rect = rect(S1_X, S1_Y, S1_W, S1_H, stroke=BLACK, bg="transparent", strokeWidth=2)
text(S1_X + 10, S1_Y - 30, "SCREEN 1 — Browse list  (replaces: configs list)", size=16, color=BLACK)
text(S1_X + 20, S1_Y + 20, "configs", size=20, color=BLACK)
line(S1_X + 20, S1_Y + 55, 660, 0, [[0, 0], [660, 0]], stroke=BLACK)

# row 1
rect(S1_X + 20, S1_Y + 75, 660, 55, stroke=BLACK, bg="transparent")
text(S1_X + 35, S1_Y + 92, "general", size=16, color=BLACK)
text(S1_X + 300, S1_Y + 92, "rev 3   active", size=14, color=GRAY)

# row 2 - selected/highlighted (inverted)
rect(S1_X + 20, S1_Y + 140, 660, 55, stroke=BLACK, bg="#1e1e1e", fill="solid")
text(S1_X + 35, S1_Y + 157, "> agent-assembler", size=16, color="#ffffff")
text(S1_X + 340, S1_Y + 157, "rev 7   active", size=14, color="#f1f3f5")

# row 3
rect(S1_X + 20, S1_Y + 205, 660, 55, stroke=BLACK, bg="transparent")
text(S1_X + 35, S1_Y + 222, "research-v3", size=16, color=BLACK)
text(S1_X + 300, S1_Y + 222, "rev 2   idle", size=14, color=GRAY)

line(S1_X + 20, S1_Y + 390, 660, 0, [[0, 0], [660, 0]], stroke=BLACK)
text(S1_X + 20, S1_Y + 405, "\u2191\u2193 select \u00b7 enter view \u00b7 u use \u00b7 q quit", size=14, color=BLACK)

# ---------------------------------------------------------------
# SCREEN 2: Detail panel (x=900..1600, y=100..550)
# ---------------------------------------------------------------
S2_X, S2_Y, S2_W, S2_H = 900, 100, 700, 450
s2_rect = rect(S2_X, S2_Y, S2_W, S2_H, stroke=BLACK, bg="transparent", strokeWidth=2)
text(S2_X + 10, S2_Y - 30, "SCREEN 2 — Detail panel  (replaces: configs show <id>)", size=16, color=BLACK)
text(S2_X + 20, S2_Y + 20, "agent-assembler", size=20, color=BLACK)
text(S2_X + 20, S2_Y + 50, "revision: 7          status: active", size=14, color=BLACK)
text(S2_X + 20, S2_Y + 72, "boundary: workspace:/agents/assembler", size=14, color=BLACK)
line(S2_X + 20, S2_Y + 100, 660, 0, [[0, 0], [660, 0]], stroke=BLACK)

cap_y = S2_Y + 115
caps = [
    ("Instructions (3)", "- system, planning, safety"),
    ("Skills (5)", "- bmad-build, code-review, ..."),
    ("MCP (2)", "- filesystem, github"),
    ("Hooks (1)", "- pre-commit-lint"),
    ("Plugins (0)", "- (none)"),
]
for label, sample in caps:
    text(S2_X + 20, cap_y, label, size=15, color=BLACK)
    text(S2_X + 40, cap_y + 20, sample, size=13, color=GRAY)
    cap_y += 48

line(S2_X + 20, S2_Y + 390, 660, 0, [[0, 0], [660, 0]], stroke=BLACK)
text(S2_X + 20, S2_Y + 405, "u use this config \u00b7 esc back \u00b7 q quit", size=14, color=BLACK)

# ---------------------------------------------------------------
# SCREEN 3: Confirm & launch (x=1800..2500, y=100..550)
# ---------------------------------------------------------------
S3_X, S3_Y, S3_W, S3_H = 1800, 100, 700, 450
s3_rect = rect(S3_X, S3_Y, S3_W, S3_H, stroke=BLACK, bg="transparent", strokeWidth=2)
text(S3_X + 10, S3_Y - 30, "SCREEN 3 — Confirm & launch  (replaces existing one-time confirm before use/switch)", size=16, color=BLACK)

# climax annotation, above screen 3, in red
text(S3_X - 40, S3_Y - 95, "\u2605 the one and only confirmation \u2014 architecture invariant,\n   cannot be duplicated or skipped", size=15, color=RED, width=760)

text(S3_X + 20, S3_Y + 20, "Confirm launch", size=20, color=BLACK)
text(S3_X + 20, S3_Y + 55, "config: agent-assembler  (rev 7)", size=14, color=BLACK)
text(S3_X + 20, S3_Y + 76, "client: omp             client version: 1.4.2", size=14, color=BLACK)
line(S3_X + 20, S3_Y + 100, 660, 0, [[0, 0], [660, 0]], stroke=BLACK)

text(S3_X + 20, S3_Y + 112, "capability groups requested:", size=14, color=BLACK)
text(S3_X + 40, S3_Y + 134, "Instructions, Skills, MCP, Hooks", size=13, color=GRAY)

text(S3_X + 20, S3_Y + 165, "known differences:", size=14, color=BLACK)
text(S3_X + 40, S3_Y + 187, "- none detected", size=13, color=GRAY)

line(S3_X + 20, S3_Y + 230, 660, 0, [[0, 0], [660, 0]], stroke=BLACK)

# yes/no gate box
rect(S3_X + 20, S3_Y + 250, 660, 60, stroke=BLACK, bg="transparent", strokeWidth=2)
text(S3_X + 40, S3_Y + 270, "Proceed with launch?  [y/N]", size=16, color=BLACK)

line(S3_X + 20, S3_Y + 390, 660, 0, [[0, 0], [660, 0]], stroke=BLACK)
text(S3_X + 20, S3_Y + 405, "y confirm \u00b7 n / esc decline \u00b7 q quit", size=14, color=BLACK)

# ---------------------------------------------------------------
# Post-confirm sequence: 2 small dashed boxes, NOT TUI screens
# ---------------------------------------------------------------
text(2700, 60, "(not a TUI screen \u2014 configs hands off control)", size=14, color=GRAY)

BOXA_X, BOXA_Y, BOXA_W, BOXA_H = 2700, 130, 340, 190
boxA = rect(BOXA_X, BOXA_Y, BOXA_W, BOXA_H, stroke=GRAY, bg="transparent", strokeStyle="dashed", strokeWidth=2)
text(BOXA_X + 15, BOXA_Y + 15,
     "\u238b terminal handed to omp\n(stdio inherit)\n\nink's alt-screen is suspended \u2014\nTUI renders nothing",
     size=14, color=BLACK, width=310)

BOXB_X, BOXB_Y, BOXB_W, BOXB_H = 3100, 100, 380, 260
boxB = rect(BOXB_X, BOXB_Y, BOXB_W, BOXB_H, stroke=GRAY, bg="transparent", strokeStyle="dashed", strokeWidth=2)
text(BOXB_X + 15, BOXB_Y + 15,
     "omp exits \u2192 configs prints final\nstatus as plain text\n(same renderLaunchStatus the\nexisting CLI already uses:\nphase / apply-result /\nknown-differences)\n\n\u2192 configs process exits entirely,\ncontrol returns to the user's\nreal shell prompt",
     size=13, color=BLACK, width=350)

text(BOXB_X + 15, BOXB_Y + BOXB_H + 12, "END \u2014 no return to TUI", size=15, color=RED)
text(BOXB_X - 20, BOXB_Y + BOXB_H + 40,
     "one-shot: launching exits the whole program, doesn't loop\n(no arrow leads back to Screen 1 from here \u2014 deliberate)",
     size=13, color=GRAY, width=420)

# ---------------------------------------------------------------
# Arrows
# ---------------------------------------------------------------

# Screen1 -> Screen2 : enter (view details)
arrow(S1_X + S1_W, S1_Y + 150, S2_X - (S1_X + S1_W), 0,
      [[0, 0], [S2_X - (S1_X + S1_W), 0]], stroke=BLACK, strokeWidth=2,
      start_id=s1_rect["id"], end_id=s2_rect["id"])
text(S1_X + S1_W + 30, S1_Y + 120, "enter (view details)", size=13, color=BLACK)

# Screen2 -> Screen1 : esc
arrow(S2_X, S2_Y + 210, -(S2_X - (S1_X + S1_W)), 0,
      [[0, 0], [-(S2_X - (S1_X + S1_W)), 0]], stroke=BLACK, strokeWidth=2,
      start_id=s2_rect["id"], end_id=s1_rect["id"])
text(S1_X + S1_W + 90, S2_Y + 185, "esc", size=13, color=BLACK)

# Screen1 -> Screen3 : u (use)   -- routed below screens
p1x, p1y = S1_X + 350, S1_Y + S1_H
p2x, p2y = p1x, 640
p3x, p3y = S3_X + 250, 640
p4x, p4y = S3_X + 250, S3_Y + S3_H
arrow(p1x, p1y, p4x - p1x, p4y - p1y,
      [[0, 0], [0, p2y - p1y], [p3x - p1x, p2y - p1y], [p4x - p1x, p4y - p1y]],
      stroke=BLACK, strokeWidth=2, start_id=s1_rect["id"], end_id=s3_rect["id"])
text(900, 655, "u (use)", size=13, color=BLACK)

# Screen2 -> Screen3 : u (use this config)
arrow(S2_X + S2_W, S2_Y + 250, S3_X - (S2_X + S2_W), 0,
      [[0, 0], [S3_X - (S2_X + S2_W), 0]], stroke=BLACK, strokeWidth=2,
      start_id=s2_rect["id"], end_id=s3_rect["id"])
text(S2_X + S2_W + 15, S2_Y + 220, "u (use this\nconfig)", size=13, color=BLACK)

# Screen3 -> Screen1 : decline loop (ONLY loop in the diagram) - orange, routed further below
d1x, d1y = S3_X + 450, S3_Y + S3_H
d2x, d2y = d1x, 720
d3x, d3y = S1_X + 500, 720
d4x, d4y = S1_X + 500, S1_Y + S1_H
arrow(d1x, d1y, d4x - d1x, d4y - d1y,
      [[0, 0], [0, d2y - d1y], [d3x - d1x, d2y - d1y], [d4x - d1x, d4y - d1y]],
      stroke=ORANGE, strokeWidth=2, start_id=s3_rect["id"], end_id=s1_rect["id"])
text(1000, 735, "n / esc (decline) \u2192 cancelled, stay in TUI, back to list", size=13, color=ORANGE, width=800)

# Screen3 -> BoxA : confirm path (green)
arrow(S3_X + S3_W, S3_Y + 280, BOXA_X - (S3_X + S3_W), (BOXA_Y + 50) - (S3_Y + 280),
      [[0, 0], [BOXA_X - (S3_X + S3_W), (BOXA_Y + 50) - (S3_Y + 280)]],
      stroke=GREEN, strokeWidth=3, start_id=s3_rect["id"], end_id=boxA["id"])
text(S3_X + S3_W + 20, S3_Y + 235, "y (confirm)", size=14, color=GREEN)

# BoxA -> BoxB
arrow(BOXA_X + BOXA_W, BOXA_Y + BOXA_H / 2, BOXB_X - (BOXA_X + BOXA_W), (BOXB_Y + BOXB_H / 2) - (BOXA_Y + BOXA_H / 2),
      [[0, 0], [BOXB_X - (BOXA_X + BOXA_W), (BOXB_Y + BOXB_H / 2) - (BOXA_Y + BOXA_H / 2)]],
      stroke=GRAY, strokeWidth=2, start_id=boxA["id"], end_id=boxB["id"])

# ---------------------------------------------------------------
# Verify indices
# ---------------------------------------------------------------
for el in elements:
    assert isinstance(el["index"], str) and len(el["index"]) == 2, (el["id"], el["index"])

seen = set()
for el in elements:
    assert el["index"] not in seen, f"duplicate index {el['index']}"
    seen.add(el["index"])

doc = {
    "type": "excalidraw",
    "version": 2,
    "source": "https://excalidraw.com",
    "elements": elements,
    "appState": {"gridSize": None, "viewBackgroundColor": "#ffffff"},
    "files": {},
}

out_path = r"C:\Workspace\worktrees\agent-system\cli-redesign\_bmad-output\planning-artifacts\ux-designs\ux-agent-system-2026-08-22\.working\flow-tui-2026-08-22-v2.excalidraw"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False, indent=0)

print("elements:", len(elements))
print("all indices exactly 2 chars: VERIFIED programmatically (assert loop above passed)")
print("written to:", out_path)
