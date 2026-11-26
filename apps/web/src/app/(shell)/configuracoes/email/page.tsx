import { MAILBOX_STATUS_LABELS } from '@prospector/contracts';
import { MAILBOX_CHECK_LABELS, type MailboxCheckItem } from '@prospector/domain';
import { Alert, Badge, DemoBadge, Panel, PanelHeader, Well } from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import {
  ActionButtonForm,
  IdentityForm,
  MailboxForm,
  PasswordForm,
} from '@/components/email/email-forms';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { identityValues, mailboxValues } from '@/lib/email-forms';
import { EMAIL_PREVIEW_HREF, previewVersion } from '@/lib/email-preview';
import { MAILBOX_STATUS_BADGE, checkStatusLabel, checkTone } from '@/lib/email-labels';
import { formatDateTime } from '@/lib/format';
import { loadEmail } from '@/server/email';
import {
  checkMailboxAction,
  saveIdentityAction,
  saveMailboxAction,
  sendTestAction,
  setPasswordAction,
} from './actions';

export const metadata: Metadata = { title: 'E-mail' };

const TRAIL = [{ href: '/configuracoes', label: 'Configurações' }];

const ITEMS: readonly MailboxCheckItem[] = ['smtp', 'imap', 'spf', 'dkim', 'dmarc'];

const TONE_BADGE = { success: 'success', warning: 'warning', danger: 'danger' } as const;

async function EmailSettings() {
  await connection();
  const result = await loadEmail((email, ctx) => email.settings(ctx));
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const {
    identity,
    mailbox,
    lastCheck,
    issues,
    preview,
    optOutMissing,
    testBlocked,
    testRecipient,
  } = result.data;
  // Muda só quando a conexão muda (não a cada conferência): a mensagem de um teste antigo não
  // fica na tela depois de trocar servidor, usuário ou senha.
  const connectionKey = mailbox
    ? [
        mailbox.address,
        mailbox.smtpHost,
        mailbox.smtpPort,
        mailbox.imapHost,
        mailbox.imapPort,
        mailbox.username,
        mailbox.passwordSetAt ?? '',
      ].join('|')
    : 'sem-caixa';

  return (
    <>
      <StorageNotice storage={result.storage} />
      {result.synthetic ? (
        <Alert tone="warning" role="note">
          <span className="mr-2 inline-flex align-middle">
            <DemoBadge />
          </span>
          Caixa simulada (<code>PROSPECTOR_EMAIL=fixture</code>): a conferência e o envio de teste
          não conectam em servidor nenhum e os resultados abaixo são de demonstração.
        </Alert>
      ) : null}
      <Alert tone="info" role="note">
        Nada desta tela escreve para empresas. O único envio é o e-mail de teste, sempre para a
        própria caixa.
      </Alert>

      <Panel aria-labelledby="identidade">
        <PanelHeader
          titleId="identidade"
          title="Quem assina"
          description={
            identity
              ? `Versão ${identity.version}, salva em ${formatDateTime(identity.createdAt)}. Cada mudança cria uma versão nova.`
              : 'Nome, cargo, contatos e redes da assinatura. Vão no cabeçalho e no rodapé de todo e-mail.'
          }
        />
        <IdentityForm
          action={saveIdentityAction}
          initial={identityValues(identity?.content ?? null)}
        />
      </Panel>

      <Panel aria-labelledby="caixa">
        <PanelHeader
          titleId="caixa"
          title="Caixa de envio"
          description="Servidores da Hostinger já preenchidos. Mudar endereço, servidor, porta ou usuário pede um novo teste; mudar servidor ou usuário pede também a senha de novo."
          actions={
            mailbox ? (
              <Badge
                variant={MAILBOX_STATUS_BADGE[mailbox.status]}
                data-mailbox-status={mailbox.status}
              >
                {MAILBOX_STATUS_LABELS[mailbox.status]}
              </Badge>
            ) : null
          }
        />
        <MailboxForm action={saveMailboxAction} initial={mailboxValues(mailbox)} />
      </Panel>

      <Panel aria-labelledby="senha">
        <PanelHeader
          titleId="senha"
          title="Senha da caixa"
          description={
            mailbox?.passwordSetAt
              ? `Senha gravada em ${formatDateTime(mailbox.passwordSetAt)}. Trocar a senha desfaz a conferência.`
              : 'A mesma senha que você usa no webmail. Digite aqui; ela não aparece de volta.'
          }
        />
        {mailbox ? (
          <PasswordForm action={setPasswordAction} hasPassword={mailbox.hasPassword} />
        ) : (
          <Well className="py-6 text-center text-sm text-muted-foreground">
            Salve a caixa de envio primeiro.
          </Well>
        )}
      </Panel>

      <Panel aria-labelledby="conferencia">
        <PanelHeader
          titleId="conferencia"
          title="Conferência"
          description={
            lastCheck
              ? `Última conferência em ${formatDateTime(lastCheck.checkedAt)}.`
              : 'Testa o login de envio e de entrada e confere SPF, DKIM e DMARC do domínio no DNS público.'
          }
          actions={result.synthetic ? <DemoBadge /> : null}
        />
        <div className="space-y-5">
          <ActionButtonForm
            key={`conferir-${connectionKey}`}
            action={checkMailboxAction}
            label="Testar conexão"
            pendingLabel="Testando… (até 1 minuto)"
            pendingAnnouncement="Testando a conexão com os servidores de e-mail. Pode levar até 1 minuto."
            blockedReason={mailbox ? null : 'Salve a caixa de envio primeiro.'}
            hint={
              mailbox && !mailbox.hasPassword
                ? 'Sem a senha, o teste confere só o DNS do domínio, sem login.'
                : null
            }
          />
          {lastCheck ? (
            <ul className="divide-y rounded-lg border" data-testid="mailbox-check">
              {ITEMS.map((item) => {
                const tone = checkTone(issues, item);
                const itemIssues = issues.filter((issue) => issue.item === item);
                return (
                  <li key={item} className="space-y-1.5 px-4 py-3 text-sm" data-check-item={item}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{MAILBOX_CHECK_LABELS[item]}</span>
                      <Badge variant={TONE_BADGE[tone]}>{checkStatusLabel(lastCheck, item)}</Badge>
                    </div>
                    {itemIssues.map((issue) => (
                      <p key={issue.message} className="text-pretty text-muted-foreground">
                        {issue.severity === 'blocking' ? 'Precisa de ajuste: ' : 'Aviso: '}
                        {issue.message}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ul>
          ) : mailbox ? (
            <Well className="py-6 text-center text-sm text-muted-foreground">
              Ainda não há conferência para a caixa como ela está agora. Clique em Testar conexão.
            </Well>
          ) : null}
          <ActionButtonForm
            key={`teste-${connectionKey}`}
            action={sendTestAction}
            label="Enviar e-mail de teste para mim"
            pendingLabel="Enviando…"
            pendingAnnouncement="Enviando o e-mail de teste."
            variant="secondary"
            blockedReason={testBlocked}
            hint={testRecipient ? `Vai só para ${testRecipient}, no máximo um por minuto.` : null}
          />
        </div>
      </Panel>

      <Panel aria-labelledby="previa">
        <PanelHeader
          titleId="previa"
          title="Prévia do modelo"
          description="Como o e-mail de teste chega: cabeçalho, assinatura, redes e rodapé com o opt-out da Conformidade. As imagens vêm dos endereços que você cadastrou."
        />
        {preview ? (
          <div className="space-y-3">
            {optOutMissing ? (
              <Alert tone="warning" role="note" data-testid="opt-out-missing">
                O rodapé ainda sai sem a frase de opt-out. Cadastre-a em{' '}
                <Link href="/configuracoes/conformidade/opt-out" className="font-medium underline">
                  Configurações › Conformidade
                </Link>{' '}
                (Identificação e opt-out); a prévia e os envios passam a usá-la.
              </Alert>
            ) : null}
            <p className="break-words text-sm">
              <span className="text-muted-foreground">Assunto: </span>
              {preview.subject}
            </p>
            {/* Documento próprio, com política só dele (imagens https, sem script); links abrem
                numa aba nova, fora do quadro. */}
            <iframe
              title="Prévia do e-mail de teste"
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              src={`${EMAIL_PREVIEW_HREF}?v=${previewVersion(preview.html)}`}
              className="h-[46rem] w-full rounded-lg border bg-white"
            />
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Versão em texto simples</summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-muted p-4 font-sans">
                {preview.text}
              </pre>
            </details>
          </div>
        ) : (
          <Well className="py-6 text-center text-sm text-muted-foreground">
            Salve quem assina para ver a prévia.
          </Well>
        )}
      </Panel>
    </>
  );
}

export default function EmailSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={TRAIL}
        title="E-mail"
        description="Quem assina, a caixa que envia e a conferência do domínio (SPF, DKIM e DMARC). A senha fica guardada criptografada."
      />
      <Suspense fallback={<Loading label="Carregando o e-mail…" />}>
        <EmailSettings />
      </Suspense>
    </div>
  );
}
