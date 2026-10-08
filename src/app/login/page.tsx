import { login } from "../actions";
import { ErrorNote } from "@/components/ui";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <div className="mb-10"><div className="text-2xl font-semibold tracking-[0.25em]">VAULT</div><div className="label mt-1">Sales OS · Privat</div></div>
      <ErrorNote message={error} />
      <form action={login} className="flex flex-col gap-3">
        <input className="input" name="email" type="email" autoComplete="username" placeholder="E-Mail" required />
        <input className="input" name="password" type="password" autoComplete="current-password" placeholder="Passwort" required />
        <button className="btn btn-primary mt-2">Anmelden</button>
      </form>
    </main>
  );
}
