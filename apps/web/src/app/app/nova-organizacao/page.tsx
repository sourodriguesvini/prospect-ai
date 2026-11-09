import type { Metadata } from 'next';
import Link from 'next/link';
import { CreateOrganizationForm } from '@/components/forms/create-organization-form';

export const metadata: Metadata = { title: 'Nova organização' };

export default function NewOrganizationPage() {
  return (
    <div className="max-w-md space-y-8">
      <Link href="/app" className="text-sm text-muted-foreground underline underline-offset-4">
        Organizações
      </Link>
      <div className="space-y-2">
        <h1 className="text-4xl">Nova organização</h1>
        <p className="text-sm text-muted-foreground">
          Você será o proprietário. Depois, convide a equipe em Configuração → Equipe.
        </p>
      </div>
      <CreateOrganizationForm />
    </div>
  );
}
