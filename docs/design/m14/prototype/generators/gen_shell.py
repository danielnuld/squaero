# Expands shell_tpl/<Name>.tpl into bodies/<Name>.body.
# Macro: [[icon]] / [[icon:size]] / [[icon:size:inline-style]] -> inline SVG from icons.md
# Usage: python gen_shell.py [Name ...]   (no args = every template)
import io, os, re, sys, glob
HERE = os.path.dirname(os.path.abspath(__file__))
ICONS = {}
for line in io.open(os.path.join(HERE, 'icons.md'), encoding='utf-8'):
    m = re.match(r'- ([\w-]+)[^:]*: `(.*)`', line.strip())
    if m: ICONS[m.group(1)] = m.group(2)
ICONS['shield'] = '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"></path>'
ICONS['unplug'] = '<path d="M12 3 4 13h16z"></path><path d="M4 18h16"></path>'
ICONS['wifi-off'] = '<path d="M2 8.8a15 15 0 0 1 4.2-2.6"></path><path d="M10 5.1A15 15 0 0 1 22 8.8"></path><path d="M5 12.9a10 10 0 0 1 3.9-2.3"></path><path d="M15.4 11a10 10 0 0 1 3.6 1.9"></path><path d="M8.5 16.4a5 5 0 0 1 7 0"></path><path d="M12 20h.01"></path><path d="m2 2 20 20"></path>'
ICONS['code'] = '<path d="m8 8-4 4 4 4"></path><path d="m16 8 4 4-4 4"></path>'
ICONS['eraser'] = '<path d="m7 21-4-4 11-11 7 7-7 8z"></path><path d="M22 21H7"></path>'
ICONS['dup'] = ICONS['copy']
def svg(m):
    name, size, style = (m.group(1).split(':', 2) + ['', ''])[:3]
    size = size or '15'
    st = f' style="{style}"' if style else ''
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"{st}>{ICONS[name]}</svg>')
names = sys.argv[1:] or [os.path.basename(p)[:-4] for p in glob.glob(os.path.join(HERE, 'shell_tpl', '*.tpl'))]
for n in names:
    src = io.open(os.path.join(HERE, 'shell_tpl', n + '.tpl'), encoding='utf-8').read()
    # [[@part]] includes shell_tpl/_part.inc
    src = re.sub(r'\[\[@([\w-]+)\]\]', lambda m: io.open(os.path.join(HERE, 'shell_tpl', '_' + m.group(1) + '.inc'), encoding='utf-8').read().rstrip('\n'), src)
    out = re.sub(r'\[\[([\w-]+(?::[^\]]*)?)\]\]', svg, src)
    io.open(os.path.join(HERE, 'bodies', n + '.body'), 'w', encoding='utf-8', newline='\n').write(out)
    print('generated', n)
