import { createSignal } from "solid-js";
import { buildRequest, nextId } from "./utils/ipc";

// Placeholder UI for M0. It demonstrates the build pipeline and the IPC request
// helper. The real layout (sidebar, SQL editor, virtualized grid) is M2.
export function App() {
  const [preview, setPreview] = createSignal("");

  const buildPing = () => {
    const request = buildRequest(nextId(), "ping", { message: "hola" });
    setPreview(JSON.stringify(request, null, 2));
  };

  return (
    <main style={{ "font-family": "system-ui, sans-serif", padding: "1.5rem" }}>
      <h1>Quaero</h1>
      <p>
        Scaffold del frontend. El transporte IPC hacia el núcleo se conecta en el
        issue #3.
      </p>
      <button onClick={buildPing}>Construir petición ping</button>
      <pre>{preview()}</pre>
    </main>
  );
}
