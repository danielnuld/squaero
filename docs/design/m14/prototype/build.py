# Assembles redesign/bodies/*.body into project/*.dc.html with the shared head
# and theme helmet. Body format:
#   line 1: page <title>
#   then the markup that goes inside <x-dc> after the helmet
#   a line "---PROPS---", one line of data-props JSON
#   a line "---JS---", then the Component class source
# Usage: python build.py [Name ...]   (no args = every body)
import io, os, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
HELMET = io.open(os.path.join(HERE, 'theme-helmet.txt'), encoding='utf-8').read().rstrip('\n')
OUT = os.path.join(HERE, 'project')
os.makedirs(OUT, exist_ok=True)

names = sys.argv[1:] or [os.path.basename(p)[:-5] for p in glob.glob(os.path.join(HERE, 'bodies', '*.body'))]
for name in names:
    src = io.open(os.path.join(HERE, 'bodies', name + '.body'), encoding='utf-8').read()
    title, rest = src.split('\n', 1)
    markup, rest = rest.split('---PROPS---\n', 1)
    props, js = rest.split('---JS---\n', 1)
    page = f'''<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>{title.strip()}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
{HELMET}
{markup.rstrip()}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{props.strip()}'>
{js.rstrip()}
</script>
</body>
</html>
'''
    io.open(os.path.join(OUT, name + '.dc.html'), 'w', encoding='utf-8', newline='\n').write(page)
    print('built', name)
