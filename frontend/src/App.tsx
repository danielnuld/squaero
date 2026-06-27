import { createSignal } from "solid-js";
import { call, hasBridge } from "./utils/transport";

// Placeholder UI for M0. It exercises the live IPC channel end-to-end: the
// button sends `ping` to the C core through the webview bridge and shows the
// response. The real layout (sidebar, SQL editor, grid) is M2.
export function App() {
  const [output, setOutput] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const sendPing = async () => {
    setBusy(true);
    try {
      const response = await call("ping", { message: "hola" });
      setOutput(JSON.stringify(response, null, 2));
    } catch (err) {
      setOutput(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ "font-family": "system-ui, sans-serif", padding: "1.5rem" }}>
      <h1>Quaero</h1>
      <p>
        {hasBridge()
          ? "Conectado al núcleo (libdbcore)."
          : "Modo navegador: el núcleo no está disponible fuera de la app."}
      </p>
      <button onClick={sendPing} disabled={busy()}>
        Enviar ping al núcleo
      </button>
      <pre>{output()}</pre>
    </main>
  );
}
