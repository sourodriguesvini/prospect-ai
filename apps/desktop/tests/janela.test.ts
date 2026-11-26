import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atalhosPedidos, criarAtalhos } from '../src/atalhos';
import { lerEstado, limitesVisiveis } from '../src/estado-da-janela';
import { ambienteDoServidor, mensagemDePortaOcupada } from '../src/servidor';

describe('estado da janela', () => {
  it('lê o que foi salvo e descarta valores estranhos', () => {
    expect(
      lerEstado(
        '{"limites":{"x":10.4,"y":20,"width":1200,"height":800},"maximizada":true,"zoom":1}',
      ),
    ).toEqual({ limites: { x: 10, y: 20, width: 1200, height: 800 }, maximizada: true, zoom: 1 });
    expect(lerEstado('{"limites":{"x":"a"},"maximizada":"sim","zoom":99}')).toEqual({
      maximizada: false,
      zoom: 0,
    });
    expect(lerEstado('não é json')).toEqual({ maximizada: false, zoom: 0 });
    expect(lerEstado(null)).toEqual({ maximizada: false, zoom: 0 });
  });

  it('só reaproveita a posição se a janela aparecer numa tela de agora', () => {
    const tela = { x: 0, y: 0, width: 1920, height: 1040 };
    const limites = { x: 100, y: 100, width: 1200, height: 800 };
    expect(limitesVisiveis(limites, [tela])).toEqual(limites);
    // Monitor da direita desligado.
    expect(limitesVisiveis({ ...limites, x: 2100 }, [tela])).toBeUndefined();
    // Menor que o mínimo.
    expect(limitesVisiveis({ ...limites, width: 400 }, [tela])).toBeUndefined();
    expect(limitesVisiveis(undefined, [tela])).toBeUndefined();
  });
});

describe('atalhos', () => {
  let pasta: string | null = null;
  afterEach(() => {
    if (pasta) rmSync(pasta, { recursive: true, force: true });
    pasta = null;
  });

  it('só aceita caminhos absolutos chamados Prospector.lnk', () => {
    expect(atalhosPedidos(['--outra'])).toBeNull();
    expect(
      atalhosPedidos([
        '--criar-atalho',
        'C:\\Users\\x\\Desktop\\Prospector.lnk',
        '--criar-atalho',
        'relativo\\Prospector.lnk',
        '--criar-atalho',
        'C:\\Windows\\System32\\cmd.lnk',
        '--criar-atalho',
      ]),
    ).toEqual(['C:\\Users\\x\\Desktop\\Prospector.lnk']);
  });

  it('cria a pasta e grava cada atalho com o identificador do programa', () => {
    pasta = mkdtempSync(join(tmpdir(), 'prospector-atalhos-'));
    const gravados: Array<{ caminho: string; appUserModelId: string; target: string }> = [];
    const ok = criarAtalhos(
      [join(pasta, 'Menu', 'Prospector.lnk')],
      {
        executavel: 'D:\\Prospector\\programa\\Prospector.exe',
        pastaDeTrabalho: 'D:\\Prospector',
        icone: 'D:\\Prospector\\programa\\Prospector.exe',
        idDoApp: 'Prospector.Desktop',
      },
      (caminho, opcoes) => {
        gravados.push({ caminho, appUserModelId: opcoes.appUserModelId, target: opcoes.target });
        return true;
      },
    );
    expect(ok).toBe(true);
    expect(gravados).toEqual([
      {
        caminho: join(pasta, 'Menu', 'Prospector.lnk'),
        appUserModelId: 'Prospector.Desktop',
        target: 'D:\\Prospector\\programa\\Prospector.exe',
      },
    ]);
  });

  it('falha se nada foi pedido ou se um atalho não gravou', () => {
    const dados = { executavel: 'a', pastaDeTrabalho: 'b', icone: 'c', idDoApp: 'd' };
    expect(criarAtalhos([], dados, () => true)).toBe(false);
    pasta = mkdtempSync(join(tmpdir(), 'prospector-atalhos-'));
    expect(criarAtalhos([join(pasta, 'Prospector.lnk')], dados, () => false)).toBe(false);
  });
});

describe('servidor', () => {
  it('ambiente sem variáveis do Electron, com porta e host fixos', () => {
    const env = ambienteDoServidor({
      PATH: 'C:\\x',
      ELECTRON_RUN_AS_NODE: '1',
      electron_algo: 'y',
      PORT: '9999',
      HOSTNAME: '0.0.0.0',
    });
    expect(env).toEqual({
      PATH: 'C:\\x',
      PORT: '3210',
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
    });
  });

  it('porta ocupada diz quem ocupa quando dá para saber', () => {
    expect(mensagemDePortaOcupada({ pid: 42, nome: 'python.exe', linha: '' }).mensagem).toContain(
      'python.exe, processo 42',
    );
    const semDono = mensagemDePortaOcupada(null);
    expect(semDono.titulo).toBe('A porta 3210 está ocupada');
    expect(semDono.detalhe).toBe('O Prospector não encerra outros programas.');
  });
});
