import re,sys
t=open(sys.argv[1]).read()
def parse(cls):
    m=re.search(r'\.th-'+cls+r'\{([^}]*)\}',t).group(1)
    return dict(re.findall(r'--([\w-]+):([^;]+)',m))
def rgb(s):
    s=s.strip()
    if s.startswith('#'): return tuple(int(s[i:i+2],16) for i in (1,3,5)),1
    v=[float(x) for x in re.findall(r'[\d.]+',s)]; return tuple(v[:3]),v[3]
def blend(fg,bg):
    c,a=rgb(fg) if isinstance(fg,str) else fg
    b=rgb(bg)[0] if isinstance(bg,str) else bg
    return tuple(c[i]*a+b[i]*(1-a) for i in range(3))
def L(c):
    f=lambda x:(x/255/12.92) if x/255<=0.03928 else ((x/255+0.055)/1.055)**2.4
    r,g,b=map(f,c); return 0.2126*r+0.7152*g+0.0722*b
def cr(a,b):
    la,lb=L(a),L(b); return (max(la,lb)+.05)/(min(la,lb)+.05)
for th in ['b','a','c','rosa']:
    v=parse(th); C=lambda k:rgb(v[k])[0]
    out=[]
    def p(name,fg,bg,thr):
        r=cr(fg,bg); out.append(f"{name}={r:.2f}{'' if r>=thr else ' FAIL'}")
    content=C('content'); chrome=C('chrome')
    for bgk in ['content','chrome','surface','overlay']:
        bg=C(bgk)
        p(f'text/{bgk}',C('text'),bg,4.5); p(f'dim/{bgk}',C('text-dim'),bg,4.5); p(f'faint/{bgk}',C('text-faint'),bg,4.5)
    p('accent-fg/accent',C('accent-fg'),C('accent'),4.5)
    p('accent-text/content',C('accent-text'),content,4.5)
    p('accent-text/accent-soft',C('accent-text'),blend(v['accent-soft'],content),4.5)
    p('accent-text/sel',C('accent-text'),blend(v['sel'],content),4.5)
    p('text/sel',C('text'),blend(v['sel'],content),4.5)
    p('danger-fg/danger',C('danger-fg'),C('danger'),4.5)
    p('danger/content',C('danger'),content,4.5)
    p('warn/content',C('warn'),content,4.5); p('warn/warn-soft',C('warn'),blend(v['warn-soft'],content),4.5)
    p('ok/content',C('ok'),content,4.5)
    p('null/content',C('null'),content,4.5)
    p('syntax-comment/content',C('syntax-comment'),content,4.5)
    p('border-strong/content (input 3:1)',C('border-strong'),content,3)
    p('border/content',C('border'),content,3)
    p('accent/content (focus ring 3:1)',C('accent'),content,3)
    p('accent-soft ring/content',blend(v['accent-soft'],content),content,3)
    p('accent/chrome',C('accent'),chrome,3)
    print(th); [print('  ',o) for o in out]
