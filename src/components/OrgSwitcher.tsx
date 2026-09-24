"use client";

import { switchOrganization } from "@/app/actions/session";

/**
 * Asiakasvalinta: vesihuoltolaitokset ovat toisistaan erillisiä asiakkaita,
 * ja kaikki näkymät koskevat valittua laitosta. Valinta vaihtaa laitoksen
 * heti ilman erillistä painiketta.
 */
export function OrgSwitcher({ current, options }: { current: string; options: { id: string; name: string }[] }) {
  return (
    <form action={switchOrganization}>
      <label htmlFor="org-switch" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
        Asiakas
      </label>
      <select
        id="org-switch"
        name="organizationId"
        defaultValue={current}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="min-h-10 w-full rounded-xl border border-line bg-paper px-3 text-sm font-semibold focus:border-sky focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <noscript>
        <button className="mt-1 text-xs text-sky">Vaihda</button>
      </noscript>
    </form>
  );
}
