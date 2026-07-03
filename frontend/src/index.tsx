/* @refresh reload */
import { render } from "solid-js/web";
import { App } from "./App";
import { call, hasBridge } from "./utils/transport";
import "./styles.css";

const root = document.getElementById("root");
if (root) {
  render(() => <App />, root);
}

// Protocol handshake on load (docs/IPC.md rule 4): negotiate the protocol
// version with the core. Best-effort — ignored in a plain browser (no bridge).
if (hasBridge()) {
  void call("app.hello").catch(() => {});
}
