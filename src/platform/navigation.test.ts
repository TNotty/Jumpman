// navigation.ts の通常ビルド経路(window.open呼び出し)が、GitHub Pagesのようなサブパス配信でも
// 404にならないルート相対でないURL('/editor.html'ではなく'./editor.html'等)を使っていることを検証する。
// window はこのプロジェクトのvitest環境(node、DOM無し)には存在しないため、テスト内でスタブする。
// isSinglePageBuild はモジュールのトップレベルで import.meta.env.VITE_EMBED_ASSETS から決まるため、
// (npm testはVITE_EMBED_ASSETSを設定せずに実行される=通常ビルド相当の分岐になる)このテストは
// 常に「通常ビルド経路(window.openを使う側)」を検証する。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openEditor, openGameDraft, openTerrainEditor } from './navigation';

describe('navigation(通常ビルド経路: window.openで開くURL)', () => {
  let openMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openMock = vi.fn();
    vi.stubGlobal('window', {
      open: openMock,
      location: { hash: '', reload: vi.fn() },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('openEditor はルート絶対パス(先頭/)でなく相対パスでwindow.openを呼ぶ', () => {
    openEditor();
    expect(openMock).toHaveBeenCalledTimes(1);
    const [url, target] = openMock.mock.calls[0] as [string, string];
    expect(url).toBe('./editor.html');
    expect(url.startsWith('/')).toBe(false);
    expect(target).toBe('_blank');
  });

  it('openTerrainEditor はルート絶対パス(先頭/)でなく相対パスでwindow.openを呼ぶ', () => {
    openTerrainEditor();
    expect(openMock).toHaveBeenCalledTimes(1);
    const [url] = openMock.mock.calls[0] as [string, string];
    expect(url).toBe('./terrain.html');
    expect(url.startsWith('/')).toBe(false);
  });

  it('openGameDraft はルート絶対パス(先頭/)でなく相対パスでwindow.openを呼ぶ(?stage=draft付き)', () => {
    openGameDraft();
    expect(openMock).toHaveBeenCalledTimes(1);
    const [url] = openMock.mock.calls[0] as [string, string];
    expect(url).toBe('./index.html?stage=draft');
    expect(url.startsWith('/')).toBe(false);
  });
});
