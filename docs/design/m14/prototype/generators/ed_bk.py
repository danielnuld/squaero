import os, re
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'redesign'))
def ed(p,pairs,out=None):
    s=open(p,encoding='utf8').read()
    for a,b in pairs:
        if a not in s: print('MISS',p,a[:80]); continue
        s=s.replace(a,b)
    open(out or p,'w',encoding='utf8',newline='\n').write(s)
    return s

ed('bodies/BackupRestore.body',[
 ('<span class="seg" role="tablist" aria-label="Operación">','<span class="seg" role="tablist" aria-label="Operación">'),
 ('<span role="tab" aria-selected="true" class="on" style="gap: 6px">','<span role="tab" aria-selected="true" tabindex="0" class="on" style="gap: 6px">'),
 ('<span role="tab" aria-selected="false" style="gap: 6px">','<span role="tab" aria-selected="false" tabindex="-1" style="gap: 6px">'),
 ('<span style="font-size: var(--fs-sm); color: var(--text-dim)">Para respaldar otra base, cámbiala en el explorador.</span>','<span class="help">Para respaldar otra base, cámbiala en el explorador.</span>'),
 ('<span style="font-size: var(--fs-sm); color: var(--text-faint)">CREATE TABLE, vistas, índices y triggers</span>','<span class="help">CREATE TABLE, vistas, índices y triggers</span>'),
 ('<span style="font-size: var(--fs-sm); color: var(--text-faint)">una sentencia INSERT por fila</span>','<span class="help">una sentencia INSERT por fila</span>'),
 ('<a href="#" style="text-decoration: none">Ninguno</a>','<button type="button" style="min-height: 24px; padding: 0; border: 0; background: none; color: var(--accent-text); font-size: var(--fs-sm)">Ninguno</button>'),
 ('<span class="num" style="font-size: var(--fs-xs); color: var(--text-faint)">{{o.sub}}</span>','<span class="num" style="font-size: var(--fs-xs); color: var(--text-dim)">{{o.sub}}</span>'),
 ('<span style="color: var(--text-faint); line-height: 1.45">El archivo se puede restaurar desde la pestaña Restaurar o con cualquier cliente SQL.</span>','<span class="help" style="line-height: 1.45">El archivo se puede restaurar desde la pestaña Restaurar (pide confirmación con la conexión y la base de destino) o con cualquier cliente SQL.</span>'),
 ('<span class="btn" aria-disabled="true" style="opacity: .45">Atrás</span>','<button type="button" class="btn" disabled="disabled" aria-disabled="true" style="opacity: .45">Atrás</button>'),
 ('<button type="button" class="btn btn-primary">Siguiente','<a href="BackupProgress.dc.html" class="btn btn-primary">Siguiente'),
 ('<path d="m9 6 6 6-6 6"></path></svg></button>\n        <a href="DataGrid.dc.html" class="btn">Cancelar</a>','<path d="m9 6 6 6-6 6"></path></svg></a>\n        <a href="DataGrid.dc.html" class="btn">Cancelar</a>'),
 ("tabs: [{ label: 'Consulta 1', kind: 'query', href: 'EditorResult.dc.html' }, { label: 'Respaldo', kind: 'tool', active: true, href: 'BackupRestore.dc.html' }]","tabs: [{ label: 'Consulta 1', kind: 'query', href: 'EditorResult.dc.html', color: '#2f7dd6' }, { label: 'Respaldo · main', kind: 'tool', active: true, href: 'BackupRestore.dc.html', color: '#2f7dd6' }]"),
 ('<dc-import name="StatusBar" theme="{{theme}}" conn="Ventas" db="main" info="Respaldo · 5 objetos seleccionados"','<dc-import name="StatusBar" theme="{{theme}}" conn="Ventas" db="main" color="#2f7dd6" info="Respaldo · 5 objetos seleccionados · 48 filas"'),
])

# BackupProgress: same document, step 3 running with determinate progress + Cancelar
s=open('bodies/BackupRestore.body',encoding='utf8').read()
s=s.replace('Respaldo y restauración\n','Respaldando\n',1)
s=s.replace('window-title="Respaldo — Ventas — Squaero"','window-title="Respaldando (62 %) — Ventas — Squaero"')
# operation tabs disabled while running
s=s.replace('<span role="tab" aria-selected="false" tabindex="-1" style="gap: 6px">','<span role="tab" aria-selected="false" aria-disabled="true" tabindex="-1" title="Disponible al terminar el respaldo" style="gap: 6px; opacity: .55">')
DONE='<span style="display: flex; align-items: center; gap: 8px; color: var(--text-dim)"><span style="width: 22px; height: 22px; border-radius: 50%; background: var(--accent-soft); color: var(--accent-text); display: flex; align-items: center; justify-content: center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg></span>{}</span>'
nav_start=s.index('<nav aria-label="Pasos"'); nav_end=s.index('</nav>',nav_start)+6
CH='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color: var(--text-dim)"><path d="m9 6 6 6-6 6"></path></svg>'
nav=('<nav aria-label="Pasos" style="height: 48px; flex: none; display: flex; align-items: center; gap: 10px; padding: 0 24px; border-bottom: 1px solid var(--border); background: var(--surface); font-size: var(--fs-md)">\n        '
 + DONE.format('Qué respaldar') + CH + DONE.format('Destino') + CH
 + '<span style="display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--accent-text)" aria-current="step"><span style="width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: var(--accent-fg); display: flex; align-items: center; justify-content: center; font-size: var(--fs-xs)">3</span>Respaldando</span>\n      </nav>')
s=s[:nav_start]+nav+s[nav_end:]
body_start=s.index('<div style="flex: 1; min-height: 0; display: flex; gap: 32px; padding: 24px; overflow: hidden">')
foot_start=s.index('<div style="height: 52px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 20px; border-top: 1px solid var(--border); background: var(--surface)">')
BODY='''<div style="flex: 1; min-height: 0; display: flex; gap: 32px; padding: 24px; overflow: hidden">
        <section aria-label="Progreso del respaldo" style="flex: 1; min-width: 0; max-width: 620px; display: flex; flex-direction: column; gap: 18px">
          <div style="display: flex; flex-direction: column; gap: 8px">
            <div style="display: flex; align-items: baseline; gap: 10px">
              <span style="font-size: var(--fs-lg); font-weight: 600">Respaldando main en ventas_2026-10-18_1432.sql</span>
              <span style="flex: 1"></span>
              <span class="num" style="font-size: var(--fs-lg); font-weight: 600">62 %</span>
            </div>
            <div role="progressbar" aria-label="Progreso del respaldo" aria-valuemin="0" aria-valuemax="48" aria-valuenow="30" aria-valuetext="30 de 48 filas, objeto 3 de 5" style="height: 8px; border-radius: 4px; background: var(--border); overflow: hidden"><span style="display: block; width: 62%; height: 100%; background: var(--accent); border-radius: 4px"></span></div>
            <div role="status" class="num" style="display: flex; gap: 8px; font-size: var(--fs-sm); color: var(--text-dim)"><span>Objeto 3 de 5 · pedidos</span><span>·</span><span>30 de 48 filas</span><span>·</span><span>00:02 transcurridos</span><span>·</span><span>quedan unos 2 s</span></div>
          </div>
          <div style="border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden">
            <sc-for list="{{steps}}" as="o" hint-placeholder-count="5">
              <div style="{{o.row}}">
                <span style="{{o.icon}}">
                  <sc-if value="{{o.done}}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Terminado"><path d="M20 6 9 17l-5-5"></path></svg></sc-if>
                  <sc-if value="{{o.run}}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" role="img" aria-label="En curso"><path d="M21 12a9 9 0 1 1-9-9"></path></svg></sc-if>
                  <sc-if value="{{o.wait}}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" role="img" aria-label="Pendiente"><circle cx="12" cy="12" r="8"></circle></svg></sc-if>
                </span>
                <span style="{{o.nameStyle}}">{{o.name}}</span>
                <span class="num" style="font-size: var(--fs-sm); color: var(--text-dim)">{{o.sub}}</span>
              </div>
            </sc-for>
          </div>
          <span class="help">Puedes seguir trabajando en otras pestañas: si lo haces, al terminar verás una notificación. Cancelar borra el archivo a medio escribir; la base no se modifica.</span>
        </section>

        <aside aria-label="Resumen" style="width: 260px; flex: none; align-self: start; padding: 16px; border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--surface); display: flex; flex-direction: column; gap: 10px; font-size: var(--fs-sm)">
          <span style="font-weight: 600; font-size: var(--fs-md)">Resumen</span>
          <dl style="margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 10px">
            <dt style="color: var(--text-dim)">Origen</dt><dd style="margin: 0; text-align: right">Ventas · main</dd>
            <dt style="color: var(--text-dim)">Objetos</dt><dd class="num" style="margin: 0; text-align: right">4 tablas · 1 vista</dd>
            <dt style="color: var(--text-dim)">Contenido</dt><dd style="margin: 0; text-align: right">Estructura y datos</dd>
            <dt style="color: var(--text-dim)">Destino</dt><dd class="mono" style="margin: 0; text-align: right; font-size: var(--fs-xs); word-break: break-all">~/Respaldos/ventas_2026-10-18_1432.sql</dd>
          </dl>
        </aside>
      </div>

      '''
FOOT='''<div style="height: 52px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 20px; border-top: 1px solid var(--border); background: var(--surface)">
        <button type="button" class="btn" disabled="disabled" aria-disabled="true" style="opacity: .45">Atrás</button>
        <span style="flex: 1"></span>
        <button type="button" class="btn btn-primary" disabled="disabled" aria-disabled="true" title="Respaldando…" style="opacity: .55"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9"></path></svg>Respaldando…</button>
        <a href="BackupRestore.dc.html" class="btn focus" title="Detener el respaldo y borrar el archivo parcial (Esc)">Cancelar respaldo</a>
      </div>
    </main>'''
main_end=s.index('</main>',foot_start)+7
s=s[:body_start]+BODY+FOOT+s[main_end:]
s=s.replace("{ label: 'Respaldo · main', kind: 'tool', active: true, href: 'BackupRestore.dc.html', color: '#2f7dd6' }","{ label: 'Respaldo · main', kind: 'tool', active: true, running: true, href: 'BackupProgress.dc.html', color: '#2f7dd6' }")
s=s.replace('info="Respaldo · 5 objetos seleccionados · 48 filas"','info="Respaldando · 62 % · objeto 3 de 5"')
js_start=s.index('    const objs = ['); js_end=s.index('    return {',js_start)
s=s[:js_start]+'''    const S = [['clientes', '12 filas', 'done'], ['detalle_pedido', '20 filas', 'done'], ['pedidos', '0 de 8 filas…', 'run'], ['productos', '8 filas', 'wait'], ['ventas_por_ciudad', 'vista · solo estructura', 'wait']];
    const steps = S.map(([name, sub, st], i) => ({ name, sub, done: st === 'done', run: st === 'run', wait: st === 'wait',
      icon: `width: 16px; display: flex; justify-content: center; color: ${st === 'wait' ? 'var(--text-dim)' : 'var(--accent-text)'}`,
      nameStyle: `flex: 1; ${st === 'run' ? 'font-weight: 600;' : ''} color: ${st === 'wait' ? 'var(--text-dim)' : 'var(--text)'}`,
      row: `height: 36px; display: flex; align-items: center; gap: 10px; padding: 0 12px; ${i ? 'border-top: 1px solid var(--border);' : ''} ${st === 'run' ? 'background: var(--sel);' : ''}` }));
'''+s[js_end:]
s=s.replace('      objs\n','      steps\n')
open('bodies/BackupProgress.body','w',encoding='utf8',newline='\n').write(s)
print('ok')
