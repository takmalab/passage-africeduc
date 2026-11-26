import { KeyRound, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { post } from '../../api';
import { Button, ErrorBox, inputClass } from '../../components/ui';

type Created = { login: string; temporaryPassword: string };

/**
 * Formulaire de création de compte (agent ou parent). Le serveur fixe le rôle,
 * génère le mot de passe provisoire et ne le renvoie qu'une fois : on l'affiche
 * ici jusqu'à la prochaine création ou au changement de page, jamais ailleurs.
 */
export function NewAccountForm({
  path,
  submitLabel,
  onCreated,
}: {
  /** Route de création, ex. « /manager/agents ». */
  path: string;
  submitLabel: string;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({ name: '', login: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<Created | null>(null);

  return (
    <div className="space-y-2">
      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setCreated(null); // l'ancien mot de passe disparaît de l'écran
          setSaving(true);
          try {
            const res = await post<{
              agent?: { login: string };
              parent?: { login: string };
              temporaryPassword: string;
            }>(path, form);
            const account = res.agent ?? res.parent;
            setCreated({ login: account!.login, temporaryPassword: res.temporaryPassword });
            setForm({ name: '', login: '' });
            onCreated();
          } catch (err) {
            setError(err); // ex. « Cet identifiant est déjà utilisé. »
          } finally {
            setSaving(false);
          }
        }}
      >
        <input
          className={inputClass}
          placeholder="Nom affiché (ex. Mme Ngo)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          maxLength={80}
          aria-label="Nom affiché"
          required
        />
        <input
          className={inputClass}
          placeholder="Identifiant (ex. parent.ngo)"
          value={form.login}
          onChange={(e) => setForm({ ...form, login: e.target.value })}
          pattern="[A-Za-z0-9._\-]{3,50}"
          title="3 à 50 caractères : lettres, chiffres, point, tiret, souligné"
          aria-label="Identifiant de connexion"
          autoComplete="off"
          required
        />
        <Button type="submit" loading={saving}>
          <UserPlus className="size-4" aria-hidden />
          {submitLabel}
        </Button>
      </form>
      <ErrorBox error={error} />
      {created && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-amber-900">
            <KeyRound className="size-4" aria-hidden />
            Compte « {created.login} » créé. Mot de passe provisoire :
            <code className="rounded bg-white px-2 py-0.5 font-mono text-base">
              {created.temporaryPassword}
            </code>
          </p>
          <p className="mt-1 text-amber-900">
            Notez-le et transmettez-le à la personne : il ne sera plus jamais affiché.
          </p>
        </div>
      )}
    </div>
  );
}
