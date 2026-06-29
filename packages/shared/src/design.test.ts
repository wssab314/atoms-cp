import { describe, expect, it } from 'vitest';
import { designAgentOutputSchema, designProfileSchema } from './design.js';

describe('Design schemas', () => {
  it('accepts five structured design profile options', () => {
    const output = designAgentOutputSchema.parse({
      profiles: [
        {
          id: 'studio-minimal',
          name: 'Studio Minimal',
          description: 'Quiet, editorial layout for service businesses.',
          bestFor: '预约、服务和作品集类 Web 应用',
          designTokens: {
            colors: {
              background: '#f7f8f6',
              foreground: '#18201f',
              primary: '#1e6f62',
              secondary: '#dfe8e4',
              muted: '#65716e',
              border: '#dce4e0',
              accent: '#b96f4a'
            },
            typography: {
              headingFont: 'Inter',
              bodyFont: 'Inter',
              scale: 'comfortable'
            },
            radius: 'md',
            shadow: 'subtle',
            density: 'balanced'
          },
          layoutGuidelines: ['Strong hero section', 'Clear CTA'],
          componentGuidelines: ['Use concise cards'],
          previewDescription: 'A restrained service landing page.'
        },
        {
          id: 'operator-dashboard',
          name: 'Operator Dashboard',
          description: 'Dense management view for operational users.',
          bestFor: 'Admin、CRM 和运营后台',
          designTokens: {
            colors: {
              background: '#f6f7f8',
              foreground: '#171b1d',
              primary: '#2f5f9f',
              secondary: '#e6ebf2',
              muted: '#68717a',
              border: '#d8dee6',
              accent: '#6c8a3f'
            },
            typography: {
              headingFont: 'Inter',
              bodyFont: 'Inter',
              scale: 'compact'
            },
            radius: 'sm',
            shadow: 'none',
            density: 'compact'
          },
          layoutGuidelines: ['Use scan-friendly tables'],
          componentGuidelines: ['Keep controls predictable'],
          previewDescription: 'A utilitarian operations screen.'
        },
        {
          id: 'product-launch',
          name: 'Product Launch',
          description: 'Product-forward launch rhythm with clear conversion.',
          bestFor: '产品官网、SaaS 和活动报名',
          designTokens: {
            colors: {
              background: '#f8f8f6',
              foreground: '#161a22',
              primary: '#315cf6',
              secondary: '#eef3ff',
              muted: '#667085',
              border: '#e7e8ec',
              accent: '#20b26b'
            },
            typography: {
              headingFont: 'Inter',
              bodyFont: 'Inter',
              scale: 'comfortable'
            },
            radius: 'lg',
            shadow: 'subtle',
            density: 'balanced'
          },
          layoutGuidelines: ['Lead with offer clarity'],
          componentGuidelines: ['Use readable product cards'],
          previewDescription: 'A product launch page.'
        },
        {
          id: 'quiet-personal',
          name: 'Quiet Personal',
          description: 'Calm personal profile and portfolio layout.',
          bestFor: '个人网站、作品集和简历',
          designTokens: {
            colors: {
              background: '#f8f8f6',
              foreground: '#171a1f',
              primary: '#315cf6',
              secondary: '#eef3ff',
              muted: '#667085',
              border: '#e7e8ec',
              accent: '#315cf6'
            },
            typography: {
              headingFont: 'Inter',
              bodyFont: 'Inter',
              scale: 'comfortable'
            },
            radius: 'lg',
            shadow: 'subtle',
            density: 'balanced'
          },
          layoutGuidelines: ['Lead with identity'],
          componentGuidelines: ['Use portfolio cards'],
          previewDescription: 'A calm personal website.'
        },
        {
          id: 'content-hub',
          name: 'Content Hub',
          description: 'Structured reading and resources layout.',
          bestFor: '博客、知识库和资源中心',
          designTokens: {
            colors: {
              background: '#faf9f6',
              foreground: '#1d1c19',
              primary: '#4f46e5',
              secondary: '#eeecff',
              muted: '#6f6a63',
              border: '#e7e1d8',
              accent: '#c26a2e'
            },
            typography: {
              headingFont: 'Inter',
              bodyFont: 'Inter',
              scale: 'spacious'
            },
            radius: 'md',
            shadow: 'subtle',
            density: 'airy'
          },
          layoutGuidelines: ['Use content hierarchy'],
          componentGuidelines: ['Use article cards'],
          previewDescription: 'A calm content hub.'
        }
      ]
    });

    expect(output.profiles).toHaveLength(5);
    expect(designProfileSchema.parse(output.profiles[0]).designTokens.colors.primary).toBe('#1e6f62');
  });
});
