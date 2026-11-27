import { describe, expect, it } from 'vitest';
import { caminhosDaInstalacao, URL_DO_APP } from '../src/config';
import { classificarEndereco, quadroPodeIr } from '../src/navegacao';

/** A janela só mostra o app local; o resto vai para o navegador do sistema ou é recusado. */
describe('classificarEndereco', () => {
  it('reconhece só a origem exata do app', () => {
    expect(URL_DO_APP).toBe('http://127.0.0.1:3210/');
    expect(classificarEndereco('http://127.0.0.1:3210/')).toBe('app');
    expect(classificarEndereco('http://127.0.0.1:3210/empresas/1?aba=evidencias#x')).toBe('app');
  });

  it('manda para fora o que é outro endereço local ou outra porta', () => {
    expect(classificarEndereco('http://localhost:3210/')).toBe('externo');
    expect(classificarEndereco('https://127.0.0.1:3210/')).toBe('externo');
    expect(classificarEndereco('http://127.0.0.1:3000/')).toBe('externo');
  });

  it('abre sites e e-mail no sistema', () => {
    expect(classificarEndereco('https://www.exemplo.com.br/sobre')).toBe('externo');
    expect(classificarEndereco('http://exemplo.com')).toBe('externo');
    expect(classificarEndereco('mailto:contato@exemplo.com.br')).toBe('externo');
  });

  it('recusa esquemas perigosos, endereços com senha e lixo', () => {
    for (const endereco of [
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'ms-msdt:/id PCWDiagnostic',
      'data:text/html,<p>oi</p>',
      'chrome://settings',
      'https://usuario:senha@exemplo.com/',
      'não é endereço',
      '',
    ]) {
      expect(classificarEndereco(endereco), endereco).toBe('recusado');
    }
  });
});

describe('quadroPodeIr', () => {
  it('aceita quadros em branco e do próprio app, nada de fora', () => {
    expect(quadroPodeIr('about:blank')).toBe(true);
    expect(quadroPodeIr('about:srcdoc')).toBe(true);
    expect(quadroPodeIr('http://127.0.0.1:3210/configuracoes/email/previa?v=abc')).toBe(true);
    expect(quadroPodeIr('https://exemplo.com/')).toBe(false);
  });
});

describe('caminhosDaInstalacao', () => {
  it('acha a instalação na pasta de cima do executável', () => {
    const caminhos = caminhosDaInstalacao('D:\\Prospector\\programa\\Prospector.exe');
    expect(caminhos.raiz).toBe('D:\\Prospector');
    expect(caminhos.servidor).toBe('D:\\Prospector\\app\\apps\\web\\server.js');
    expect(caminhos.web).toBe('D:\\Prospector\\app\\apps\\web');
    expect(caminhos.pid).toBe('D:\\Prospector\\servidor.pid');
    expect(caminhos.dadosDaJanela).toBe('D:\\Prospector\\dados-da-janela');
    expect(caminhos.marca).toBe('D:\\Prospector\\.prospector-instalacao');
    // Dados do usuário fora da pasta do programa: atualizar ou desinstalar não os apaga.
    expect(caminhos.dados).toBe('D:\\Prospector-dados');
    expect(caminhosDaInstalacao('E:\\Apps\\Prospector\\programa\\Prospector.exe').dados).toBe(
      'E:\\Apps\\Prospector-dados',
    );
  });
});
