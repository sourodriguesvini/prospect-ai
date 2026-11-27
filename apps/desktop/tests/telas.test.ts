import { describe, expect, it } from 'vitest';
import { escaparHtml, telaDeCarregamento, telaDeErro } from '../src/telas';

function html(endereco: string): string {
  const prefixo = 'data:text/html;charset=utf-8,';
  expect(endereco.startsWith(prefixo)).toBe(true);
  return decodeURIComponent(endereco.slice(prefixo.length));
}

describe('telas da janela', () => {
  it('carregamento em pt-BR, sem script', () => {
    const pagina = html(telaDeCarregamento());
    expect(pagina).toContain('<html lang="pt-BR">');
    expect(pagina).toContain('Abrindo o Prospector');
    expect(pagina).toContain("default-src 'none'");
    expect(pagina).not.toMatch(/<script/i);
  });

  it('erro escapa o texto e oferece tentar de novo apontando para o app', () => {
    const pagina = html(
      telaDeErro({
        titulo: 'Porta <3210> ocupada',
        mensagem: 'Programa "x" & <script>alert(1)</script>\nsegunda linha',
        detalhe: "Detalhes em D:\\Prospector\\logs\\servidor-erros.log'",
      }),
    );
    expect(pagina).toContain('Porta &lt;3210&gt; ocupada');
    expect(pagina).toContain('&lt;script&gt;alert(1)&lt;/script&gt;<br>segunda linha');
    expect(pagina).not.toMatch(/<script/i);
    expect(pagina).toContain('href="http://127.0.0.1:3210/"');
    expect(pagina).toContain('Tentar de novo');
    expect(pagina).toContain('servidor-erros.log&#39;');
  });

  it('erro sem botão quando não adianta tentar', () => {
    const pagina = html(telaDeErro({ titulo: 'T', mensagem: 'M', podeTentarDeNovo: false }));
    expect(pagina).not.toContain('Tentar de novo');
  });

  it('escaparHtml cobre os cinco caracteres especiais', () => {
    expect(escaparHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
});
