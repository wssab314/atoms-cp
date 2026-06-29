import { describe, expect, it } from 'vitest';
import { applyDirectTextPatch } from './directTextPatch.js';

describe('applyDirectTextPatch', () => {
  it('replaces direct JSX text for a matching data-ai-id', () => {
    const patched = applyDirectTextPatch({
      source: '<button className="primary-action" type="button" data-ai-id="home.actions.submit-booking">{"提交预约"}</button>',
      aiId: 'home.actions.submit-booking',
      text: '立即预约'
    });

    expect(patched).toBe(
      '<button className="primary-action" type="button" data-ai-id="home.actions.submit-booking">{"立即预约"}</button>'
    );
  });

  it('escapes text through JSON string encoding', () => {
    const patched = applyDirectTextPatch({
      source: '<h1 data-ai-id="home.hero.title">{"旧标题"}</h1>',
      aiId: 'home.hero.title',
      text: '预约 "高效" 训练'
    });

    expect(patched).toContain('{"预约 \\"高效\\" 训练"}');
  });

  it('replaces multiline heading content while preserving the ai-id marker', () => {
    const patched = applyDirectTextPatch({
      source: [
        '<h1 data-ai-id="home.about.title">',
        '  你好，我是 {personal.name}。',
        '  <br />',
        '  <span className="hero-sub">{personal.title}</span>',
        '</h1>'
      ].join('\n'),
      aiId: 'home.about.title',
      text: '关于林知远'
    });

    expect(patched).toBe('<h1 data-ai-id="home.about.title">{"关于林知远"}</h1>');
  });

  it('throws when the matching element is not direct editable text', () => {
    expect(() =>
      applyDirectTextPatch({
        source: '<section data-ai-id="home.hero"><h1>{"旧标题"}</h1></section>',
        aiId: 'home.hero',
        text: '立即预约'
      })
    ).toThrow(/direct text/i);
  });

  it('rejects layout containers even when they have a matching ai-id', () => {
    expect(() =>
      applyDirectTextPatch({
        source: '<header data-ai-id="home.navbar.title"><nav><a>首页</a></nav></header>',
        aiId: 'home.navbar.title',
        text: '新导航'
      })
    ).toThrow(/direct text/i);
  });

  it('throws when one ai-id matches multiple direct text elements', () => {
    expect(() =>
      applyDirectTextPatch({
        source:
          '<main><h1 data-ai-id="home.hero.title">{"旧标题"}</h1><h2 data-ai-id="home.hero.title">{"副标题"}</h2></main>',
        aiId: 'home.hero.title',
        text: '新标题'
      })
    ).toThrow(/direct text/i);
  });
});
