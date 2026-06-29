import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { beforeEach, vi } from 'vitest';

const volcengineTestKeyFile = '/tmp/atoms-cp-test-volcengine-api-key';
const originalFetch = globalThis.fetch;

mkdirSync(dirname(volcengineTestKeyFile), { recursive: true });
writeFileSync(volcengineTestKeyFile, 'ark-test-key', { encoding: 'utf8', mode: 0o600 });

function parseChatBody(init?: RequestInit): {
  system: string;
  user: string;
} {
  try {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      messages?: Array<{ role?: string; content?: string }>;
    };

    return {
      system: body.messages?.find((message) => message.role === 'system')?.content ?? '',
      user: body.messages?.find((message) => message.role === 'user')?.content ?? ''
    };
  } catch {
    return {
      system: '',
      user: ''
    };
  }
}

function parseProjectInput(userMessage: string): { projectName: string; prompt: string } {
  try {
    const payload = JSON.parse(userMessage ?? '{}') as { projectName?: string; prompt?: string };

    return {
      projectName: payload.projectName?.trim() || '测试应用',
      prompt: payload.prompt?.trim() || '生成一个可发布的 Web 应用。'
    };
  } catch {
    return {
      projectName: '测试应用',
      prompt: '生成一个可发布的 Web 应用。'
    };
  }
}

function createVolcengineChatCompletion(init?: RequestInit): Response {
  const chat = parseChatBody(init);

  if (chat.system.includes('Selector Patch JSON')) {
    const parsedUser = JSON.parse(chat.user || '{}') as { instruction?: string };
    const instruction = parsedUser.instruction ?? '';
    const patchContent = /样式|颜色|字号|字体|背景|醒目|品牌蓝/i.test(instruction)
      ? { operation: 'update_style', instruction }
      : { operation: 'replace_text', text: '马上预约' };
    return new Response(JSON.stringify({
      model: 'doubao-seed-2-1-turbo-260628',
      choices: [{ message: { content: JSON.stringify(patchContent) } }],
      usage: { prompt_tokens: 30, completion_tokens: 8 }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { projectName, prompt } = parseProjectInput(chat.user);
  const isPersonal = /个人|作品|简历|主页|portfolio/i.test(`${projectName} ${prompt}`);
  const content = {
    appName: projectName,
    appGoal: prompt,
    targetUser: isPersonal ? '个人访客和潜在合作方' : '目标业务用户',
    pages: [
      {
        id: 'home',
        name: '首页',
        route: '/',
        purpose: isPersonal ? '展示个人介绍、作品和联系方式' : '展示核心价值和主要操作入口',
        sections: [
          {
            id: 'hero',
            kind: 'hero',
            title: projectName,
            content: prompt
          },
          {
            id: isPersonal ? 'portfolio' : 'primary-list',
            kind: 'list',
            title: isPersonal ? '精选内容' : '核心内容',
            content: isPersonal ? '展示代表作品、经历和联系方式。' : '展示用户最需要查看的信息。'
          }
        ],
        actions: [
          {
            id: 'primary-action',
            label: isPersonal ? '联系我' : '开始使用',
            type: 'submit'
          }
        ]
      }
    ],
    dataModels: [],
    integrations: [],
    styleIntent: {
      tone: 'calm',
      layoutDensity: 'comfortable'
    },
    constraints: ['不在前端暴露模型 API key'],
    nonGoals: [],
    acceptanceCriteria: [isPersonal ? '访客可以了解个人信息并查看作品' : '用户可以完成核心任务']
  };

  return new Response(JSON.stringify({
    model: 'doubao-seed-2-1-turbo-260628',
    choices: [{ message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 100, completion_tokens: 80 }
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

beforeEach(() => {
  vi.stubEnv('VOLCENGINE_API_KEY_FILE', process.env.VOLCENGINE_API_KEY_FILE ?? volcengineTestKeyFile);
  vi.stubGlobal('fetch', (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('https://ark.cn-beijing.volces.com/api/v3/chat/completions')) {
      return createVolcengineChatCompletion(init);
    }

    return originalFetch(url, init);
  }) as typeof fetch);
});
