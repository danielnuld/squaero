Inicio
<div class="th th-{{theme}}" data-os="{{os}}" style="width: 1280px; height: 800px; display: flex; flex-direction: column; overflow: hidden; position: relative; background: var(--chrome)">
  <dc-import name="TitleBar" theme="{{theme}}" os="{{os}}" window-title="Squaero" hint-size="1280px,38px"></dc-import>
  <div style="flex: 1; min-height: 0; display: flex">
    <dc-import name="Rail" theme="{{theme}}" active="explorer" height="738px" hint-size="56px,738px"></dc-import>
    <dc-import name="Explorer" theme="{{theme}}" state="none" height="738px" hint-size="248px,738px"></dc-import>
    <main style="flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--content); border-radius: var(--content-radius); border-top: var(--content-edge); border-left: var(--content-edge); overflow: hidden">
      <dc-import name="DocTabs" theme="{{theme}}" tabs="{{tabs}}" hint-size="100%,36px"></dc-import>
      <div style="flex: 1; min-height: 0; overflow: hidden; display: flex; justify-content: center; padding: 48px 40px 0">
        <div style="width: 840px; display: flex; gap: 56px">
          <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 28px">
            <div style="display: flex; align-items: center; gap: 14px">
              <span aria-hidden="true" style="width: 44px; height: 44px; border-radius: var(--r-lg); background: var(--accent); color: var(--accent-fg); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 22px">S</span>
              <div>
                <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.01em">Squaero</h1>
                <p style="margin: 2px 0 0; color: var(--text-dim)">Conéctate a una base de datos o abre un archivo para empezar.</p>
              </div>
            </div>

            <section aria-labelledby="w-start" style="display: flex; flex-direction: column; gap: 2px">
              <h2 id="w-start" class="lbl" style="margin: 0 0 6px">Empezar</h2>
              <a href="ConnectionForm.dc.html" class="focus" style="display: flex; align-items: center; gap: 12px; padding: 8px 10px; margin: 0 -10px; border-radius: var(--r-md); color: var(--text); text-decoration: none; background: var(--hover)">
                <span style="width: 34px; height: 34px; flex: none; border-radius: var(--r-md); background: var(--accent); color: var(--accent-fg); display: flex; align-items: center; justify-content: center">[[plus:16]]</span>
                <span style="flex: 1; min-width: 0"><span style="display: block; font-weight: 600">Nueva conexión</span><span style="display: block; font-size: var(--fs-sm); color: var(--text-dim)">SQLite, PostgreSQL, MySQL, SQL Server, Informix o MongoDB</span></span>
              </a>
              <a href="EditorEmpty.dc.html" style="display: flex; align-items: center; gap: 12px; padding: 8px 10px; margin: 0 -10px; border-radius: var(--r-md); color: var(--text); text-decoration: none">
                <span style="width: 34px; height: 34px; flex: none; box-sizing: border-box; border-radius: var(--r-md); background: var(--surface); border: 1px solid var(--border); color: var(--text-dim); display: flex; align-items: center; justify-content: center">[[history:16]]</span>
                <span style="flex: 1; min-width: 0"><span style="display: block; font-weight: 600">Retomar la sesión anterior</span><span style="display: block; font-size: var(--fs-sm); color: var(--text-dim)">2 pestañas de consulta en Ventas y Producción</span></span>
              </a>
              <a href="EditorEmpty.dc.html" style="display: flex; align-items: center; gap: 12px; padding: 8px 10px; margin: 0 -10px; border-radius: var(--r-md); color: var(--text); text-decoration: none">
                <span style="width: 34px; height: 34px; flex: none; box-sizing: border-box; border-radius: var(--r-md); background: var(--surface); border: 1px solid var(--border); color: var(--text-dim); display: flex; align-items: center; justify-content: center">[[open:16]]</span>
                <span style="flex: 1; min-width: 0"><span style="display: block; font-weight: 600">Abrir archivo .sql…</span><span style="display: block; font-size: var(--fs-sm); color: var(--text-dim)">Se abre en una pestaña de consulta nueva</span></span>
                <span class="kbd">{{k.open}}</span>
              </a>
              <a href="ConnectionManager.dc.html" style="display: flex; align-items: center; gap: 12px; padding: 8px 10px; margin: 0 -10px; border-radius: var(--r-md); color: var(--text); text-decoration: none">
                <span style="width: 34px; height: 34px; flex: none; box-sizing: border-box; border-radius: var(--r-md); background: var(--surface); border: 1px solid var(--border); color: var(--text-dim); display: flex; align-items: center; justify-content: center">[[import:16]]</span>
                <span style="flex: 1; min-width: 0"><span style="display: block; font-weight: 600">Importar conexiones…</span><span style="display: block; font-size: var(--fs-sm); color: var(--text-dim)">Desde un .json de Squaero, DBeaver o el .ncx de Navicat</span></span>
              </a>
            </section>

            <section aria-labelledby="w-recent" style="display: flex; flex-direction: column">
              <div style="display: flex; align-items: baseline; margin-bottom: 6px">
                <h2 id="w-recent" class="lbl" style="margin: 0; flex: 1">Recientes</h2>
                <a href="ConnectionManager.dc.html" style="font-size: var(--fs-sm); text-decoration: none">Ver todas</a>
              </div>
              <sc-for list="{{recent}}" as="r" hint-placeholder-count="4">
                <a href="{{r.href}}" title="Conectar a {{r.name}}" style="position: relative; height: 48px; display: flex; align-items: center; gap: 12px; padding: 0 10px; margin: 0 -10px; border-radius: var(--r-md); color: var(--text); text-decoration: none">
                  <span style="{{r.bar}}"></span>
                  <span style="{{r.badge}}">{{r.mono}}</span>
                  <span style="flex: 1; min-width: 0"><span style="display: flex; align-items: center; gap: 8px">{{r.name}}<sc-if value="{{r.safe}}"><span class="chip" style="height: 18px; background: var(--hover); color: var(--text-dim)">[[lock:11]]Solo lectura</span></sc-if></span><span style="display: block; font-size: var(--fs-sm); color: var(--text-dim)">{{r.sub}}</span></span>
                  <span class="num" style="font-size: var(--fs-sm); color: var(--text-dim)">{{r.when}}</span>
                </a>
              </sc-for>
            </section>
          </div>

          <aside aria-labelledby="w-tips" style="width: 260px; flex: none; padding-top: 78px; display: flex; flex-direction: column; gap: 14px">
            <h2 id="w-tips" class="lbl" style="margin: 0">Consejos</h2>
            <sc-for list="{{tips}}" as="t" hint-placeholder-count="5">
              <div style="display: flex; flex-direction: column; gap: 4px">
                <span><span class="kbd">{{t.k}}</span></span>
                <span style="font-size: var(--fs-sm); color: var(--text-dim); line-height: 1.45">{{t.text}}</span>
              </div>
            </sc-for>
            <a href="ShortcutsHelp.dc.html" style="font-size: var(--fs-sm); text-decoration: none">Ver todos los atajos ({{k.help}})</a>
          </aside>
        </div>
      </div>
    </main>
  </div>
  <dc-import name="StatusBar" theme="{{theme}}" conn="" db="" info="" hint-size="1280px,24px"></dc-import>
</div>
---PROPS---
{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"os":{"editor":"enum","options":["windows","macos","linux"],"default":"windows"},"$preview":{"width":1280,"height":800}}
---JS---
class Component extends DCLogic {
  renderVals() {
    const os = this.props.os ?? 'windows'; const mac = os === 'macos';
    const K = (s) => { if (!mac) return s; const p = s.split('+'); const key = p.pop(); const sym = { Alt: '⌥', 'Mayús': '⇧', Ctrl: '⌘' }; const km = { Intro: '↩', Supr: '⌫' }; return ['Alt', 'Mayús', 'Ctrl'].filter((m) => p.includes(m)).map((m) => sym[m]).join('') + (km[key] ?? key); };
    const badge = (c) => `width: 32px; height: 32px; flex: none; border-radius: var(--r-sm); background: color-mix(in srgb, ${c} 16%, transparent); color: ${c}; display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 11px; font-weight: 600`;
    const recent = [
      ['Ventas', 'SQLite · C:\\datos\\ventas.db', '#2f7dd6', 'SQ', 'hace 5 min', false, false],
      ['Producción', 'PostgreSQL · db.interno:5432/ventas', '#c4302b', 'PG', 'ayer', true, true],
      ['Ventas copia', 'SQLite · C:\\datos\\ventas_copia.db', '#2e9e52', 'SQ', 'hace 3 días', false, false],
      ['Producción (MySQL)', 'MySQL · db.interno:3306/ventas', '#c4302b', 'MY', '12 oct', true, false]
    ].map(([name, sub, c, mono, when, prod, safe]) => ({ name, sub, mono, when, prod, safe, href: 'ConnectedNoTab.dc.html', badge: badge(c),
      bar: `position: absolute; left: 0; top: 10px; bottom: 10px; width: 3px; border-radius: 0 3px 3px 0; background: ${c}` }));
    const tips = [
      { k: K('Ctrl+K'), text: 'Busca tablas, acciones y snippets desde cualquier sitio.' },
      { k: K('Ctrl+T'), text: 'Abre una consulta nueva sobre la conexión activa.' },
      { k: K('Ctrl+Intro'), text: 'Ejecuta la sentencia donde está el cursor; si hay texto seleccionado, solo la selección.' },
      { k: K('Ctrl+Mayús+Intro'), text: 'Ejecuta el script completo.' },
      { k: K('Ctrl+P'), text: 'Salta a una tabla o vista por su nombre.' }
    ];
    return { theme: this.props.theme ?? 'b', os, tabs: [], recent, tips, k: { open: K('Ctrl+O'), help: mac ? '⌘/' : 'F1' } };
  }
}
