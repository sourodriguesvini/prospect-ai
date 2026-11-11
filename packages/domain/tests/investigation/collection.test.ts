import { BrandMetrics, type InvestigationSnapshot } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  captureExcerpt,
  competitorSearchQuery,
  detectChanges,
  filterCompetitorCandidates,
  metricFacts,
  metricLines,
  quoteFoundIn,
  siteRegistrableDomain,
  selectSitePages,
} from '../../src';

describe('selectSitePages', () => {
  const home = 'https://www.clinicaexemplo.com.br/';
  const links = [
    { url: 'https://www.clinicaexemplo.com.br/#topo', text: 'Início' },
    { url: 'https://www.clinicaexemplo.com.br/quem-somos', text: 'Quem somos' },
    { url: 'https://www.clinicaexemplo.com.br/sobre/equipe/dentistas', text: 'Nossa equipe' },
    { url: 'https://www.clinicaexemplo.com.br/tratamentos', text: 'Tratamentos' },
    { url: 'https://www.clinicaexemplo.com.br/tratamentos/implante', text: 'Implante' },
    { url: 'https://www.clinicaexemplo.com.br/politica-de-privacidade', text: 'Privacidade' },
    { url: 'https://www.clinicaexemplo.com.br/login', text: 'Área do paciente' },
    { url: 'https://www.clinicaexemplo.com.br/folder.pdf', text: 'Folder' },
    { url: 'https://www.instagram.com/clinicaexemplo', text: 'Instagram' },
    { url: 'https://blog.clinicaexemplo.com.br/trabalhe-conosco', text: 'Trabalhe conosco' },
    { url: 'mailto:contato@clinicaexemplo.com.br', text: 'E-mail' },
  ];

  it('escolhe a inicial e uma página por categoria, na ordem de interesse', () => {
    const pages = selectSitePages(home, links, { siteDomain: 'clinicaexemplo.com.br' });
    expect(pages).toEqual([
      { url: 'https://www.clinicaexemplo.com.br', category: 'home' },
      { url: 'https://www.clinicaexemplo.com.br/quem-somos', category: 'about' },
      { url: 'https://www.clinicaexemplo.com.br/tratamentos', category: 'services' },
      { url: 'https://blog.clinicaexemplo.com.br/trabalhe-conosco', category: 'careers' },
    ]);
  });

  it('respeita o limite, ignora outro site, arquivos, login e política', () => {
    const pages = selectSitePages(home, links, { siteDomain: 'clinicaexemplo.com.br', max: 1 });
    expect(pages.map((page) => page.category)).toEqual(['home', 'about']);
    const urls = selectSitePages(home, links, { siteDomain: 'clinicaexemplo.com.br' }).map(
      (page) => page.url,
    );
    expect(urls.some((url) => /instagram|login|privacidade|\.pdf/.test(url))).toBe(false);
  });

  it('link com "%" malformado não derruba a seleção', () => {
    const pages = selectSitePages(
      home,
      [
        { url: 'https://www.clinicaexemplo.com.br/100%-natural', text: 'Linha natural' },
        { url: 'https://www.clinicaexemplo.com.br/quem-somos', text: 'Quem somos' },
      ],
      { siteDomain: 'clinicaexemplo.com.br' },
    );
    expect(pages.map((page) => page.category)).toEqual(['home', 'about', 'products']);
    expect(pages.find((page) => page.category === 'products')?.url).toContain('100%-natural');
  });

  it('reconhece "a <marca>" como institucional e "coleção" como produtos (caso real, 2026-11-11)', () => {
    const site = 'https://moveis-exemplo.com.br/';
    const pages = selectSitePages(
      site,
      [
        { url: 'https://moveis-exemplo.com.br/amoveisexemplo', text: 'a móveis exemplo' },
        { url: 'https://moveis-exemplo.com.br/colecao.html', text: 'coleção' },
        { url: 'https://moveis-exemplo.com.br/designers', text: 'designers' },
        { url: 'https://moveis-exemplo.com.br/contato', text: 'contato' },
      ],
      { siteDomain: 'moveis-exemplo.com.br' },
    );
    // O caminho "/amoveisexemplo" casa com o domínio sem hífen; o texto com espaço não precisa.
    expect(pages.map((page) => page.category)).toEqual(['home', 'about', 'products']);
    const brand = selectSitePages(
      'https://www.dpot-exemplo.com.br/',
      [
        { url: 'https://www.dpot-exemplo.com.br/adpotexemplo', text: 'a dpot exemplo' },
        { url: 'https://www.dpot-exemplo.com.br/a-dpotexemplo/', text: 'quem faz' },
        { url: 'https://www.dpot-exemplo.com.br/colecao.html', text: 'coleção' },
        { url: 'https://www.dpot-exemplo.com.br/adorno', text: 'adorno' },
      ],
      { siteDomain: 'dpot-exemplo.com.br' },
    );
    expect(brand).toEqual([
      { url: 'https://www.dpot-exemplo.com.br', category: 'home' },
      { url: 'https://www.dpot-exemplo.com.br/adpotexemplo', category: 'about' },
      { url: 'https://www.dpot-exemplo.com.br/colecao.html', category: 'products' },
    ]);
  });

  it('endereço inicial inválido não lê nada', () => {
    expect(selectSitePages('não é url', links, { siteDomain: 'x.com.br' })).toEqual([]);
  });
});

const desktop = BrandMetrics.parse({
  viewport: 'desktop',
  pageWidth: 1280,
  pageHeight: 4200,
  title: 'Clínica Exemplo | Odontologia',
  hasViewportMeta: true,
  horizontalOverflow: false,
  fonts: ['Montserrat', 'Open Sans'],
  textColors: ['#222222'],
  backgroundColors: ['#FFFFFF', '#F5F5F5'],
  accentColors: ['#0A6CFF'],
  h1Count: 2,
  h1Text: 'Seu "sorriso" em boas mãos',
  imageCount: 14,
  imagesWithoutAlt: 9,
  ctaTexts: ['Agende sua consulta', 'Fale no WhatsApp'],
  navLinkCount: 7,
  smallTapTargets: 3,
  lowContrastTexts: 4,
  contrastSamples: 40,
  smallTextPercent: 12,
  hasFavicon: false,
  hasOgImage: true,
  logo: { found: true, width: 180, height: 48, format: 'raster' },
  forms: 1,
  domContentLoadedMs: 1830,
  transferredBytes: 2_500_000,
});

const mobile = BrandMetrics.parse({
  ...desktop,
  viewport: 'mobile',
  pageWidth: 412,
  horizontalOverflow: true,
  hasViewportMeta: false,
  smallTapTargets: 11,
});

describe('medições da captura', () => {
  it('cada fato cita exatamente uma frase do texto guardado na fonte', () => {
    for (const metrics of [desktop, mobile]) {
      const excerpt = captureExcerpt(
        metrics,
        'https://clinicaexemplo.com.br/',
        '2026-11-11T12:00:00Z',
      );
      const facts = metricFacts(metrics);
      expect(facts.length).toBeGreaterThan(3);
      for (const fact of facts) {
        expect(fact.statement).toBe(fact.quote);
        expect(quoteFoundIn(fact.quote, excerpt)).toBe(true);
        expect(fact.key).toMatch(/^visual\.(metric|identity)\.[a-z0-9_]+$/);
      }
    }
  });

  it('celular registra viewport, rolagem lateral e alvos de toque; computador, a identidade', () => {
    const mobileKeys = metricFacts(mobile).map((fact) => fact.key);
    expect(mobileKeys).toEqual([
      'visual.metric.mobile_viewport_meta',
      'visual.metric.mobile_overflow',
      'visual.metric.mobile_tap_targets',
      'visual.metric.mobile_small_text',
    ]);
    const desktopFacts = metricFacts(desktop);
    expect(desktopFacts.map((fact) => fact.key)).toContain('visual.identity.typography');
    const palette = desktopFacts.find((fact) => fact.key === 'visual.identity.palette');
    expect(palette?.value).toEqual({
      text: ['#222222'],
      background: ['#FFFFFF', '#F5F5F5'],
      accent: ['#0A6CFF'],
    });
    expect(metricLines(mobile).find((line) => line.name === 'overflow')?.text).toBe(
      'No celular, o conteúdo é mais largo que a tela (há rolagem lateral).',
    );
  });

  it('aspas do site não quebram o texto das medições', () => {
    const h1 = metricLines(desktop).find((line) => line.name === 'h1');
    expect(h1?.text).toBe(
      `2 títulos principais (H1) no computador; o primeiro: "Seu 'sorriso' em boas mãos".`,
    );
  });
});

describe('concorrentes', () => {
  it('domínio registrável entende .com.br e subdomínios', () => {
    expect(siteRegistrableDomain('https://blog.odonto.com.br/x')).toBe('odonto.com.br');
    expect(siteRegistrableDomain('www.exemplo.com')).toBe('exemplo.com');
    expect(siteRegistrableDomain('localhost')).toBeNull();
  });

  it('tira a própria empresa, redes, diretórios, governo e repetições', () => {
    const hits = [
      { url: 'https://clinicaexemplo.com.br/', title: 'Própria', snippet: '' },
      { url: 'https://www.doctoralia.com.br/x', title: 'Diretório', snippet: '' },
      { url: 'https://www.instagram.com/outra', title: 'Rede', snippet: '' },
      { url: 'https://saude.pr.gov.br/', title: 'Governo', snippet: '' },
      { url: 'https://sorrisobonito.com.br/', title: 'Sorriso Bonito', snippet: 'Clínica' },
      { url: 'https://sorrisobonito.com.br/implantes', title: 'Sorriso Bonito 2', snippet: '' },
      { url: 'https://odontovida.com.br/', title: 'Odonto Vida', snippet: '' },
      { url: 'ftp://odd.com.br/', title: 'Protocolo', snippet: '' },
    ];
    const candidates = filterCompetitorCandidates(hits, {
      companyDomain: 'www.clinicaexemplo.com.br',
      exclude: ['odontovida.com.br'],
    });
    expect(candidates.map((c) => [c.ref, c.domain])).toEqual([['C1', 'sorrisobonito.com.br']]);
  });

  it('consulta usa o que a empresa faz e onde atende', () => {
    expect(
      competitorSearchQuery({
        offering: 'Implante "dentário"',
        activity: null,
        city: 'Curitiba',
        uf: 'PR',
      }),
    ).toBe('Implante dentário em Curitiba PR');
    expect(
      competitorSearchQuery({ offering: null, activity: null, city: 'Curitiba', uf: 'PR' }),
    ).toBeNull();
  });
});

const base: InvestigationSnapshot = {
  siteUrl: 'https://clinicaexemplo.com.br',
  siteReachable: true,
  pages: [
    { url: 'https://clinicaexemplo.com.br', category: 'home', ok: true, contentHash: null },
    { url: 'https://clinicaexemplo.com.br/sobre', category: 'about', ok: true, contentHash: null },
  ],
  offerings: ['Implante dentário', 'Clareamento'],
  valueProposition: 'Atendimento humanizado em Curitiba',
  fonts: ['Montserrat'],
  colors: ['#0A6CFF', '#FFFFFF'],
  captureHashes: { desktop: null, mobile: null },
  signals: [],
  competitors: ['sorrisobonito.com.br'],
};

describe('detectChanges', () => {
  it('sem investigação anterior não há mudança', () => {
    expect(detectChanges(null, base)).toEqual([]);
  });

  it('aponta oferta nova, proposta, visual, sinal e concorrente em texto do sistema', () => {
    const kinds = detectChanges(base, {
      ...base,
      offerings: ['Implante dentário', 'Clareamento', 'Ortodontia invisível'],
      valueProposition: 'Tecnologia digital em implantes',
      fonts: ['Poppins'],
      colors: ['#111111', '#C8A24A', '#FFFFFF'],
      signals: ['Nova unidade no Batel'],
      competitors: ['sorrisobonito.com.br', 'odontovida.com.br'],
    }).map((change) => change.kind);
    expect(kinds).toEqual([
      'offering_added',
      'communication_changed',
      'visual_changed',
      'new_signal',
      'competitor_added',
    ]);
  });

  it('site fora do ar nesta coleta é temporário, não mudança nem página sumida', () => {
    const changes = detectChanges(base, {
      ...base,
      siteReachable: false,
      pages: [],
      offerings: [],
      fonts: [],
      colors: [],
    });
    expect(changes.map((change) => change.kind)).toEqual(['temporarily_unavailable']);
  });

  it('página que deixou de responder é temporária', () => {
    const changes = detectChanges(base, {
      ...base,
      pages: [base.pages[0]!, { ...base.pages[1]!, ok: false }],
    });
    expect(changes.map((change) => change.kind)).toEqual(['temporarily_unavailable']);
  });
});
