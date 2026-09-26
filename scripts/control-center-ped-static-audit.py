#!/usr/bin/env python3
import json, pathlib, re, sys

ROOT=pathlib.Path(".")
CONTRACT=json.loads((ROOT/"contracts/control-center-ped-supreme.v1.json").read_text(encoding="utf-8"))
CSS=(ROOT/CONTRACT["css"]).read_text(encoding="utf-8")
FAIL=[]

def fail(code,detail=""): FAIL.append((code,detail))

if CONTRACT["profile"]!="UI_ENTERPRISE": fail("profile")
if CONTRACT["proof"]["falseGreen"]!=0: fail("false_green")
if CONTRACT["proof"]["regressionBudget"]!=0: fail("regression_budget")

# Every numeric px value in every geometry declaration, not only the first one.
geom=re.compile(r"(?:^|[;{\s])(gap|row-gap|column-gap|padding(?:-(?:top|right|bottom|left))?|margin(?:-(?:top|right|bottom|left))?|min-height|max-height|height|min-width|max-width|width|border-radius|outline-offset)\s*:\s*([^;}{]+)",re.I)
px=re.compile(r"(-?\d+(?:\.\d+)?)px\b",re.I)
micro=[]
for m in geom.finditer(CSS):
    prop=m.group(1).lower()
    for p in px.finditer(m.group(2)):
        v=abs(float(p.group(1)))
        if v==0: continue
        if abs(v/4-round(v/4))>1e-9:
            fail("geometry_not_4pt",f"{prop}:{p.group(0)}")
        elif abs(v/8-round(v/8))>1e-9:
            micro.append((prop,p.group(0)))

allowed_micro={"padding","padding-top","padding-right","padding-bottom","padding-left","margin","margin-top","margin-right","margin-bottom","margin-left","gap","row-gap","column-gap","width","height","outline-offset"}
for prop,val in micro:
    if prop not in allowed_micro:
        fail("microgrid_misuse",f"{prop}:{val}")

allowed_fonts=set(CONTRACT["typographyPx"])
for m in re.finditer(r"font-size\s*:\s*([^;}{]+)",CSS,re.I):
    expr=m.group(1)
    if re.search(r"(^|\s)0(?:\s|$)",expr):
        fail("font_zero",expr.strip())
    for p in px.finditer(expr):
        v=float(p.group(1))
        if v and v not in allowed_fonts:
            fail("font_scale",p.group(0))

# No raw HEX colors outside semantic custom-property declarations.
for n,line in enumerate(CSS.splitlines(),1):
    if re.search(r"#[0-9a-fA-F]{3,8}\b",line) and not re.search(r"--[\w-]+\s*:",line) and not line.lstrip().startswith(("/*","*","//")):
        fail("hardcoded_color",f"line:{n}")

# Required tokens in both explicit theme blocks.
dark_start=CSS.find(":root {")
light_start=CSS.find(':root[data-theme="light"]')
if dark_start<0 or light_start<0: fail("theme_blocks_missing")
dark=CSS[dark_start:light_start] if dark_start>=0 and light_start>=0 else ""
light_end=CSS.find("\n}",light_start)+2 if light_start>=0 else -1
light=CSS[light_start:light_end] if light_start>=0 and light_end>light_start else ""
for token in CONTRACT["requiredTokens"]:
    name="--"+token
    if name not in dark: fail("dark_token_missing",name)
    if name not in light: fail("light_token_missing",name)

for required,code in [
    (":focus-visible","focus_visible_missing"),
    ("prefers-reduced-motion","reduced_motion_missing"),
    ("overflow-wrap: anywhere","overflow_protection_missing"),
    ('[data-theme="light"]',"light_theme_missing"),
]:
    if required not in CSS: fail(code)

# Product information architecture must not silently disappear.
app=(ROOT/"src/App.tsx").read_text(encoding="utf-8")
commercial=(ROOT/"src/CommercialWorkspace.tsx").read_text(encoding="utf-8")
cfo=(ROOT/"src/CfoWorkspace.tsx").read_text(encoding="utf-8")
required_text=[
  "ZEVANORY CONTROL CENTER","Visão Geral","Produtos","Comercial","Criativos","Aprovações","Publicações",
  "Prospecção","CRM/Vendas","Atendimento","Financeiro","ZEVANORY CFO","Evidências",
  "Operações técnicas","ZEES-16 / Governança","ROBÔ COMERCIAL: ATIVO",
  "Leads encontrados hoje","Aguardando aprovação","Saldo consolidado","Projeção 30 dias"
]
blob="\n".join([app,commercial,cfo])
for item in required_text:
    if item not in blob: fail("content_integrity",item)

expected={(1920,1080),(1440,900),(768,1024),(375,812)}
actual={(x["width"],x["height"]) for x in CONTRACT["viewports"]}
if actual!=expected: fail("viewport_contract",str(sorted(actual)))

print("CONTROL_CENTER_PED_STATIC_AUDIT")
print("MICRO_GRID_VALUES="+str(len(micro)))
if FAIL:
    print("RESULT=FAIL")
    for code,detail in FAIL[:300]: print("FAIL",code,detail)
    sys.exit(1)
print("RESULT=PASS")
print("GEOMETRY_4PT=PASS")
print("TYPOGRAPHY_SCALE=PASS")
print("TOKEN_SYSTEM=PASS")
print("LIGHT_DARK=PASS")
print("CONTENT_INTEGRITY=PASS")
print("FALSE_GREEN=0")
print("REGRESSION_BUDGET=0")
