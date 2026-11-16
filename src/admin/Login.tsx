import { useState } from "preact/hooks";
import { Logo } from "../components/Chrome";
import { authed, call } from "./api";

export function Login() {
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const r = await call("POST", "/api/admin/login", { password });
    setBusy(false);
    if (r.ok) {
      authed.value = true;
      return;
    }
    setPassword("");
    setMsg(
      r.status === 429
        ? "Too many attempts. Try again in 15 minutes."
        : r.status === 503
          ? "Admin is not set up yet: the Worker has no ADMIN_PASSWORD secret."
          : "Wrong password.",
    );
  };

  return (
    <main class="adm-login">
      <form class="adm-card" onSubmit={submit}>
        <Logo />
        <h1>Admin</h1>
        <label class="adm-field">
          <span class="adm-label">Password</span>
          <input class="adm-input" type="password" autocomplete="current-password" required autofocus value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
        </label>
        <button class="adm-btn primary" type="submit" disabled={busy}>{busy ? "Checking…" : "Log in"}</button>
        {msg && <p class="adm-error" role="alert">{msg}</p>}
      </form>
    </main>
  );
}
