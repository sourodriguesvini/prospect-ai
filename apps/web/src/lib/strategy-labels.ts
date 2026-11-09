import type {
  BrandAssetKind,
  CompanySize,
  EntityStatus,
  LiaDataCategory,
  LiaDataSource,
  ScoreDimension,
  ScoreThresholds,
} from '@prospector/contracts';
import type { LiaStatus } from '@prospector/domain';

/** Rótulos em pt-BR dos valores da Estratégia e da Conformidade. */

export const STATUS_LABELS: Record<EntityStatus, string> = {
  draft: 'Rascunho',
  active: 'Ativa',
  archived: 'Arquivada',
};

/** ICP é masculino. */
export const ICP_STATUS_LABELS: Record<EntityStatus, string> = {
  draft: 'Rascunho',
  active: 'Ativo',
  archived: 'Arquivado',
};

export const STATUS_BADGE: Record<EntityStatus, 'neutral' | 'success' | 'outline'> = {
  draft: 'neutral',
  active: 'success',
  archived: 'outline',
};

export const COMPANY_SIZE_LABELS: Record<CompanySize, string> = {
  me: 'Microempresa (ME)',
  epp: 'Empresa de pequeno porte (EPP)',
  demais: 'Demais',
};

export const BRAND_ASSET_LABELS: Record<BrandAssetKind, string> = {
  site_desktop: 'Site no computador',
  site_mobile: 'Site no celular',
  logo: 'Logotipo',
  favicon: 'Favicon',
  og_image: 'Imagem de compartilhamento',
  social_grid: 'Grade das redes sociais',
};

export const SCORE_DIMENSION_LABELS: Record<ScoreDimension, { label: string; help: string }> = {
  fit: { label: 'Adequação', help: 'A empresa é do perfil que a oferta atende?' },
  need: { label: 'Necessidade', help: 'Há evidência do problema que a oferta resolve?' },
  signal: { label: 'Sinal', help: 'Algo recente indica momento de mudança?' },
  capacity: { label: 'Capacidade', help: 'A empresa consegue contratar e pagar?' },
  timing: { label: 'Momento', help: 'É a hora certa de falar com ela?' },
};

export const THRESHOLD_LABELS: Record<keyof ScoreThresholds, { label: string; help: string }> = {
  pursuePriority: {
    label: 'Abordar agora: prioridade mínima',
    help: 'Prioridade a partir da qual a recomendação é "Abordar agora".',
  },
  prepareAccessPotential: {
    label: 'Preparar acesso: potencial mínimo',
    help: 'Potencial a partir do qual vale buscar decisor e canal.',
  },
  discardPotential: {
    label: 'Descartar: potencial abaixo de',
    help: 'Precisa ser menor que os dois limiares acima.',
  },
  minEvidenceCoverage: {
    label: 'Cobertura mínima de evidência (%)',
    help: 'Abaixo disso a recomendação é "Sem base suficiente".',
  },
};

export const LIA_CATEGORY_LABELS: Record<LiaDataCategory, string> = {
  name: 'Nome',
  role_title: 'Cargo',
  work_email: 'E-mail corporativo',
  work_phone: 'Telefone corporativo',
  professional_profile_url: 'Endereço de perfil profissional (digitado por você)',
};

export const LIA_SOURCE_LABELS: Record<LiaDataSource, string> = {
  registry_qsa: 'Quadro de sócios (base CNPJ)',
  company_website: 'Site da empresa',
  user_input: 'Informado por você',
};

export const LIA_STATUS_VIEW: Record<
  LiaStatus,
  { label: string; badge: 'neutral' | 'success' | 'warning' | 'danger' | 'outline' }
> = {
  draft: { label: 'Rascunho', badge: 'neutral' },
  approved: { label: 'Aprovada', badge: 'success' },
  expired: { label: 'Revisão vencida', badge: 'warning' },
  revoked: { label: 'Revogada', badge: 'danger' },
  superseded: { label: 'Substituída', badge: 'outline' },
};
