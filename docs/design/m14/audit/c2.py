import re,sys
sys.argv=['x','../redesign/theme-helmet.txt']; exec(open('contrast.py').read().split("for th in")[0])
for th in ['b','a','c','rosa']:
    v=parse(th); C=lambda k:rgb(v[k])[0]
    ch=C('chrome'); ch2=C('chrome-2'); su=C('surface'); co=C('content')
    r=[]
    r.append(('accent-text/sel@chrome (árbol)',cr(C('accent-text'),blend(v['sel'],ch))))
    r.append(('dim/chrome-2 (tarjeta conexión)',cr(C('text-dim'),ch2)))
    r.append(('danger/danger-soft@chrome (chip Solo lectura)',cr(C('danger'),blend(v['danger-soft'],ch))))
    r.append(('warn/warn-soft@chrome (chip TX statusbar)',cr(C('warn'),blend(v['warn-soft'],ch))))
    r.append(('ok/ok-soft@content (chip)',cr(C('ok'),blend(v['ok-soft'],co))))
    r.append(('accent-text/accent-soft@content',cr(C('accent-text'),blend(v['accent-soft'],co))))
    for k in ['type-dot-num','type-dot-text','type-dot-date','type-dot-bool']:
        r.append((k+'/surface (3:1)',cr(C(k),su)))
    r.append(('syntax-keyword/content',cr(C('syntax-keyword'),co)))
    r.append(('syntax-string/content',cr(C('syntax-string'),co)))
    r.append(('syntax-number/content',cr(C('syntax-number'),co)))
    r.append(('text/warn-soft@content (celda editada)',cr(C('text'),blend(v['warn-soft'],co))))
    r.append(('text-dim/danger-soft (fila eliminada)',cr(C('text-dim'),blend(v['danger-soft'],co))))
    r.append(('border-strong/chrome (campo filtro explorador)',cr(C('border-strong'),ch)))
    print(th); [print('   %-48s %.2f'%x) for x in r]
