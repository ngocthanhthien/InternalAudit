"""Build the single-file app and the public directory; no third-party packages required."""
from pathlib import Path
import re
root=Path(__file__).parent
html=(root/'app-template.html').read_text(encoding='utf-8')
marker='/* CLOUD_MODULES */'
assert html.count(marker)==1
html=html.replace(marker,'\n'.join((root/f).read_text(encoding='utf-8') for f in ['sync-core.js','cloud-client.js','member-client.js']))
(root/'index.html').write_text(html,encoding='utf-8')
(root/'public').mkdir(exist_ok=True)
(root/'public'/'index.html').write_text(html,encoding='utf-8')
(root/'test-output').mkdir(exist_ok=True)
for i,js in enumerate(re.findall(r'<script[^>]*>(.*?)</script>',html,re.S)):
    (root/'test-output'/f'script-{i}.js').write_text(js,encoding='utf-8')
print('Built index.html and public/index.html.')
