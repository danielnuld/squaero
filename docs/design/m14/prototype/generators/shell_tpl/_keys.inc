    const os = this.props.os ?? 'windows'; const mac = os === 'macos';
    const K = (s) => { if (!mac) return s; const p = s.split('+'); const key = p.pop(); const sym = { Alt: '⌥', 'Mayús': '⇧', Ctrl: '⌘' }; const km = { Intro: '↩', Supr: '⌫', 'Re Pág': '⇞', 'Av Pág': '⇟' }; return ['Alt', 'Mayús', 'Ctrl'].filter((m) => p.includes(m)).map((m) => sym[m]).join('') + (km[key] ?? key); };
    const k = { filter: K('Ctrl+Mayús+L'), sort: K('Ctrl+Mayús+O'), find: K('Ctrl+F'), row: K('Ctrl+Intro'), run: K('Ctrl+Intro'), script: K('Ctrl+Mayús+Intro'), fmt: K('Alt+Mayús+F'), stop: 'Esc',
      open: K('Intro'), alter: 'F4', del: K('Supr'), copy: K('Ctrl+C'), ddl: K('Ctrl+Mayús+C'), refresh: mac ? '⌘R' : 'F5', newq: K('Ctrl+T'), close: K('Ctrl+W'), closeAll: K('Ctrl+Mayús+W'),
      reopen: K('Ctrl+Mayús+T'), export: K('Ctrl+Mayús+X'), settings: K('Ctrl+,'), save: K('Ctrl+S'), more: K('Alt+M') };
    const act = os === 'windows' ? '' : 'flex-direction: row-reverse';
