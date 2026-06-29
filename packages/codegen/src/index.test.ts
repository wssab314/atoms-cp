import { describe, expect, it } from 'vitest';
import type { AppSpec } from '@atoms-cp/shared';
import { createDefaultDesignProfiles, generateReactViteProject } from './index.js';

const appSpec: AppSpec = {
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
        },
        {
          id: 'coaches',
          kind: 'list',
          title: '选择合适的教练',
          content: '按训练目标查看教练和课程。'
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
  integrations: [],
  styleIntent: {
    tone: 'calm premium',
    primaryColor: '#1e6f62',
    layoutDensity: 'comfortable'
  },
  constraints: ['不要暴露任何 secret'],
  nonGoals: ['不实现支付'],
  acceptanceCriteria: ['用户可以提交预约']
};

describe('M3 code generation', () => {
  it('creates five deterministic production design profiles from an AppSpec', () => {
    const profiles = createDefaultDesignProfiles(appSpec);

    expect(profiles).toHaveLength(5);
    expect(profiles[0]).toMatchObject({
      id: 'studio-minimal',
      designTokens: {
        colors: {
          primary: '#1e6f62'
        }
      }
    });
    expect(profiles.map((profile) => profile.id)).toEqual([
      'studio-minimal',
      'quiet-personal',
      'product-launch',
      'operator-dashboard',
      'content-hub'
    ]);
  });

  it('prioritizes the quiet personal template for personal websites', () => {
    const profiles = createDefaultDesignProfiles({
      ...appSpec,
      appName: '个人网站',
      appGoal: '展示个人介绍、作品集和联系方式',
      targetUser: '个人访客和招聘方',
      pages: [
        {
          ...appSpec.pages[0]!,
          purpose: '展示个人主页、作品和简历',
          sections: [
            {
              id: 'hero',
              kind: 'hero',
              title: '你好，我是独立设计师',
              content: '展示个人介绍和精选作品集。'
            }
          ]
        }
      ],
      dataModels: []
    });

    expect(profiles[0]?.id).toBe('quiet-personal');
  });

  it('renders a complete React/Vite project with ai ids and manifest entries', () => {
    const designProfile = createDefaultDesignProfiles(appSpec)[0];
    expect(designProfile).toBeDefined();
    const generated = generateReactViteProject({
      appSpec,
      designProfile: designProfile!,
      projectName: '私教预约系统'
    });

    expect(generated.files.map((file) => file.path)).toEqual([
      'package.json',
      'pnpm-workspace.yaml',
      'index.html',
      'tsconfig.json',
      'vite.config.ts',
      'src/main.tsx',
      'src/preview-inspector.ts',
      'src/App.tsx',
      'src/styles.css',
      'ai-manifest.json'
    ]);
    const mainFile = generated.files.find((file) => file.path === 'src/main.tsx');
    const appFile = generated.files.find((file) => file.path === 'src/App.tsx');
    const inspectorFile = generated.files.find((file) => file.path === 'src/preview-inspector.ts');
    expect(mainFile?.content).toContain("import './preview-inspector'");
    expect(inspectorFile?.content).toContain('atoms-cp:preview-element-selected');
    expect(inspectorFile?.content).toContain('INSPECTOR_ENABLE');
    expect(inspectorFile?.content).toContain('INSPECTOR_DISABLE');
    expect(inspectorFile?.content).toContain('INSPECTOR_HIGHLIGHT');
    expect(inspectorFile?.content).toContain("searchParams.get('inspector') === '1'");
    expect(inspectorFile?.content).toContain('window.parent.postMessage(messageForElement');
    expect(inspectorFile?.content).not.toContain('.value');
    expect(appFile?.content).toContain('data-ai-id="home.hero.title"');
    expect(appFile?.content).toContain('data-ai-id="home.actions.book"');
    expect(generated.manifest.entries['home.hero.title']).toMatchObject({
      file: 'src/App.tsx',
      elementType: 'heading',
      editable: ['text', 'className', 'styleTokens']
    });
    expect(generated.files.some((file) => file.path.includes('.env'))).toBe(false);
  });

  it('includes enough TypeScript configuration for the worker to run pnpm build', () => {
    const [designProfile] = createDefaultDesignProfiles(appSpec);
    const generated = generateReactViteProject({
      appSpec,
      designProfile: designProfile!,
      projectName: '私教预约系统'
    });
    const tsconfig = generated.files.find((file) => file.path === 'tsconfig.json');
    const packageJson = generated.files.find((file) => file.path === 'package.json');

    expect(tsconfig?.content).toContain('"jsx": "react-jsx"');
    expect(packageJson?.content).toContain('"@types/react"');
    expect(packageJson?.content).toContain('"@types/react-dom"');
  });

  it('allows the esbuild postinstall required by Vite in isolated worker builds', () => {
    const [designProfile] = createDefaultDesignProfiles(appSpec);
    const generated = generateReactViteProject({
      appSpec,
      designProfile: designProfile!,
      projectName: '私教预约系统'
    });
    const packageJson = JSON.parse(generated.files.find((file) => file.path === 'package.json')?.content ?? '{}');
    const pnpmWorkspace = generated.files.find((file) => file.path === 'pnpm-workspace.yaml');

    expect(packageJson.packageManager).toBe('pnpm@11.7.0');
    expect(pnpmWorkspace?.content).toContain('allowBuilds:');
    expect(pnpmWorkspace?.content).toContain('  esbuild: true');
  });

  it('uses relative Vite assets so previews work from the build subpath', () => {
    const [designProfile] = createDefaultDesignProfiles(appSpec);
    const generated = generateReactViteProject({
      appSpec,
      designProfile: designProfile!,
      projectName: '私教预约系统'
    });
    const viteConfig = generated.files.find((file) => file.path === 'vite.config.ts');

    expect(viteConfig?.content).toContain("base: './'");
  });

  it('adds a Supabase client module when public Supabase config is supplied', () => {
    const [designProfile] = createDefaultDesignProfiles(appSpec);
    const generated = generateReactViteProject({
      appSpec,
      designProfile: designProfile!,
      projectName: '私教预约系统',
      supabaseConfig: {
        supabaseUrl: 'https://demo.supabase.co',
        anonKey: 'public-anon-key'
      }
    });
    const packageJson = JSON.parse(generated.files.find((file) => file.path === 'package.json')?.content ?? '{}');
    const supabaseFile = generated.files.find((file) => file.path === 'src/lib/supabase.ts');

    expect(packageJson.dependencies['@supabase/supabase-js']).toBeDefined();
    expect(supabaseFile?.content).toContain("from '@supabase/supabase-js'");
    expect(supabaseFile?.content).toContain('VITE_SUPABASE_URL');
    expect(supabaseFile?.content).toContain('VITE_SUPABASE_ANON_KEY');
    expect(supabaseFile?.content).not.toContain('service-role-secret');
    expect(generated.files.some((file) => file.path.includes('.env'))).toBe(false);
  });
});
