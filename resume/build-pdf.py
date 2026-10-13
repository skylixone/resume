#!/usr/bin/env python3
"""Build Ivan_Korniienko_Resume_EN.pdf: visible resume + invisible ATS text layer on the last page.

Usage: python3 resume/build-pdf.py   (needs Google Chrome + PyMuPDF)
"""
import html, os, re, subprocess, tempfile
import fitz

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "resume-en.html")
OUT = os.path.join(os.path.dirname(HERE), "Ivan_Korniienko_Resume_EN.pdf")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

s = open(SRC, encoding="utf-8").read()

# 1) Visible-only render: hide the ATS blocks in print.
hide = ("<style>@media print{.ats-plaintext,.ats-keywords{display:none!important}"
        # research bullets pushed Education to a 3rd page; tighten bullet leading to keep 2
        ".exp-bullets li{line-height:1.6!important}.exp-context{line-height:1.5!important}}</style></head>")
tmp_html = os.path.join(HERE, "_pdf.html")  # same dir so styles.css / me.jpg resolve
vis = os.path.join(tempfile.gettempdir(), "resume-visible.pdf")
open(tmp_html, "w", encoding="utf-8").write(s.replace("</head>", hide, 1))
try:
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    "--virtual-time-budget=8000", f"--print-to-pdf={vis}", "file://" + tmp_html],
                   check=True, capture_output=True)
finally:
    os.remove(tmp_html)

# 2) ATS text, taken from the same HTML so it never drifts from the page.
def block(cls):
    m = re.search(r'<div class="%s"[^>]*>(.*?)</div>' % cls, s, re.S)
    return html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip()

kw = re.sub(r"\s+", " ", block("ats-keywords"))
ats = block("ats-plaintext") + "\n\nKEYWORDS\n" + kw

# 3) Invisible text layer (PDF render mode 3) on the last page: parsers read it, humans don't see it.
doc = fitz.open(vis)
page = doc[-1]
rect = fitz.Rect(30, 15, page.rect.width - 30, page.rect.height - 10)
size = 3.0
while page.insert_textbox(rect, ats, fontsize=size, fontname="helv", render_mode=3) < 0:
    size -= 0.2  # negative = overflow; nothing is written on failure, retry smaller
doc.set_metadata({"title": "Ivan Korniienko — Senior Product Designer",
                  "author": "Ivan Korniienko", "keywords": kw})
doc.save(OUT, garbage=3, deflate=True)
print(f"{OUT}  pages={len(doc)}  ats_font={size:.1f}pt")
