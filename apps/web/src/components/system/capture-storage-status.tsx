import { Badge, StatusDot } from '@prospector/ui';
import { connection } from 'next/server';
import { captureStorageStatus } from '@/server/container';

/**
 * Pasta das capturas de marca (diretriz de 2026-11-26, Parte 13): onde as imagens ficam, se a
 * leitura e a escrita funcionam agora e quanto já está guardado. Lido a cada visita.
 */

const SOURCE_LABEL = {
  captures_dir: 'definida em PROSPECTOR_CAPTURES_DIR',
  data_dir: 'pasta de dados do programa',
  installation: 'pasta de dados da instalação',
} as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

export async function CaptureStorageValue() {
  await connection();
  const status = await captureStorageStatus();
  const { health } = status;
  const tone = !status.captureEnabled ? 'neutral' : health?.ok ? 'success' : 'warning';
  const label = !status.captureEnabled
    ? 'Captura de tela desligada'
    : !health
      ? 'Imagens não guardadas'
      : health.ok
        ? 'Guardando as imagens'
        : 'Pasta com problema';
  const help = !status.captureEnabled
    ? 'PROSPECTOR_BRAND_CAPTURE=off: as análises usam só o texto do site.'
    : !health
      ? `Nenhuma pasta de dados disponível${status.problem ? ` (${status.problem})` : ''}. As imagens são analisadas e descartadas. Instale o app com pnpm app:install ou defina PROSPECTOR_DATA_DIR fora do disco C:.`
      : health.ok
        ? `${health.files === 0 ? 'Nenhuma imagem ainda' : health.files === 1 ? '1 imagem' : `${health.files} imagens`}${health.files > 0 ? ` (${formatBytes(health.bytes)})` : ''} em ${health.location}${status.source ? `, ${SOURCE_LABEL[status.source]}` : ''}. Cada imagem fica 12 meses depois do último uso.`
        : `${health.problem ?? 'A pasta não respondeu.'} Pasta: ${health.location}.`;
  return (
    <div data-capture-status={tone} className="space-y-2">
      <p className="text-xs text-muted-foreground">Capturas de marca</p>
      <p className="text-base font-medium">{label}</p>
      <Badge variant={tone}>
        <StatusDot tone={tone}>
          {tone === 'success' ? 'Tudo certo' : tone === 'warning' ? 'Ação necessária' : 'Desligada'}
        </StatusDot>
      </Badge>
      <p className="text-sm break-words text-muted-foreground">{help}</p>
    </div>
  );
}
