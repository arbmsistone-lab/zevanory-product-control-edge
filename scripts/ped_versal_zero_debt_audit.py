#!/usr/bin/env python3
import pathlib, re, sys, json

ROOT=pathlib.Path(".")
ALLOWED_FONT={12,14,16,21,28,37}
GEOM_PROPS=re.compile(r"(?:^|[;{\s])(gap|row-gap|column-gap|padding(?:-(?:top|right|bottom|left))?|margin(?:-(?:top|right|bottom|left))?|min-height|max-height|height|min-width|max-width|width|border-radius|outline-offset)\s*:\s*([^;}{]+)",re.I)
PX=re.compile(r"(-?\d+(?:\.\d+)?)px\b",re.I)
FONT=re.compile(r"font-size\s*:\s*([^;}{]+)",re.I)
HEX=re.compile(r"#[0-9a-fA-F]{3,8}\b")
FUNC_COLOR=re.compile(r"\b(?:rgb|rgba|hsl|hsla)\([^)]*\)",re.I)
DECL=re.compile(r"([\w-]+)\s*:\s*([^;}{]+)")
REQUIRED_TOKENS=[
"--bg-primary","--bg-secondary","--surface","--surface-elevated","--text-primary","--text-secondary",
"--border","--action-primary","--action-primary-text","--status-success","--status-error","--status-warning",
"--status-info","--focus-ring"
]
FAIL=[]

def fail(code,path,detail):
    FAIL.append({"code":code,"path":str(path),"detail":detail})

css_files=[p for p in ROOT.glob("src/**/*.css") if p.is_file()]
ui_files=[p for ext in ("*.tsx","*.jsx","*.html") for p in ROOT.glob("src/**/"+ext) if p.is_file()]

if not css_files:
    fail("NO_CSS","src","No CSS files found")

all_css=""
for path in css_files:
    text=path.read_text(encoding="utf-8",errors="ignore")
    all_css+="\n"+text
    for m in GEOM_PROPS.finditer(text):
        prop,expr=m.group(1).lower(),m.group(2)
        for p in PX.finditer(expr):
            v=abs(float(p.group(1)))
            if v and abs(v/4-round(v/4))>1e-9:
                fail("GEOMETRY_NOT_4PT",path,f"{prop}:{p.group(0)} in {expr.strip()}")
    for m in FONT.finditer(text):
        for p in PX.finditer(m.group(1)):
            v=float(p.group(1))
            if v and v not in ALLOWED_FONT:
                fail("FONT_SCALE",path,p.group(0))
    for ln,line in enumerate(text.splitlines(),1):
        is_custom=bool(re.search(r"--[\w-]+\s*:",line))
        if not is_custom:
            for h in HEX.findall(line):
                fail("HARDCODED_HEX",path,f"line {ln}: {h}")
            for c in FUNC_COLOR.findall(line):
                fail("HARDCODED_COLOR_FN",path,f"line {ln}: {c}")
    # Check every individual multi-value geometry token, not just first declaration number.
    for m in DECL.finditer(text):
        prop=m.group(1).lower()
        if prop in {"padding","margin","gap","row-gap","column-gap","border-radius"}:
            vals=PX.findall(m.group(2))
            for raw in vals:
                v=abs(float(raw))
                if v and abs(v/4-round(v/4))>1e-9:
                    fail("MULTIVALUE_GEOMETRY",path,f"{prop}:{raw}px")

for token in REQUIRED_TOKENS:
    if token not in all_css: fail("MISSING_TOKEN","src/index.css",token)

# Pseudo selectors must never be separated by whitespace.
for path in css_files:
    text=path.read_text(encoding="utf-8",errors="ignore")
    for m in re.finditer(r":\s+(disabled|hover|active|focus-visible|focus|first-child|last-child|checked|before|after)\b",text,re.I):
        fail("BROKEN_PSEUDO_SELECTOR",path,m.group(0))

for needle,code in [
    (":focus-visible","MISSING_FOCUS_VISIBLE"),
    (":hover","MISSING_HOVER"),
    (":active","MISSING_ACTIVE"),
    ("prefers-reduced-motion","MISSING_REDUCED_MOTION"),
]:
    if needle not in all_css: fail(code,"src/index.css",needle)

# Focus must be strongly visible.
focus_blocks=re.findall(r"[^{}]*:focus-visible[^{}]*\{([^}]*)\}",all_css,re.S)
if not focus_blocks: fail("FOCUS_CONTRACT","src/index.css","no focus-visible block")
elif not any(re.search(r"outline\s*:\s*(?:4|[5-9]|\d{2,})px",b,re.I) or re.search(r"box-shadow\s*:",b,re.I) for b in focus_blocks):
    fail("FOCUS_CONTRACT","src/index.css","focus indicator below 4px / no halo")

# Both theme blocks are mandatory.
if ":root[data-theme='dark']" not in all_css: fail("DARK_THEME","src/index.css","missing explicit dark theme")
if ":root[data-theme='light']" not in all_css: fail("LIGHT_THEME","src/index.css","missing explicit light theme")

# Scan inline styling in UI source for raw CSS debt.
for path in ui_files:
    text=path.read_text(encoding="utf-8",errors="ignore")
    for ln,line in enumerate(text.splitlines(),1):
        if "style=" in line or "style={{" in line:
            for h in HEX.findall(line): fail("INLINE_HEX",path,f"line {ln}: {h}")
            for c in FUNC_COLOR.findall(line): fail("INLINE_COLOR_FN",path,f"line {ln}: {c}")
            for p in PX.findall(line):
                v=abs(float(p))
                if v and abs(v/4-round(v/4))>1e-9:
                    fail("INLINE_GEOMETRY",path,f"line {ln}: {p}px")

summary={
  "css_files":len(css_files),
  "ui_files":len(ui_files),
  "failures":len(FAIL),
  "by_code":{}
}
for f in FAIL: summary["by_code"][f["code"]]=summary["by_code"].get(f["code"],0)+1
print("CONTROL_CENTER_PED_ZERO_DEBT_AUDIT")
print(json.dumps(summary,sort_keys=True))
if FAIL:
    for f in FAIL[:200]: print("FAIL",json.dumps(f,ensure_ascii=False))
    sys.exit(1)
print("RESULT=PASS")
print("FALSE_GREEN=0")
print("REGRESSION_BUDGET=0")
print("ZERO_DEBT=PASS")
