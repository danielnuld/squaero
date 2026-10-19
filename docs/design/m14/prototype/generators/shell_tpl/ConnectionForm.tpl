Nueva conexión
<div class="th th-{{theme}}" data-os="{{os}}" style="width: 1280px; height: 800px; display: flex; flex-direction: column; overflow: hidden; position: relative; background: var(--chrome)">
  <dc-import name="TitleBar" theme="{{theme}}" os="{{os}}" window-title="Nueva conexión — Squaero" hint-size="1280px,38px"></dc-import>
  <div style="flex: 1; min-height: 0; display: flex">
    <dc-import name="Rail" theme="{{theme}}" active="plug" height="738px" hint-size="56px,738px"></dc-import>
    <dc-import name="Explorer" theme="{{theme}}" state="none" height="738px" hint-size="248px,738px"></dc-import>
    <main style="flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--content); border-radius: var(--content-radius); border-top: var(--content-edge); border-left: var(--content-edge); overflow: hidden">
      <dc-import name="DocTabs" theme="{{theme}}" tabs="{{tabs}}" hint-size="100%,36px"></dc-import>

      <div style="flex: 1; min-height: 0; display: flex; overflow: hidden">
        <nav aria-label="Secciones" style="width: 168px; flex: none; box-sizing: border-box; padding: 24px 8px 0 12px; display: flex; flex-direction: column; gap: 2px">
          <sc-for list="{{nav}}" as="n" hint-placeholder-count="6">
            <a href="#" aria-current="{{n.current}}" style="{{n.style}}">
              <span style="flex: 1">{{n.label}}</span>
              <sc-if value="{{n.ok}}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Completa" style="color: var(--ok)"><path d="M20 6 9 17l-5-5"></path></svg></sc-if>
              <sc-if value="{{n.todo}}"><span role="img" aria-label="Incompleta" style="width: 7px; height: 7px; margin-right: 3px; border-radius: 50%; background: var(--warn)"></span></sc-if>
              <sc-if value="{{n.off}}"><span style="font-size: var(--fs-xs); color: var(--text-dim)">apagado</span></sc-if>
            </a>
          </sc-for>
        </nav>

        <div style="flex: 1; min-width: 0; overflow: hidden; box-sizing: border-box; padding: 24px 20px 24px 8px; display: flex; flex-direction: column; gap: 28px">
          <sc-if value="{{top}}" hint-placeholder-val="{{ true }}">
            <div>
              <h1 style="margin: 0; font-size: var(--fs-xl); font-weight: 600">Nueva conexión</h1>
              <p style="margin: 4px 0 0; color: var(--text-dim)">Elige el motor y rellena cómo llegar a la base de datos.</p>
            </div>
            <section aria-labelledby="cf-engine" style="display: flex; flex-direction: column; gap: 10px">
              <h2 id="cf-engine" class="lbl" style="margin: 0; font-size: var(--fs-sm); color: var(--text)">Motor</h2>
              <div role="radiogroup" aria-labelledby="cf-engine" style="width: 520px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px">
                <sc-for list="{{engines}}" as="e" hint-placeholder-count="6">
                  <a href="#" role="radio" aria-checked="{{e.checked}}" style="{{e.style}}">
                    <span style="{{e.badge}}">{{e.mono}}</span>
                    <span style="min-width: 0"><span style="display: block; font-weight: 500; white-space: nowrap">{{e.name}}</span><span class="num" style="display: block; font-size: var(--fs-xs); color: var(--text-dim)">{{e.port}}</span></span>
                  </a>
                </sc-for>
              </div>
            </section>
          </sc-if>

          <sc-for list="{{sections}}" as="s" hint-placeholder-count="3">
            <section aria-label="{{s.title}}" style="display: flex; flex-direction: column; gap: 12px">
              <h2 class="lbl" style="margin: 0; font-size: var(--fs-sm); color: var(--text)">{{s.title}}</h2>
              <sc-for list="{{s.fields}}" as="f" hint-placeholder-count="3">
                <div style="display: flex; align-items: flex-start">
                  <label for="{{f.id}}" style="width: 160px; flex: none; min-height: 28px; box-sizing: border-box; padding-right: 12px; display: flex; align-items: center; gap: 6px; color: var(--text-dim)">{{f.label}}<sc-if value="{{f.opt}}"><span style="font-size: var(--fs-xs); color: var(--text-dim)">opcional</span></sc-if></label>
                  <div style="width: 360px; display: flex; flex-direction: column; gap: 6px">
                    <sc-if value="{{f.t.text}}"><input id="{{f.id}}" class="field" value="{{f.value}}" aria-describedby="{{f.helpId}}" style="width: 100%"></sc-if>
                    <sc-if value="{{f.t.pass}}"><input id="{{f.id}}" type="password" class="field" value="{{f.value}}" aria-describedby="{{f.helpId}}" style="width: 100%"></sc-if>
                    <sc-if value="{{f.t.pair}}">
                      <div style="display: flex; align-items: center; gap: 8px">
                        <input id="{{f.id}}" class="field" value="{{f.value}}" aria-describedby="{{f.helpId}}" style="flex: 1; min-width: 0">
                        <label for="{{f.id2}}" style="color: var(--text-dim); white-space: nowrap">{{f.label2}}</label>
                        <input id="{{f.id2}}" class="field num" value="{{f.value2}}" aria-describedby="{{f.helpId}}" style="width: 76px">
                      </div>
                    </sc-if>
                    <sc-if value="{{f.t.btn}}">
                      <div style="display: flex; gap: 6px">
                        <input id="{{f.id}}" class="field" value="{{f.value}}" aria-describedby="{{f.helpId}}" style="flex: 1; min-width: 0">
                        <button type="button" class="btn">{{f.btn}}</button>
                      </div>
                    </sc-if>
                    <sc-if value="{{f.t.select}}"><button id="{{f.id}}" type="button" class="field" aria-haspopup="listbox" style="width: 100%; display: flex; align-items: center; justify-content: space-between; text-align: left">{{f.value}}<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color: var(--text-dim)"><path d="m6 9 6 6 6-6"></path></svg></button></sc-if>
                    <sc-if value="{{f.t.seg}}">
                      <span id="{{f.id}}" class="seg" role="radiogroup" aria-label="{{f.label}}" style="align-self: flex-start">
                        <sc-for list="{{f.options}}" as="o" hint-placeholder-count="3"><span role="radio" aria-checked="{{o.checked}}" class="{{o.cls}}" style="gap: 6px"><sc-if value="{{o.hasDot}}"><span style="{{o.dot}}"></span></sc-if>{{o.label}}</span></sc-for>
                      </span>
                    </sc-if>
                    <sc-if value="{{f.t.swatch}}">
                      <span id="{{f.id}}" role="radiogroup" aria-label="Color" style="height: 28px; display: flex; align-items: center; gap: 8px">
                        <sc-for list="{{f.swatches}}" as="w" hint-placeholder-count="8"><span role="radio" aria-label="{{w.name}}" aria-checked="{{w.checked}}" style="{{w.style}}"></span></sc-for>
                      </span>
                    </sc-if>
                    <sc-if value="{{f.t.switch}}">
                      <button id="{{f.id}}" type="button" role="switch" aria-checked="{{f.checked}}" style="height: 28px; padding: 0; border: 0; background: transparent; display: flex; align-items: center; gap: 10px; text-align: left">
                        <span style="{{f.track}}"><span style="{{f.knob}}"></span></span>{{f.text}}
                      </button>
                    </sc-if>
                    <sc-if value="{{f.t.disc}}">
                      <button id="{{f.id}}" type="button" aria-expanded="true" style="height: 28px; padding: 0; border: 0; background: transparent; display: flex; align-items: center; gap: 6px; color: var(--text-dim); font-weight: 600"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>{{f.text}}</button>
                    </sc-if>
                    <sc-if value="{{f.hasHelp}}"><span id="{{f.helpId}}" class="help" style="line-height: 1.45">{{f.help}}</span></sc-if>
                  </div>
                </div>
              </sc-for>
            </section>
          </sc-for>
        </div>

        <aside aria-label="Resumen" style="width: 232px; flex: none; box-sizing: border-box; padding: 24px 16px 0 0; display: flex; flex-direction: column; gap: 12px">
          <div style="padding: 12px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface); display: flex; flex-direction: column; gap: 10px">
            <span class="lbl">Vista previa</span>
            <div style="display: flex; align-items: center; gap: 10px">
              <span style="{{previewBar}}"></span>
              <span style="{{previewBadge}}">{{mono}}</span>
              <span style="min-width: 0"><span style="display: block; font-weight: 600">{{previewName}}</span><span style="display: block; font-size: var(--fs-xs); color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{previewSub}}</span></span>
            </div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap">
              <span class="chip" style="height: 20px; background: var(--hover); color: var(--text-dim)">Desarrollo</span>
              <span class="chip" style="height: 20px; background: var(--hover); color: var(--text-dim)">Sin protección</span>
            </div>
          </div>
          <div style="padding: 12px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface); display: flex; flex-direction: column; gap: 8px">
            <span class="lbl">Prueba de conexión</span>
            <span style="display: flex; align-items: center; gap: 8px; color: var(--text-dim); font-size: var(--fs-sm)"><span style="width: 7px; height: 7px; border-radius: 50%; background: var(--text-faint)"></span>Aún sin probar.</span>
            <span class="help" style="line-height: 1.45">Probar no guarda nada.</span>
          </div>
        </aside>
      </div>

      <div style="height: 52px; flex: none; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 0 16px; border-top: 1px solid var(--border); background: var(--surface)">
        <button type="button" class="btn"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2v6M15 2v6"></path><path d="M6 8h12v4a6 6 0 0 1-12 0z"></path><path d="M12 18v4"></path></svg>Probar conexión</button>
        <span style="flex: 1"></span>
        <span class="dlg-actions" style="{{act}}">
          <a href="ConnectedNoTab.dc.html" class="btn btn-primary">Guardar y conectar</a>
          <a href="ConnectionManager.dc.html" class="btn">Guardar</a>
          <a href="Welcome.dc.html" class="btn">Cancelar</a>
        </span>
      </div>
    </main>
  </div>
  <dc-import name="StatusBar" theme="{{theme}}" conn="" db="" info="" hint-size="1280px,24px"></dc-import>
</div>
---PROPS---
{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"os":{"editor":"enum","options":["windows","macos","linux"],"default":"windows"},"engine":{"editor":"enum","options":["postgres","sqlite","mysql","mssql","informix","mongodb"],"default":"postgres"},"ssh":{"editor":"boolean","default":false},"$preview":{"width":1280,"height":800}}
---JS---
class Component extends DCLogic {
  renderVals() {
    const p = this.props;
    const os = p.os ?? 'windows';
    const eng = p.engine ?? 'postgres';
    const ssh = p.ssh === true || p.ssh === 'true';
    const badge = (c, s) => `width: ${s}px; height: ${s}px; flex: none; border-radius: var(--r-sm); background: color-mix(in srgb, ${c} 16%, transparent); color: ${c}; display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 11px; font-weight: 600`;
    const E = [['sqlite', 'SQLite', 'SQ', 'Archivo local', '#3b7ddd'], ['postgres', 'PostgreSQL', 'PG', 'Puerto 5432', '#336791'], ['mysql', 'MySQL / MariaDB', 'MY', 'Puerto 3306', '#c47a12'],
      ['mssql', 'SQL Server', 'MS', 'Puerto 1433', '#b0302b'], ['informix', 'IBM Informix', 'IFX', 'Puerto 9089', '#1f70c1'], ['mongodb', 'MongoDB', 'MG', 'Puerto 27017', '#3f9142']];
    const cur = E.find((e) => e[0] === eng) ?? E[1];
    const engines = E.map(([id, name, mono, port, c]) => {
      const on = id === eng;
      return { name, mono, port, badge: badge(c, 28), checked: on ? 'true' : 'false',
        style: `height: 44px; box-sizing: border-box; display: flex; align-items: center; gap: 10px; padding: 0 10px; border: 1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}; border-radius: var(--r-md); background: ${on ? 'var(--accent-soft)' : 'var(--content)'}; box-shadow: ${on ? '0 0 0 1px var(--accent)' : 'none'}; color: var(--text); text-decoration: none` };
    });

    let n = 0;
    const f = (t, label, o = {}) => {
      n += 1; const k = {}; k[t] = true; const on = o.on ?? 0;
      return { t: k, label, id: `cf-${n}`, id2: `cf-${n}b`, helpId: o.help ? `cf-${n}h` : '', value: o.v ?? '', opt: !!o.opt, help: o.help ?? '', hasHelp: !!o.help,
        label2: o.label2 ?? '', value2: o.v2 ?? '', btn: o.btn ?? '', text: o.text ?? '', checked: o.sw ? 'true' : 'false',
        options: (o.options ?? []).map((x, i) => { const [lab, c] = Array.isArray(x) ? x : [x, null]; return { label: lab, cls: i === on ? 'on' : '', checked: i === on ? 'true' : 'false', hasDot: !!c, dot: `width: 8px; height: 8px; border-radius: 50%; background: ${c}` }; }),
        swatches: (o.swatches ?? []).map(([name, c], i) => ({ name, checked: i === 0 ? 'true' : 'false',
          style: `width: 24px; height: 24px; box-sizing: border-box; border-radius: 50%; background: ${c ?? 'transparent'}; border: ${c ? '0' : '1px dashed var(--border-strong)'}; box-shadow: ${i === 0 ? '0 0 0 2px var(--content), 0 0 0 4px var(--accent)' : 'none'}` })),
        track: `width: 32px; height: 18px; flex: none; box-sizing: border-box; border-radius: 9px; position: relative; background: ${o.sw ? 'var(--accent)' : 'var(--border-strong)'}`,
        knob: `position: absolute; top: 2px; left: ${o.sw ? '16px' : '2px'}; width: 14px; height: 14px; border-radius: 50%; background: var(--content); box-shadow: var(--shadow-sm)` };
    };
    const S = (title, fields) => ({ title, fields });

    const port = { postgres: '5432', mysql: '3306', mssql: '1433', informix: '9089', mongodb: '27017' }[eng];
    const host = eng === 'mysql' ? '127.0.0.1' : 'localhost';
    const user = { mysql: 'root', mssql: 'sa', informix: 'informix', mongodb: 'admin' }[eng] ?? 'postgres';
    const defName = eng === 'sqlite' ? 'el nombre del archivo' : `${user}@${host}`;
    const ident = S('Identificación', [
      f('text', 'Nombre', { opt: true, help: `Si lo dejas vacío se llamará ${defName}.` }),
      f('seg', 'Tipo de entorno', { options: [['Desarrollo', '#2f7dd6'], ['Pruebas', '#2e9e52'], ['Producción', '#c4302b']], help: 'Pone el color y la protección por defecto. Producción: rojo y Confirmar escrituras.' }),
      f('swatch', 'Color', { swatches: [['Azul', '#2f7dd6'], ['Verde', '#2e9e52'], ['Turquesa', '#2fa9b8'], ['Violeta', '#9b6ad6'], ['Amarillo', '#d6b03a'], ['Naranja', '#e0883a'], ['Rojo', '#c4302b'], ['Sin color', null]], help: 'Tiñe sus pestañas, su nodo en el explorador y la barra de estado.' })]);
    const sslSel = { postgres: ['Modo SSL', 'Por defecto (prefer)', 'Cifra si el servidor puede y, si no, conecta sin cifrar.'],
      mysql: ['Modo SSL', 'Por defecto (preferred)', 'Cifra si el servidor lo ofrece; si no, conecta sin cifrar.'],
      mssql: ['Cifrado', 'Obligatorio', 'El servidor debe presentar un certificado de confianza.'] };
    const prot = f('seg', 'Protección', { options: ['Ninguna', 'Confirmar escrituras', 'Solo lectura'], help: 'Solo lectura rechaza, antes de enviarla, cualquier sentencia que escriba. Confirmar escrituras enseña lo que se va a escribir y pide confirmación.' });
    const adv = S('Avanzado', [
      f('select', 'Grupo', { v: 'Sin grupo', opt: true }),
      f('text', 'Keep-alive (s)', { v: '0', help: '0 = desactivado. Sondea el servidor mientras está ociosa y reconecta sola si se cayó.' })]);
    let sections = [];
    if (eng === 'sqlite') {
      sections.push(ident, S('Archivo', [f('btn', 'Archivo de base de datos', { btn: 'Examinar…', help: 'Ruta a un archivo .db, .sqlite o .sqlite3. Escribe :memory: para una base temporal que se borra al desconectar.' })]), S('Seguridad', [prot]), adv);
    } else {
      const srv = [f('pair', 'Host', { v: host, label2: eng === 'informix' ? 'Puerto (DRDA)' : 'Puerto', v2: port, help: `Puerto por defecto de ${cur[1]}: ${port}.` })];
      if (eng === 'mssql') srv.push(f('text', 'Instancia', { opt: true, help: 'Por ejemplo SQLEXPRESS. Úsala en lugar del puerto para una instancia con nombre.' }));
      if (eng === 'informix') srv.push(f('text', 'Nombre del servidor', { opt: true, help: 'Por ejemplo ol_informix. Solo para SQLI en Windows.' }));
      const acc = [eng === 'postgres' ? f('btn', 'Base de datos', { btn: 'Listar', help: 'Vacío = postgres. Listar pide al servidor sus bases.' }) : f('text', 'Base de datos', { opt: eng === 'mysql', help: eng === 'mysql' ? 'Vacío = sin base activa; la eliges luego en el editor.' : '' }),
        f('text', 'Usuario', { help: `Obligatorio. Habitual en ${cur[1]}: ${user}.` }), f('pass', 'Contraseña', { opt: true, help: 'Se guarda en el almacén de credenciales del sistema.' })];
      if (eng === 'mongodb') acc.push(f('text', 'Base de autenticación', { opt: true, help: 'Vacío = admin.' }));
      let sec;
      if (sslSel[eng]) sec = [prot, f('select', sslSel[eng][0], { v: sslSel[eng][1], help: sslSel[eng][2] })];
      else if (eng === 'informix') sec = [prot, f('seg', 'TLS', { options: ['Desactivado', 'Requerido', 'Verificar CA', 'Verificar identidad'] })];
      else sec = [prot, f('seg', 'TLS', { options: ['Desactivado', 'Activado'] }), f('btn', 'Certificado CA', { opt: true, btn: 'Examinar…' })];
      const tun = [f('switch', '', { sw: ssh, text: 'Conectar a través de un túnel SSH' })];
      if (ssh) tun.push(
        f('pair', 'Host SSH', { label2: 'Puerto', v2: '22', help: 'Por ejemplo bastion.empresa.com. Puerto por defecto: 22.' }), f('text', 'Usuario SSH', { v: 'deploy' }),
        f('select', 'Autenticación', { v: 'Clave privada' }), f('btn', 'Clave privada', { v: '~/.ssh/id_ed25519', btn: 'Examinar…' }), f('pass', 'Passphrase', { opt: true }),
        f('disc', '', { text: 'Opciones avanzadas del túnel' }),
        f('pair', 'Host destino', { opt: true, label2: 'Puerto', v2: port, help: 'Vacío = el host del servidor. Cámbialo solo si el servidor se ve distinto desde el bastión.' }),
        f('select', 'Clave de host SSH', { v: 'Aceptar y recordar (TOFU)', help: 'Acepta la clave la primera vez y rechaza la conexión si cambia después.' }),
        f('btn', 'Archivo known_hosts', { v: '~/.ssh/known_hosts', btn: 'Examinar…' }));
      if (!ssh) sections.push(ident, S('Servidor', srv), S('Acceso', acc));
      sections.push(S('Seguridad', sec), S('Túnel SSH', tun), adv);
    }

    const navDefs = eng === 'sqlite' ? [['Motor', 'ok'], ['Identificación', 'ok'], ['Archivo', 'todo'], ['Seguridad', 'ok'], ['Avanzado', 'ok']]
      : [['Motor', 'ok'], ['Identificación', 'ok'], ['Servidor', 'ok'], ['Acceso', 'todo'], ['Seguridad', 'ok'], ['Túnel SSH', ssh ? 'todo' : 'off'], ['Avanzado', 'ok']];
    const current = ssh ? 'Túnel SSH' : 'Motor';
    const nav = navDefs.map(([label, st]) => {
      const on = label === current;
      return { label, ok: st === 'ok', todo: st === 'todo', off: st === 'off', current: on ? 'true' : 'false',
        style: `height: 30px; display: flex; align-items: center; gap: 8px; padding: 0 10px; border-radius: var(--r-sm); text-decoration: none; color: ${on ? 'var(--text)' : 'var(--text-dim)'}; background: ${on ? 'var(--hover)' : 'transparent'}; font-weight: ${on ? 600 : 400}` };
    });
    const sub = eng === 'sqlite' ? 'SQLite · sin archivo' : `${cur[1]} · ${host}:${port}`;
    return {
      theme: p.theme ?? 'b', os, top: !ssh, engines, sections, nav, mono: cur[2], previewBadge: badge(cur[4], 32), previewSub: sub, previewName: eng === 'sqlite' ? 'Sin nombre' : defName,
      previewBar: 'width: 3px; align-self: stretch; flex: none; border-radius: 2px; background: #2f7dd6',
      act: os === 'windows' ? '' : 'flex-direction: row-reverse',
      tabs: [{ label: 'Nueva conexión', kind: 'tool', active: true, href: 'ConnectionForm.dc.html' }]
    };
  }
}
