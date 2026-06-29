import { describe, expect, it } from 'vitest';
import { createInMemoryStore } from '../data/inMemoryStore.js';
import { estimateCostCny, generateProjectAppSpec, normalizeModelAppSpec, parseModelJson, SpecGenerationError } from './specAgent.js';

describe('estimateCostCny', () => {
  it('uses current per-million token pricing for supported providers', () => {
    expect(estimateCostCny('volcengine', 'doubao-seed-2-1-turbo-260628', 1_000_000, 1_000_000)).toBe(3);
    expect(estimateCostCny('deepseek', 'deepseek-v4-flash', 1_000_000, 1_000_000)).toBe(3);
    expect(estimateCostCny('deepseek', 'deepseek-v4-pro', 1_000_000, 1_000_000)).toBe(9);
  });
});

describe('normalizeModelAppSpec', () => {
  it('coerces loose model JSON into a valid AppSpec', () => {
    const spec = normalizeModelAppSpec(
      {
        id: 'project-1',
        ownerId: 'user-creator',
        name: '课程预约',
        prompt: '生成课程预约应用',
        status: 'spec_generating',
        target: 'web',
        createdAt: '2026-06-27T00:00:00.000Z',
        updatedAt: '2026-06-27T00:00:00.000Z'
      },
      {
        appName: '课程预约',
        appGoal: '让用户预约课程',
        targetUser: '会员',
        pages: [
          {
            name: '首页',
            purpose: '展示课程',
            sections: '展示课程并引导预约',
            actions: ['立即预约']
          }
        ],
        styleIntent: 'calm',
        acceptanceCriteria: '用户可以提交预约'
      }
    );

    expect(spec.pages[0]).toMatchObject({
      id: 'home',
      route: '/',
      sections: [
        {
          kind: 'hero',
          content: '展示课程并引导预约'
        }
      ],
      actions: [
        {
          label: '立即预约',
          type: 'submit'
        }
      ]
    });
    expect(spec.styleIntent).toMatchObject({
      tone: 'calm',
      layoutDensity: 'comfortable'
    });
    expect(spec.acceptanceCriteria).toEqual(['用户可以提交预约']);
  });
});

describe('parseModelJson', () => {
  it('extracts JSON from fenced or prefixed model text', () => {
    expect(parseModelJson('```json\n{"ok":true}\n```')).toEqual({ ok: true });
    expect(parseModelJson('Here is JSON:\n{"ok":true}\nThanks')).toEqual({ ok: true });
  });

  it('repairs common non-strict JSON wrappers from chat models', () => {
    expect(parseModelJson('```json\n{"appSpec":{"appName":"简历站",},}\n```')).toEqual({ appName: '简历站' });
    expect(parseModelJson('说明如下：\n{"data":{"appName":"作品集","pages":[]}}\n补充说明')).toEqual({ appName: '作品集', pages: [] });
  });
});

describe('generateProjectAppSpec', () => {
  it('uses one bounded repair call when the first model response is not valid JSON', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-27T00:00:00.000Z'));
    const project = await store.createProject({
      id: 'user-creator',
      email: 'creator@example.local',
      name: 'Creator',
      role: 'creator'
    }, {
      name: 'Repair JSON 项目',
      prompt: '生成一个个人简历网站，需要首页、经历和联系方式。',
      target: 'web'
    });
    const calls: string[] = [];

    const result = await generateProjectAppSpec(
      project,
      {
        provider: 'volcengine',
        apiKeyConfigured: true,
        model: 'doubao-seed-2-1-turbo-260628',
        budgetCny: 25
      },
      {
        async generateText(request) {
          calls.push(request.system);

          if (calls.length === 1) {
            return {
              text: '我将生成一个简历站，但这里不是 JSON。',
              model: 'doubao-seed-2-1-turbo-260628',
              usage: {
                inputTokens: 12,
                outputTokens: 20
              }
            };
          }

          return {
            text: JSON.stringify({
              appName: 'Repair JSON 项目',
              appGoal: '展示个人经历和联系方式',
              targetUser: '访客',
              pages: [
                {
                  id: 'home',
                  name: '首页',
                  route: '/',
                  purpose: '展示个人简介',
                  sections: ['个人介绍与经历'],
                  actions: ['联系我']
                }
              ],
              dataModels: [],
              integrations: [],
              styleIntent: { tone: 'calm', layoutDensity: 'comfortable' },
              constraints: [],
              nonGoals: [],
              acceptanceCriteria: ['访客可以了解个人信息']
            }),
            model: 'doubao-seed-2-1-turbo-260628',
            usage: {
              inputTokens: 22,
              outputTokens: 60
            }
          };
        }
      },
      store
    );

    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('JSON Repair Agent');
    expect(result.appSpec.spec.appName).toBe('Repair JSON 项目');
    expect(result.modelInvocation).toMatchObject({
      purpose: 'app_spec_repair',
      status: 'succeeded'
    });

    const invocations = await store.listRecentModelInvocations(2);
    expect(invocations).toEqual([
      expect.objectContaining({ purpose: 'app_spec_repair', status: 'succeeded' }),
      expect.objectContaining({ purpose: 'app_spec_generation', status: 'failed', errorType: 'MODEL_INVALID_JSON' })
    ]);
  });

  it('marks the AgentRun failed when model text cannot be parsed as JSON', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-27T00:00:00.000Z'));
    const project = await store.createProject({
      id: 'user-creator',
      email: 'creator@example.local',
      name: 'Creator',
      role: 'creator'
    }, {
      name: 'Bad JSON 项目',
      prompt: '生成一个课程预约应用',
      target: 'web'
    });

    await expect(generateProjectAppSpec(
      project,
      {
        provider: 'volcengine',
        apiKeyConfigured: true,
        model: 'doubao-seed-2-1-turbo-260628',
        budgetCny: 25
      },
      {
        async generateText() {
          return {
            text: 'not json',
            model: 'doubao-seed-2-1-turbo-260628',
            usage: {
              inputTokens: 1,
              outputTokens: 1
            }
          };
        }
      },
      store
    )).rejects.toBeInstanceOf(SpecGenerationError);

    const runs = await store.listRecentAgentRuns(1);
    expect(runs[0]).toMatchObject({
      status: 'failed',
      errorType: 'MODEL_INVALID_JSON'
    });
    const invocations = await store.listRecentModelInvocations(2);
    expect(invocations).toEqual([
      expect.objectContaining({ purpose: 'app_spec_repair', status: 'failed', errorType: 'MODEL_INVALID_JSON' }),
      expect.objectContaining({ purpose: 'app_spec_generation', status: 'failed', errorType: 'MODEL_INVALID_JSON' })
    ]);
    const reloadedProject = await store.getProjectById({
      id: 'user-creator',
      email: 'creator@example.local',
      name: 'Creator',
      role: 'creator'
    }, project.id);
    expect(reloadedProject?.status).toBe('draft');
  });

  it('converts provider timeouts into failed AgentRun state and safe MODEL_TIMEOUT errors', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-27T00:00:00.000Z'));
    const project = await store.createProject({
      id: 'user-creator',
      email: 'creator@example.local',
      name: 'Creator',
      role: 'creator'
    }, {
      name: 'Timeout 项目',
      prompt: '生成一个个人简历网站，需要首页、经历和联系方式。',
      target: 'web'
    });

    await expect(generateProjectAppSpec(
      project,
      {
        provider: 'volcengine',
        apiKeyConfigured: true,
        model: 'doubao-seed-2-1-turbo-260628',
        budgetCny: 25
      },
      {
        async generateText() {
          throw new Error('Volcengine request timed out after 60000ms');
        }
      },
      store
    )).rejects.toMatchObject({
      errorType: 'MODEL_TIMEOUT',
      statusCode: 504
    });

    const runs = await store.listRecentAgentRuns(1);
    expect(runs[0]).toMatchObject({
      status: 'failed',
      errorType: 'MODEL_TIMEOUT'
    });
    const invocations = await store.listRecentModelInvocations(1);
    expect(invocations[0]).toMatchObject({
      purpose: 'app_spec_generation',
      status: 'failed',
      errorType: 'MODEL_TIMEOUT'
    });
  });
});
