import { describe, expect, it } from 'vitest';
import { appSpecRecordSchema, appSpecSchema, updateAppSpecInputSchema } from './appSpec.js';

describe('AppSpec schemas', () => {
  it('accepts the minimum structured app specification', () => {
    const spec = appSpecSchema.parse({
      appName: '私教预约系统',
      appGoal: '让会员查看课程并提交预约',
      targetUser: '健身工作室会员',
      pages: [
        {
          id: 'home',
          name: '首页',
          route: '/',
          purpose: '展示课程和主要预约入口',
          sections: [
            {
              id: 'hero',
              kind: 'hero',
              title: '预约你的下一节私教课',
              content: '查看教练、课程和可预约时间。'
            }
          ],
          actions: [
            {
              id: 'book',
              label: '立即预约',
              type: 'submit'
            }
          ]
        }
      ],
      dataModels: [
        {
          name: 'Booking',
          fields: [
            {
              name: 'memberName',
              type: 'string',
              required: true
            }
          ]
        }
      ],
      styleIntent: {
        tone: 'calm',
        layoutDensity: 'comfortable'
      },
      acceptanceCriteria: ['用户可以提交预约']
    });

    expect(spec.pages[0]?.route).toBe('/');
    expect(spec.integrations).toEqual([]);
  });

  it('rejects specs without pages', () => {
    expect(() =>
      appSpecSchema.parse({
        appName: '无页面应用',
        appGoal: '测试',
        targetUser: '测试用户',
        pages: [],
        styleIntent: {
          tone: 'calm',
          layoutDensity: 'comfortable'
        },
        acceptanceCriteria: ['至少一个验收条件']
      })
    ).toThrow();
  });

  it('accepts persisted AppSpec records with validation state', () => {
    const record = appSpecRecordSchema.parse({
      id: 'spec-1',
      projectId: 'project-1',
      sourceAgentRunId: 'agent-run-1',
      version: 1,
      status: 'validated',
      spec: {
        appName: '私教预约系统',
        appGoal: '让会员查看课程并提交预约',
        targetUser: '健身工作室会员',
        pages: [
          {
            id: 'home',
            name: '首页',
            route: '/',
            purpose: '展示课程和主要预约入口',
            sections: [
              {
                id: 'hero',
                kind: 'hero',
                title: '预约你的下一节私教课',
                content: '查看教练、课程和可预约时间。'
              }
            ],
            actions: [
              {
                id: 'book',
                label: '立即预约',
                type: 'submit'
              }
            ]
          }
        ],
        styleIntent: {
          tone: 'calm',
          layoutDensity: 'comfortable'
        },
        acceptanceCriteria: ['用户可以提交预约']
      },
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:00.000Z'
    });

    expect(record.status).toBe('validated');
  });

  it('accepts AppSpec update input with a complete spec payload', () => {
    const parsed = updateAppSpecInputSchema.safeParse({
      spec: {
        appName: '私教预约系统',
        appGoal: '更新后的预约目标',
        targetUser: '健身工作室会员',
        pages: [
          {
            id: 'home',
            name: '首页',
            route: '/',
            purpose: '展示课程和主要预约入口',
            sections: [
              {
                id: 'hero',
                kind: 'hero',
                title: '预约你的下一节私教课',
                content: '查看教练、课程和可预约时间。'
              }
            ],
            actions: [
              {
                id: 'book',
                label: '立即预约',
                type: 'submit'
              }
            ]
          }
        ],
        styleIntent: {
          tone: 'calm',
          layoutDensity: 'comfortable'
        },
        acceptanceCriteria: ['用户可以提交预约']
      }
    });

    expect(parsed.success).toBe(true);
  });
});
