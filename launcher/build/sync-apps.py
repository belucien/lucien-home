# Copies both apps' own screens into the launcher and plugs in the launcher's save bridge.
import pathlib, sys
SRC = {'planner': '/home/claude/Index.html', 'budget': '/home/claude/fortress/Index.html'}
OUT = pathlib.Path('/home/claude/launcher/app/apps')
for k, src in SRC.items():
    s = open(src, encoding='utf-8').read()
    assert s.count('<head>') == 1
    s = s.replace('<head>', '<head>\n<script src="../shim.js"></script>', 1)
    s = s.replace('<base target="_top">', '', 1)
    # inside Lucien Home the apps always use their dark look, to match the launcher
    import re
    s = re.sub(r'\(prefers-color-scheme:\s*dark\)', 'all', s)
    s = re.sub(r'\(prefers-color-scheme:\s*light\)', 'not all', s)
    s = s.replace('matchMedia("all")', 'matchMedia("(min-width:0px)")')
    s = s.replace('me=Brandon', 'me=yourname')
    d = OUT / k; d.mkdir(parents=True, exist_ok=True)
    (d / 'index.html').write_text(s, encoding='utf-8')
    print(k, len(s))
