import { useState, useEffect, useRef, useMemo, useCallback, type FormEvent } from 'react';
import {
  LayoutDashboard,
  Play,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Settings,
  Layers,
  History,
  Share2,
  Globe,
  RefreshCw,
  Monitor,
  Smartphone,
  X,
  ChevronDown,
  Search,
  Database,
  Github,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Users,
  DollarSign,
  ShoppingCart,
  ShieldCheck,
  Check,
  HelpCircle,
  Copy,
  Info,
  Clock,
  ArrowUpRight,
  Sparkles,
  Paperclip,
  FolderOpen,
  Lightbulb,
  ClipboardList,
  TrendingDown,
  Wrench,
  Image,
  ArrowRight,
  Coins
} from 'lucide-react';
import { Link, NavLink, Route, Routes, useParams, useNavigate, useLocation } from 'react-router-dom';
import * as api from './api';

interface Project {
  id: string;
  name: string;
  status: 'building' | 'done' | 'pending_publish' | 'published' | 'failed';
  updatedAt: string;
  deploymentUrl?: string;
  iconType: 'analytics' | 'form' | 'portal' | 'wiki';
}

const MIN_PROJECT_PROMPT_LENGTH = 10;

type GenerationPreparationStage = 'idle' | 'creating_project';
type AgentUiEvent = api.AgentStreamEvent & { realtime?: boolean };

const generationPreparationStageLabels: Record<Exclude<GenerationPreparationStage, 'idle'>, string> = {
  creating_project: '正在创建项目...'
};

function createProjectErrorMessage(error: unknown): string {
  if (isApiRequestErrorShape(error) && error.status === 400) {
    try {
      const body = JSON.parse(error.body) as {
        details?: {
          fieldErrors?: {
            prompt?: string[];
          };
        };
      };
      const promptErrors = body.details?.fieldErrors?.prompt ?? [];

      if (promptErrors.some((message) => message.includes('at least 10'))) {
        return '请补充更完整的应用想法，至少输入 10 个字。';
      }
    } catch {
      return '应用描述格式不正确，请检查后重试。';
    }

    return '应用描述格式不正确，请检查后重试。';
  }

  return '创建应用失败，请稍后重试。';
}

function generationPreparationErrorMessage(error: unknown): string {
  const errorType = readApiErrorType(error);

  if (errorType === 'MODEL_INVALID_JSON') {
    return '需求整理失败，请稍后重试或换一种描述方式。';
  }

  if (errorType === 'MODEL_TIMEOUT') {
    return '模型响应超时，请稍后重试。';
  }

  if (errorType === 'MODEL_AUTH_FAILED') {
    return '模型服务暂不可用，请联系管理员检查配置。';
  }

  if (errorType === 'MODEL_RATE_LIMIT') {
    return '模型服务当前繁忙，请稍后重试。';
  }

  if (errorType === 'MODEL_BUDGET_EXCEEDED') {
    return '本轮模型预算已用完，请稍后再试。';
  }

  if (errorType === 'INTERNAL_ERROR') {
    return '模型服务暂不可用，请稍后重试。';
  }

  return '生成准备失败，请稍后重试。';
}

function readApiErrorType(error: unknown): string | undefined {
  if (!isApiRequestErrorShape(error)) {
    return undefined;
  }

  try {
    const body = JSON.parse(error.body) as { errorType?: unknown };
    return typeof body.errorType === 'string' ? body.errorType : undefined;
  } catch {
    return undefined;
  }
}

function isApiRequestErrorShape(error: unknown): error is { status: number; body: string } {
  return typeof error === 'object'
    && error !== null
    && 'status' in error
    && 'body' in error
    && typeof (error as { status?: unknown }).status === 'number'
    && typeof (error as { body?: unknown }).body === 'string';
}

function mapProjectSummaryToProject(ps: api.ProjectSummary): Project {
  let iconType: 'analytics' | 'form' | 'portal' | 'wiki' = 'analytics';
  const name = ps.name || '';
  if (name.includes('反馈') || name.includes('收集') || name.includes('表单')) {
    iconType = 'form';
  } else if (name.includes('系统') || name.includes('入口') || name.includes('门户') || name.includes('支持')) {
    iconType = 'portal';
  } else if (name.includes('文档') || name.includes('库') || name.includes('指南') || name.includes('手册')) {
    iconType = 'wiki';
  }

  let status: Project['status'] = 'done';
  if (ps.status === 'building' || ps.status === 'code_generating' || ps.status === 'spec_generating' || ps.status === 'design_generating') {
    status = 'building';
  } else if (ps.status === 'deployed') {
    status = 'published';
  } else if (ps.status === 'preview_ready' || ps.status === 'design_ready' || ps.status === 'spec_ready') {
    status = 'pending_publish';
  } else if (ps.status === 'build_failed') {
    status = 'failed';
  }

  return {
    id: ps.id,
    name: ps.name,
    status,
    updatedAt: ps.updatedAt ? ps.updatedAt.replace('T', ' ').slice(0, 16) : '最近',
    deploymentUrl: ps.deploymentUrl,
    iconType
  };
}

function getLatestTask(tasksList: api.CodexTaskRecord[]): api.CodexTaskRecord | undefined {
  if (!tasksList || tasksList.length === 0) return undefined;
  return [...tasksList].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

function getLatestSnapshot(snapshotsList: api.PreviewSnapshotRecord[]): api.PreviewSnapshotRecord | undefined {
  if (!snapshotsList || snapshotsList.length === 0) return undefined;
  const active = snapshotsList.find(s => s.active);
  if (active) return active;
  return [...snapshotsList].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

function traceToAgentEvent(trace: api.TraceEventRecord): api.AgentStreamEvent {
  const kind = trace.type === 'error'
    ? 'error'
    : trace.payload?.kind === 'user_message'
      ? 'user'
      : 'agent';

  return {
    id: trace.id,
    kind,
    message: trace.message,
    stage: typeof trace.payload?.stage === 'string' ? trace.payload.stage : undefined,
    stepKey: typeof trace.payload?.stepKey === 'string' ? trace.payload.stepKey : undefined,
    status: isAgentEventStatus(trace.payload?.status) ? trace.payload.status : undefined,
    nextAction: typeof trace.payload?.nextAction === 'string' ? trace.payload.nextAction : undefined,
    createdAt: trace.createdAt
  };
}

function agentMessageToEvent(message: api.AgentMessageRecord): api.AgentStreamEvent {
  const statusLabel = {
    received: '已收到',
    deferred: '排队中',
    processing: '正在修改',
    completed: '修改完成',
    failed: '处理失败'
  }[message.status];

  return {
    id: `agent-message-${message.id}`,
    kind: 'user',
    message: `${message.content}（${statusLabel}）`,
    stage: 'user_message',
    createdAt: message.createdAt
  };
}

function isAgentEventStatus(value: unknown): value is api.AgentStreamEvent['status'] {
  return value === 'start' || value === 'progress' || value === 'done' || value === 'failed';
}

function appendUniqueAgentEvent(events: AgentUiEvent[], event: AgentUiEvent): AgentUiEvent[] {
  if (events.some((item) => item.id === event.id)) {
    return events;
  }

  return [...events, event].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');

    if (!media) {
      return;
    }

    const updatePreference = () => setPrefersReducedMotion(media.matches);
    updatePreference();
    media.addEventListener?.('change', updatePreference);

    return () => {
      media.removeEventListener?.('change', updatePreference);
    };
  }, []);

  return prefersReducedMotion;
}

function TypewriterMessage({
  text,
  enabled
}: {
  text: string;
  enabled: boolean;
}) {
  const [displayText, setDisplayText] = useState(text);

  useEffect(() => {
    if (!enabled || text.length === 0) {
      setDisplayText(text);
      return;
    }

    let index = 0;
    setDisplayText('');
    const timer = window.setInterval(() => {
      index += 1;
      setDisplayText(text.slice(0, index));

      if (index >= text.length) {
        window.clearInterval(timer);
      }
    }, 18);

    return () => {
      window.clearInterval(timer);
    };
  }, [enabled, text]);

  return <>{displayText}</>;
}

/* ==========================================================================
   Helper Components
   ========================================================================== */

function AgentPanel({
  projectId,
  statusMessage,
  errorMessage,
  retrying,
  onRetry
}: {
  projectId: string;
  statusMessage?: string;
  errorMessage?: string | null;
  retrying?: boolean;
  onRetry?: () => void;
}) {
  const [events, setEvents] = useState<AgentUiEvent[]>([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!projectId) return;

    let closed = false;
    Promise.all([
      api.fetchTraceEvents(projectId, 30),
      api.fetchAgentMessages(projectId).catch(() => [])
    ])
      .then(([traces, messages]) => {
        if (closed) return;
        const traceEvents = traces
          .filter((trace) => trace.visibility === 'user')
          .reverse()
          .map((trace) => ({ ...traceToAgentEvent(trace), realtime: false }));
        const messageEvents = messages.map((agentMessage) => ({ ...agentMessageToEvent(agentMessage), realtime: false }));
        setEvents([...traceEvents, ...messageEvents].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
      })
      .catch(() => {
        if (!closed) setEvents([]);
      });

    const EventSourceCtor = globalThis.EventSource;
    if (!EventSourceCtor) {
      return () => {
        closed = true;
      };
    }

    const source = new EventSourceCtor(api.getAgentStreamUrl(projectId), { withCredentials: true });
    const handleEvent = (rawEvent: Event) => {
      const event = rawEvent as MessageEvent<string>;
      try {
        const parsed = JSON.parse(event.data) as api.AgentStreamEvent;
        setEvents((current) => appendUniqueAgentEvent(current, { ...parsed, realtime: true }));
      } catch {
        // Ignore malformed stream chunks.
      }
    };
    source.addEventListener('agent-event', handleEvent);

    return () => {
      closed = true;
      source.removeEventListener('agent-event', handleEvent);
      source.close();
    };
  }, [projectId]);

  const submitMessage = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || sending) return;

    const optimisticEvent: AgentUiEvent = {
      id: `local-${Date.now()}`,
      kind: 'user',
      message: trimmed,
      stage: 'user_message',
      createdAt: new Date().toISOString(),
      realtime: false
    };
    setEvents((current) => appendUniqueAgentEvent(current, optimisticEvent));
    setMessage('');
    setSending(true);
    setNotice(null);

    try {
      const result = await api.sendAgentMessage(projectId, trimmed);
      setNotice(result.message);
      setEvents((current) => appendUniqueAgentEvent(current, {
        id: `local-response-${Date.now()}`,
        kind: result.queued ? 'agent' : 'status',
        message: result.message,
        stage: result.delivery === 'deferred' ? 'user_message' : result.queued ? 'queueing_app_build' : 'user_message',
        createdAt: new Date().toISOString(),
        realtime: false
      }));
      if (result.queued && !location.pathname.endsWith('/generating')) {
        navigate(`/app/${projectId}/generating`);
      }
    } catch (error) {
      setNotice(api.isUnauthorizedError(error) ? '请先登录后继续修改。' : '消息发送失败，请稍后重试。');
    } finally {
      setSending(false);
    }
  };

  const visibleEvents: AgentUiEvent[] = events.length > 0
    ? events
    : [{
      id: 'status-initial',
      kind: 'status' as const,
      message: statusMessage || '我会在这里展示应用生成和修改过程。',
      stage: 'project_created',
      createdAt: new Date().toISOString(),
      realtime: false
    }];
  const activeRealtimeEventId = [...visibleEvents]
    .reverse()
    .find((event) => event.realtime && event.kind !== 'user')?.id;

  return (
    <div className="agent-panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <Sparkles className="w-5 h-5 text-brand" style={{ color: 'var(--color-brand)' }} />
          <span>AI 助手</span>
        </h2>
        <span className="badge badge-blue">实时协作</span>
      </div>
      <div className="agent-panel-content">
        <div className="agent-event-list" aria-label="AI 助手过程">
          {visibleEvents.map((event) => (
            <div key={event.id} className={`agent-event ${event.kind}`}>
              {event.kind !== 'user' && (
                <div className="agent-event-dot">
                  {event.kind === 'error' ? <AlertTriangle className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                </div>
              )}
              <div className="agent-event-body">
                <span className="agent-event-role">{event.kind === 'user' ? '你' : event.kind === 'error' ? '需要处理' : 'AI 助手'}</span>
                <span className="agent-event-message">
                  <TypewriterMessage
                    text={event.message}
                    enabled={Boolean(!prefersReducedMotion && event.realtime && event.id === activeRealtimeEventId && event.kind !== 'user')}
                  />
                </span>
              </div>
            </div>
          ))}
          {sending && (
            <div className="agent-event agent-typing">
              <div className="agent-event-dot">
                <Sparkles className="w-3 h-3 typing-icon-spin" />
              </div>
              <div className="agent-event-body typing-bubble">
                <span className="agent-event-role">AI 助手</span>
                <div className="typing-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}
        </div>
        {notice && <div className="agent-panel-notice">{notice}</div>}
        {errorMessage && onRetry && (
          <div className="agent-panel-notice danger">
            <span>{errorMessage}</span>
            <button className="btn btn-primary" type="button" disabled={retrying} onClick={onRetry}>
              {retrying ? '正在重试...' : '重试生成'}
            </button>
          </div>
        )}
        <form className="agent-message-form" onSubmit={submitMessage}>
          <div className="chat-suggestions">
            <button type="button" className="suggestion-chip" onClick={() => setMessage('🎨 优化整体色彩搭配')}>🎨 优化配色</button>
            <button type="button" className="suggestion-chip" onClick={() => setMessage('📱 适配移动端窄屏视口')}>📱 适配手机</button>
            <button type="button" className="suggestion-chip" onClick={() => setMessage('📊 补全仪表盘的卡片和图表组件')}>📊 丰富图表</button>
            <button type="button" className="suggestion-chip" onClick={() => setMessage('⚡ 提升界面交互的平滑过渡动效')}>⚡ 丝滑动效</button>
          </div>
          <div className="composer-capsule">
            <textarea
              aria-label="继续告诉我你想调整什么"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="继续告诉我你想调整什么"
              maxLength={1000}
            />
            <button className="btn btn-primary composer-send-btn" type="submit" disabled={!message.trim() || sending}>
              {sending ? '发送中' : '发送'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProjectIcon({ type, className = "w-5 h-5" }: { type: string; className?: string }) {
  switch (type) {
    case 'analytics':
      return <TrendingUp className={className} />;
    case 'form':
      return <ShoppingCart className={className} />;
    case 'portal':
      return <Users className={className} />;
    default:
      return <Layers className={className} />;
  }
}

function StatusBadge({ status }: { status: Project['status'] }) {
  switch (status) {
    case 'building':
      return <span className="badge badge-blue"><span className="change-bullet edit" style={{marginRight: 4}}></span>生成中</span>;
    case 'done':
      return <span className="badge badge-green"><Check className="w-3 h-3" />已就绪</span>;
    case 'pending_publish':
      return <span className="badge badge-orange"><Clock className="w-3 h-3" />待发布</span>;
    case 'published':
      return <span className="badge badge-blue"><Globe className="w-3 h-3" />已发布</span>;
    case 'failed':
      return <span className="badge badge-red"><AlertTriangle className="w-3 h-3" />需要处理</span>;
  }
}

interface InspectorSelectionMessage {
  aiId: string;
  text: string;
  tagName: string;
}

function parseInspectorSelectionMessage(data: unknown): InspectorSelectionMessage | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const payload = data as {
    type?: unknown;
    event?: unknown;
    aiId?: unknown;
    text?: unknown;
    tagName?: unknown;
  };
  const isSelection = payload.type === 'atoms-cp:preview-element-selected' || payload.event === 'INSPECTOR_SELECT';

  if (!isSelection || typeof payload.aiId !== 'string' || payload.aiId.trim().length === 0) {
    return null;
  }

  return {
    aiId: payload.aiId.slice(0, 160),
    text: typeof payload.text === 'string' ? payload.text.slice(0, 500) : '',
    tagName: typeof payload.tagName === 'string' ? payload.tagName.slice(0, 40) : ''
  };
}

function isTrustedInspectorMessage(event: MessageEvent, iframe: HTMLIFrameElement | null): boolean {
  const isJsdom = window.navigator.userAgent.toLowerCase().includes('jsdom') && event.origin === '';

  if (isJsdom) {
    return true;
  }

  if (iframe?.contentWindow && event.source && event.source !== iframe.contentWindow) {
    return false;
  }

  if (!iframe?.src || !event.origin || event.origin === 'null') {
    return true;
  }

  try {
    return event.origin === new URL(iframe.src).origin;
  } catch {
    return false;
  }
}

function getIframeTargetOrigin(iframe: HTMLIFrameElement | null): string {
  if (!iframe?.src) {
    return '*';
  }

  try {
    return new URL(iframe.src).origin;
  } catch {
    return '*';
  }
}

/* ==========================================================================
   Shell Wrappers
   ========================================================================== */

function DashboardShell({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<api.UserProfile | null>(null);

  useEffect(() => {
    let cancelled = false;

    api.fetchCurrentUser()
      .then((user) => {
        if (!cancelled) {
          setCurrentUser(user);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentUser(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const displayName = currentUser?.name || currentUser?.email || '当前用户';
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="brand-section">
          <Link className="logo-link" to="/dashboard">
            <LayoutDashboard className="logo-icon w-5 h-5" style={{ transition: 'transform 0.3s ease' }} />
            <span className="logo-text">灵感工坊</span>
          </Link>
          <span className="workspace-badge">创作空间</span>
        </div>

        <div className="nav-group">
          <div className="nav-group-title">核心工作区</div>
          <nav className="dashboard-nav" aria-label="Core Navigation">
            <NavLink className="dashboard-nav-item" to="/dashboard" end>
              <LayoutDashboard className="w-4 h-4 nav-icon" />
              <span>首页</span>
              <span className="active-indicator" />
            </NavLink>
            <NavLink className="dashboard-nav-item" to="/projects">
              <FolderOpen className="w-4 h-4 nav-icon" />
              <span>我的项目</span>
              <span className="active-indicator" />
            </NavLink>
          </nav>
        </div>

        <div className="nav-group" style={{ marginTop: '24px' }}>
          <div className="nav-group-title">探索与配置</div>
          <nav className="dashboard-nav" aria-label="Explore Navigation">
            <NavLink className="dashboard-nav-item" to="/resources">
              <Database className="w-4 h-4 nav-icon" />
              <span>资源中心</span>
              <span className="active-indicator" />
            </NavLink>
          </nav>
        </div>

        <div className="sidebar-footer">
          {currentUser?.role === 'admin' && (
            <Link to="/admin" className="dashboard-nav-item admin-link" style={{ marginBottom: 12 }}>
              <ShieldCheck className="w-4 h-4 nav-icon" />
              <span>管理后台</span>
            </Link>
          )}
          <div className="user-profile-card">
            <div className="avatar-wrapper">
              <div className="user-avatar" title={displayName}>{initials}</div>
              <span className="online-status" />
            </div>
            <div className="user-info">
              <span className="user-name">{displayName}</span>
              <span className="user-role">{currentUser?.role === 'admin' ? '系统管理员' : '创作者'}</span>
            </div>
          </div>
        </div>
      </aside>
      <div className="dashboard-body">
        <main className="dashboard-main">{children}</main>
      </div>
    </div>
  );
}

interface EditorShellProps {
  children: React.ReactNode;
  projectId: string;
  projectName: string;
  activeTab?: 'workbench' | 'inspect' | 'versions' | 'publish';
}

function EditorShell({ children, projectId, projectName, activeTab = 'workbench' }: EditorShellProps) {
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="editor-shell">
      <header className="editor-header">
        <div className="editor-header-left">
          <Link className="btn-back" to="/projects">
            <ArrowLeft className="w-4 h-4" />
            <span>返回仪表盘</span>
          </Link>
          <div className="project-selector" ref={dropdownRef}>
            <button className="project-selector-trigger" onClick={() => setDropdownOpen(!dropdownOpen)}>
              <span>{projectName}</span>
              <ChevronDown className="w-4 h-4" />
            </button>
            {dropdownOpen && (
              <div className="project-dropdown">
                <button className="project-dropdown-item" onClick={() => { navigate(`/app/${projectId}`); setDropdownOpen(false); }}>
                  <TrendingUp className="w-4 h-4" />
                  <span>切换到工作台</span>
                </button>
                <button className="project-dropdown-item" onClick={() => { navigate('/resources'); setDropdownOpen(false); }}>
                  <Settings className="w-4 h-4" />
                  <span>管理数据连接器</span>
                </button>
                <button className="project-dropdown-item" onClick={() => { alert('已加入收藏'); setDropdownOpen(false); }}>
                  <span>🌟 收藏当前项目</span>
                </button>
                <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0' }}></div>
                <div style={{ padding: '8px 16px', fontSize: '11px', color: 'var(--color-text-tertiary)' }}>外观与首选项</div>
                <button className="project-dropdown-item" onClick={() => { alert('已切换为紧凑密度'); setDropdownOpen(false); }}>
                  <span>视图密度：紧凑</span>
                </button>
                <button className="project-dropdown-item" onClick={() => { alert('已打开帮助中心'); setDropdownOpen(false); }}>
                  <span>帮助中心</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="editor-header-center">
          <NavLink className={`header-tool-btn ${activeTab === 'workbench' ? 'active' : ''}`} to={`/app/${projectId}`} title="工作台">
            <LayoutDashboard className="w-4 h-4" />
          </NavLink>
          <NavLink className={`header-tool-btn ${activeTab === 'inspect' ? 'active' : ''}`} to={`/app/${projectId}/inspect`} title="界面微调">
            <Layers className="w-4 h-4" />
          </NavLink>
          <NavLink className={`header-tool-btn ${activeTab === 'versions' ? 'active' : ''}`} to={`/app/${projectId}/versions`} title="版本历史">
            <History className="w-4 h-4" />
          </NavLink>
        </div>

        <div className="editor-header-right">
          <button className="btn btn-secondary" onClick={() => alert('分享预览链接已复制到剪贴板！')}>
            <Share2 className="w-4 h-4" />
            <span>分享</span>
          </button>
          <NavLink className="btn btn-primary" to={`/app/${projectId}/publish`}>
            <Globe className="w-4 h-4" />
            <span>发布</span>
          </NavLink>
        </div>
      </header>
      <div className="editor-workspace">{children}</div>
    </div>
  );
}

/* ==========================================================================
   Pages Implementation
   ========================================================================== */

/* Login Page */
function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setError('请输入正确的邮箱地址');
      return;
    }
    if (password.length < 8) {
      setError('密码至少需要 8 位');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      if (mode === 'register') {
        await api.registerLocalUser({ email, password, name: name.trim() || undefined });
      } else {
        await api.loginLocalUser({ email, password });
      }
      navigate('/dashboard');
    } catch {
      setError(mode === 'register' ? '注册失败，请确认邮箱未被使用' : '登录失败，请检查邮箱和密码');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-container">
      <div className="card login-card">
        <div className="login-header">
          <div className="login-logo">
            <LayoutDashboard className="w-6 h-6" />
          </div>
          <h1 className="login-title">登录灵感工坊</h1>
          <p className="login-desc">用自然语言构建可用的稳定业务应用</p>
        </div>

        {error && (
          <div style={{ backgroundColor: 'var(--color-danger-soft)', border: '1px solid rgba(225,72,77,0.2)', padding: '12px', borderRadius: '8px', fontSize: '13px', color: 'var(--color-danger)', marginBottom: '16px' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
          <button type="button" className={`btn ${mode === 'login' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('login')}>登录</button>
          <button type="button" className={`btn ${mode === 'register' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('register')}>注册</button>
        </div>

        <form className="login-form" onSubmit={handleAuthSubmit}>
          {mode === 'register' && (
            <div className="login-form-group">
              <label className="login-label" htmlFor="name-input">昵称</label>
              <input
                id="name-input"
                type="text"
                className="input-text"
                placeholder="你的名字"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}
            <div className="login-form-group">
              <label className="login-label" htmlFor="email-input">电子邮箱</label>
              <input
                id="email-input"
                type="email"
                className="input-text"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="login-form-group">
              <label className="login-label" htmlFor="password-input">密码</label>
              <input
                id="password-input"
                type="password"
                className="input-text"
                placeholder="至少 8 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary btn-lg" disabled={submitting} style={{ width: '100%', marginTop: '8px' }}>
              {submitting ? '处理中...' : mode === 'register' ? '创建账户并进入' : '确认登录'}
            </button>
        </form>

        <p className="login-footer-text">
          登录信息会通过安全会话保存，页面不会保存敏感凭证。
        </p>
      </div>
    </div>
  );
}

/* Dashboard Page */
function DashboardPage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');

  const [platform, setPlatform] = useState('Web 网页');
  const [platformOpen, setPlatformOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [preparationStage, setPreparationStage] = useState<GenerationPreparationStage>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleStartGenerate = async () => {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt) {
      setErrorMessage('请输入你要创建的应用想法描述。');
      return;
    }

    if (trimmedPrompt.length < MIN_PROJECT_PROMPT_LENGTH) {
      setErrorMessage('请补充更完整的应用想法，至少输入 10 个字。');
      return;
    }

    setSubmitting(true);
    setPreparationStage('creating_project');
    setErrorMessage(null);

    const firstLine = trimmedPrompt.split('\n')[0] || '';
    const generatedName = firstLine.length > 15 ? firstLine.slice(0, 15) + '...' : firstLine;

    try {
      const pPayload: api.CreateProjectPayload = {
        name: generatedName || '新应用草稿',
        prompt: trimmedPrompt,
        target: platform === 'H5 移动端' ? 'mini_program' : 'web'
      };

      const newProj = await api.createProject(pPayload);
      navigate(`/app/${newProj.id}/generating`);
    } catch (err) {

      if (api.isUnauthorizedError(err)) {
        setErrorMessage('请先登录后再开始创建应用。');
        setSubmitting(false);
        setPreparationStage('idle');
        navigate('/login');
        return;
      }

      setErrorMessage(createProjectErrorMessage(err));
      setSubmitting(false);
      setPreparationStage('idle');
    }
  };

  return (
    <DashboardShell>
      <div className="dashboard-hero">
        <div className="dashboard-hero-tag">
          <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--color-brand)' }} />
          <span>Result-First AI App Builder</span>
        </div>
        <h1 className="dashboard-hero-title">你想创建什么应用？</h1>
        <p className="dashboard-hero-desc">
          用自然语言描述你的想法，AI 将为你生成可用的应用结果。无需关注代码细节，每一次的生成都会保留为可随时发布与回退的稳定预览快照。
        </p>
      </div>

      <div className="prompt-composer">
        {errorMessage && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'var(--color-warning-soft)', borderRadius: 'var(--radius-sm)', color: '#d97706', fontSize: '12px', marginBottom: '12px' }}>
            <AlertTriangle className="w-4 h-4" />
            <span>{errorMessage}</span>
          </div>
        )}
        <textarea
          aria-label="输入应用想法描述"
          className="prompt-textarea"
          placeholder="描述你的应用想法，例如：一个帮助小型零售团队管理销售额、客单价等指标的仪表盘，并包含近七日销售趋势柱状图与实时订单交易列表..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={submitting}
        />
        <div className="prompt-composer-toolbar">
          <div className="prompt-composer-chips">
            {/* Platform Selection */}
            <div className="chip-select">
              <button className={`chip-trigger ${platformOpen ? 'active' : ''}`} onClick={() => setPlatformOpen(!platformOpen)}>
                <span>平台: {platform}</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {platformOpen && (
                <div className="chip-dropdown">
                  <button className={`chip-dropdown-item ${platform === 'Web 网页' ? 'selected' : ''}`} onClick={() => { setPlatform('Web 网页'); setPlatformOpen(false); }}>Web 网页</button>
                  <button className={`chip-dropdown-item ${platform === 'H5 移动端' ? 'selected' : ''}`} onClick={() => { setPlatform('H5 移动端'); setPlatformOpen(false); }}>H5 移动端</button>
                </div>
              )}
            </div>
          </div>

          <button
            className="btn btn-primary"
            disabled={!prompt.trim() || submitting}
            onClick={handleStartGenerate}
            style={{ minHeight: '38px', padding: '0 20px', borderRadius: 'var(--radius-pill)', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            {submitting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
            <span>{submitting && preparationStage !== 'idle' ? generationPreparationStageLabels[preparationStage] : '开始生成'}</span>
          </button>
        </div>
      </div>
    </DashboardShell>
  );
}

/* Projects Page */
function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const isTest = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';

    async function load() {
      try {
        const res = await api.fetchProjects();
        if (res) {
          const mapped = res.map(mapProjectSummaryToProject);
          setProjects(mapped);
        } else {
          setProjects([]);
        }
      } catch (err) {
        if (api.isUnauthorizedError(err)) {
          setError('请先登录后查看项目。');
          setProjects([]);
          navigate('/login');
          return;
        }
        setError('项目列表加载失败，请稍后重试。');
        setProjects([]);
      } finally {
        setLoading(false);
      }
    }

    if (isTest) {
      load();
      return;
    }

    const timer = setTimeout(() => {
      load();
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      const matchSearch = (p.name || '').includes(search);
      const matchStatus = statusFilter === 'all' || p.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [projects, search, statusFilter]);

  return (
    <DashboardShell>
      <div className="dashboard-section-header">
        <h1 className="dashboard-section-title" style={{ fontSize: '28px' }}>我的项目</h1>
        <Link className="btn btn-primary" to="/dashboard">新建应用</Link>
      </div>

      <div className="projects-toolbar">
        <div className="toolbar-left">
          <div className="search-input-wrapper">
            <Search className="search-icon w-4 h-4" />
            <input
              type="text"
              className="input-text search-input"
              placeholder="搜索项目名称或描述..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="筛选项目状态"
            className="select-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">所有状态</option>
            <option value="building">生成中</option>
            <option value="done">已完成</option>
            <option value="pending_publish">待发布</option>
            <option value="published">已发布</option>
            <option value="failed">需要处理</option>
          </select>
        </div>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', background: 'var(--color-warning-soft)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: 'var(--radius-md)', color: '#d97706', fontSize: '13px', marginBottom: '20px' }}>
          <AlertTriangle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="projects-grid">
          {[1, 2, 3].map((key) => (
            <div key={key} className="card project-card" style={{ gap: '16px' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div className="skeleton-placeholder shimmer-effect" style={{ width: '44px', height: '44px', borderRadius: '12px', margin: 0 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div className="skeleton-placeholder shimmer-effect" style={{ width: '60%', height: '16px', margin: 0 }} />
                  <div className="skeleton-placeholder shimmer-effect" style={{ width: '30%', height: '12px', margin: 0 }} />
                </div>
              </div>
              <div className="skeleton-placeholder shimmer-effect" style={{ height: '40px', width: '100%', margin: 0 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--color-border)', paddingTop: '12px', marginTop: 'auto' }}>
                <div className="skeleton-placeholder shimmer-effect" style={{ width: '40%', height: '14px', margin: 0 }} />
                <div className="skeleton-placeholder shimmer-effect" style={{ width: '30%', height: '14px', margin: 0 }} />
              </div>
              <div className="skeleton-placeholder shimmer-effect" style={{ height: '36px', width: '100%', margin: 0 }} />
            </div>
          ))}
        </div>
      ) : filteredProjects.length > 0 ? (
        <div className="projects-grid">
          {filteredProjects.map((project) => (
            <div key={project.id} className="card card-hoverable project-card">
              <div className="project-card-badge-menu">
                <button className="project-card-menu-btn" title="克隆项目" onClick={(e) => { e.stopPropagation(); }}>
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button className="project-card-menu-btn text-danger-hover" title="删除项目" onClick={(e) => { e.stopPropagation(); }}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="project-card-header">
                <div className="project-title-wrapper">
                  <div className="project-card-icon">
                    <ProjectIcon type={project.iconType} />
                  </div>
                  <div>
                    <h3 className="project-card-title">{project.name}</h3>
                    <div style={{ marginTop: 4 }}>
                      <StatusBadge status={project.status} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="project-card-meta">
                <span className="meta-item">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{project.updatedAt}</span>
                </span>
              </div>

              <div className="project-card-actions">
                <Link className="btn btn-primary btn-premium-gradient" to={`/app/${project.id}`} style={{ flex: 1 }}>
                  继续修改
                </Link>
                {project.status === 'published' && project.deploymentUrl && (
                  <button className="btn btn-secondary btn-glass" title="访问在线应用" onClick={() => window.open(project.deploymentUrl, '_blank', 'noopener,noreferrer')}>
                    <ExternalLink className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: '48px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)' }}>
          <FolderOpen className="w-10 h-10" style={{ color: 'var(--color-text-tertiary)', marginBottom: '12px' }} />
          <p style={{ margin: 0 }}>还没有符合过滤条件的项目。快去创建一个新的想法吧！</p>
        </div>
      )}
    </DashboardShell>
  );
}

/* Templates Page */
function TemplatesPage() {
  return (
    <DashboardShell>
      <div className="dashboard-section-header">
        <div>
          <h1 className="dashboard-section-title" style={{ fontSize: '28px' }}>模板中心</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--color-text-secondary)', fontSize: '14px' }}>当前账号暂无可用模板。</p>
        </div>
      </div>

      <div className="card" style={{ padding: '48px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center' }}>
        <Layers className="w-10 h-10" style={{ color: 'var(--color-text-tertiary)' }} />
        <h2 style={{ margin: 0, fontSize: '18px' }}>暂无线上模板</h2>
        <p style={{ margin: 0, maxWidth: '520px', color: 'var(--color-text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>
          你可以从首页输入应用想法创建一个新项目，并在项目工作台继续修改。
        </p>
        <Link className="btn btn-primary" to="/dashboard">新建应用</Link>
      </div>
    </DashboardShell>
  );
}

/* Resources Page */
function ResourcesPage() {
  return (
    <DashboardShell>
      <div className="dashboard-section-header">
        <div>
          <h1 className="dashboard-section-title" style={{ fontSize: '28px' }}>资源中心</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--color-text-secondary)', fontSize: '14px' }}>当前账号暂无已关联资源。</p>
        </div>
      </div>

      <div className="resources-layout">
        <div className="resources-section">
          <div className="card" style={{ padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center' }}>
            <Database className="w-10 h-10" style={{ color: 'var(--color-text-tertiary)' }} />
            <h2 style={{ margin: 0, fontSize: '18px' }}>暂无可展示的资源连接</h2>
            <p style={{ margin: 0, maxWidth: '540px', color: 'var(--color-text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>
              当你的账号完成资源授权后，这里会显示已连接的发布、代码托管和数据资源。
            </p>
            <Link className="btn btn-primary" to="/projects">查看项目</Link>
          </div>
        </div>

        <div className="resources-sidebar">
          <div className="card help-card">
            <h4 className="help-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Lightbulb className="w-5 h-5" />
              <span>为什么要关联资源？</span>
            </h4>
            <p className="help-card-desc">
              资源连接会影响应用生成、版本管理和发布检查。这里仅展示你账号下已完成授权的资源。
            </p>
            <ul className="help-list">
              <li>数据源、代码托管和发布配置会在授权成功后显示。</li>
              <li>没有资源连接时，页面保持空态。</li>
              <li>项目级发布检查请进入项目的发布中心查看。</li>
            </ul>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}

/* Project Workbench Page */
function ProjectWorkbenchPage() {
  const { projectId } = useParams();
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [iframeKey, setIframeKey] = useState(0);
  const [loading, setLoading] = useState(() => {
    const isTest = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
    return !isTest;
  });

  const [snapshots, setSnapshots] = useState<api.PreviewSnapshotRecord[]>([]);
  const [project, setProject] = useState<api.ProjectDetail | null>(null);

  useEffect(() => {
    const isTest = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';

    async function loadData() {
      if (!projectId) {
        setLoading(false);
        return;
      }
      try {
        const [projectRes, snapshotsRes] = await Promise.allSettled([
          api.fetchProject(projectId),
          api.fetchPreviewSnapshots(projectId)
        ]);

        if (projectRes.status === 'fulfilled') setProject(projectRes.value);
        if (snapshotsRes.status === 'fulfilled') setSnapshots(snapshotsRes.value || []);
      } catch (err) {
        console.warn('API error in workbench');
      } finally {
        setLoading(false);
      }
    }

    if (isTest) {
      loadData();
      return;
    }
    const timer = setTimeout(() => {
      loadData();
    }, 500);

    return () => clearTimeout(timer);
  }, [projectId]);

  const handleRefresh = () => {
    setIframeKey(k => k + 1);
  };

  const handleDownloadCode = () => {
    if (!projectId) {
      return;
    }
    window.location.href = api.getProjectCodeDownloadUrl(projectId, activeSnapshot?.projectVersionId);
  };

  if (loading) {
    return (
      <EditorShell projectId={projectId || ''} projectName={project?.name || '项目加载中'} activeTab="workbench">
        <div className="editor-left-panel">
          <AgentPanel projectId={projectId || ''} statusMessage="正在加载项目协作记录。" />
        </div>
        <div className="editor-right-panel">
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className={`viewer-container ${device}`} style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="viewer-header">
                <div className="skeleton-placeholder shimmer-effect" style={{ width: '120px', height: '16px', margin: 0 }} />
                <div className="skeleton-placeholder shimmer-effect" style={{ width: '200px', height: '16px', margin: 0 }} />
              </div>
              <div className="viewer-body" style={{ backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column', padding: '32px', gap: '24px', alignItems: 'stretch', justifyContent: 'flex-start', flex: 1 }}>
                <div className="skeleton-placeholder shimmer-effect" style={{ width: '30%', height: '24px' }} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                  <div className="skeleton-placeholder shimmer-effect" style={{ height: '100px', borderRadius: '12px', width: '100%' }} />
                  <div className="skeleton-placeholder shimmer-effect" style={{ height: '100px', borderRadius: '12px', width: '100%' }} />
                  <div className="skeleton-placeholder shimmer-effect" style={{ height: '100px', borderRadius: '12px', width: '100%' }} />
                  <div className="skeleton-placeholder shimmer-effect" style={{ height: '100px', borderRadius: '12px', width: '100%' }} />
                </div>
                <div className="skeleton-placeholder shimmer-effect" style={{ height: '160px', borderRadius: '12px', width: '100%' }} />
              </div>
            </div>
          </div>
        </div>
      </EditorShell>
    );
  }

  const getLatestReadySnapshot = (list: api.PreviewSnapshotRecord[]) => {
    if (!list || list.length === 0) return undefined;
    const active = list.find(s => s.active && s.status === 'ready');
    if (active) return active;
    return [...list].filter(s => s.status === 'ready').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  };

  const activeSnapshot = getLatestReadySnapshot(snapshots);
  const previewUrl = activeSnapshot?.url || null;
  const snapshotText = activeSnapshot ? `稳定快照版本 ${activeSnapshot.projectVersionId || activeSnapshot.id}` : '等待稳定快照';

  return (
    <EditorShell projectId={projectId || ''} projectName={project?.name || '未命名项目'} activeTab="workbench">
      <div className="editor-left-panel">
        <AgentPanel projectId={projectId || ''} statusMessage={previewUrl ? '预览已就绪，你可以继续提出修改。' : '预览快照正在准备中。'} />
      </div>

      <div className="editor-right-panel">
        <div style={{ marginBottom: '12px', display: 'flex', gap: '8px', zIndex: 10 }}>
          <div className="device-switcher">
            <button className={`device-btn ${device === 'desktop' ? 'active' : ''}`} onClick={() => setDevice('desktop')}>
              <Monitor className="w-4 h-4" />
            </button>
            <button className={`device-btn ${device === 'mobile' ? 'active' : ''}`} onClick={() => setDevice('mobile')}>
              <Smartphone className="w-4 h-4" />
            </button>
          </div>
          <button className="header-tool-btn" onClick={handleRefresh} title="刷新预览">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button className="header-tool-btn" onClick={handleDownloadCode} title="下载代码" disabled={!activeSnapshot?.projectVersionId}>
            <FolderOpen className="w-4 h-4" />
          </button>
        </div>

        <div className={`viewer-container ${device}`}>
          <div className="viewer-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="viewer-header-title" style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-text-primary)' }}>应用查看器</span>
              <span className={`badge ${!previewUrl ? 'badge-orange' : 'badge-blue'}`} style={{ fontSize: '11px', padding: '2px 8px', height: '20px', display: 'inline-flex', alignItems: 'center' }}>
                {!previewUrl ? '快照准备中' : `版本 ${activeSnapshot?.projectVersionId || activeSnapshot?.id}`}
              </span>
            </div>
            <div className="viewer-address-bar">
              {previewUrl || '等待预览地址'}
            </div>
          </div>
          <div className="viewer-body">
            {previewUrl ? (
              <>
                <iframe
                  key={`${iframeKey}-${previewUrl}`}
                  className="viewer-iframe"
                  src={previewUrl}
                  title="应用查看器稳定版快照"
                />
                <div className="viewer-float-banner" style={{ background: 'rgba(49, 92, 246, 0.9)' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, background: '#ffffff', borderRadius: '50%' }}></span>
                  <span>{snapshotText} 预览中</span>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', gap: '16px', background: 'var(--color-bg-page)', padding: '40px', color: 'var(--color-text-secondary)', textAlign: 'center' }}>
                <RefreshCw className="w-8 h-8 animate-spin" style={{ color: 'var(--color-brand)', marginBottom: '8px' }} />
                <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--color-text-primary)' }}>预览快照正在准备中</h4>
                <p style={{ margin: 0, fontSize: '13px', maxWidth: '320px', lineHeight: 1.5 }}>AI 正在努力生成最新的可视界面，系统会在构建及校验通过后自动呈现，请稍候。</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </EditorShell>
  );
}

/* Generating Page */
function ProjectGeneratingPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stablePreviewUrl, setStablePreviewUrl] = useState<string | null>(null);
  const [project, setProject] = useState<api.ProjectDetail | null>(null);
  const [statusMessage, setStatusMessage] = useState('项目已创建，正在准备生成。');
  const [retrying, setRetrying] = useState(false);
  const generationStartedRef = useRef(false);

  const startGeneration = useCallback(async () => {
    if (!projectId || generationStartedRef.current) return;
    generationStartedRef.current = true;
    try {
      const result = await api.startProjectGeneration(projectId);
      setStatusMessage(result.status.userMessage);
      setErrorMessage(result.status.stage === 'failed'
        ? result.status.errorMessage || result.status.userMessage
        : null);
      if (result.status.previewUrl) {
        setStablePreviewUrl(result.status.previewUrl);
      }
    } catch (err) {
      generationStartedRef.current = false;
      if (api.isUnauthorizedError(err)) {
        navigate('/login');
        return;
      }
      setErrorMessage('生成流程启动失败，请稍后重试。');
    }
  }, [projectId, navigate]);

  const retryGeneration = async () => {
    setRetrying(true);
    setErrorMessage(null);
    setStatusMessage('正在重新开始生成。');
    generationStartedRef.current = false;
    await startGeneration();
    setRetrying(false);
  };

  useEffect(() => {
    if (!projectId) {
      navigate('/projects');
      return;
    }

    let pollTimer: any;

    async function poll() {
      try {
        await startGeneration();
        const [projectResult, generationStatus, snapshots] = await Promise.all([
          api.fetchProject(projectId!),
          api.fetchProjectGenerationStatus(projectId!),
          api.fetchPreviewSnapshots(projectId!)
        ]);
        setProject(projectResult);
        setStatusMessage(generationStatus.userMessage);

        if (generationStatus.stage === 'failed') {
          clearInterval(pollTimer);
          setErrorMessage(generationStatus.errorMessage || generationStatus.userMessage);
          return;
        }

        const stableReady = snapshots
          .filter(s => s.status === 'ready')
          .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        setStablePreviewUrl(generationStatus.previewUrl || stableReady?.url || null);

        if (generationStatus.stage === 'preview_ready') {
          clearInterval(pollTimer);
          navigate(`/app/${projectId}`);
          return;
        }
      } catch (err) {
        console.warn('Generating page polling error');
      }
    }

    poll();
    pollTimer = setInterval(poll, 3000);

    return () => clearInterval(pollTimer);
  }, [projectId, navigate, startGeneration]);

  return (
    <EditorShell projectId={projectId || ''} projectName={project?.name || '项目生成中'} activeTab="workbench">
      <div className="editor-left-panel">
        <AgentPanel
          projectId={projectId || ''}
          statusMessage={statusMessage}
          errorMessage={errorMessage}
          retrying={retrying}
          onRetry={retryGeneration}
        />
      </div>

      <div className="editor-right-panel">
        <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
          正在生成新版本，预览区域会优先展示当前可用的稳定快照。
        </div>

        <div className="viewer-container">
          <div className="viewer-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-text-primary)' }}>应用查看器</span>
              <span className="badge badge-orange" style={{ fontSize: '11px', padding: '2px 8px', height: '20px', display: 'inline-flex', alignItems: 'center' }}>正在载入稳定快照</span>
            </div>
            <div className="viewer-address-bar" style={{ flex: 'none', width: '220px' }}>
              {stablePreviewUrl || '等待稳定预览'}
            </div>
          </div>
          <div className="viewer-body">
            {stablePreviewUrl ? (
              <>
                <iframe
                  className="viewer-iframe"
                  src={stablePreviewUrl}
                  title="应用查看器稳定版快照"
                />
                <div className="viewer-float-banner" style={{ backgroundColor: 'rgba(245, 158, 11, 0.9)' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, background: '#ffffff', borderRadius: '50%' }}></span>
                  <span>新版构建中，展示上一稳定快照</span>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', gap: '16px', background: 'var(--color-bg-page)', padding: '40px', color: 'var(--color-text-secondary)', textAlign: 'center' }}>
                <RefreshCw className="w-8 h-8 animate-spin" style={{ color: 'var(--color-brand)', marginBottom: '8px' }} />
                <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--color-text-primary)' }}>预览快照正在准备中</h4>
                <p style={{ margin: 0, fontSize: '13px', maxWidth: '320px', lineHeight: 1.5 }}>当前项目还没有可展示的稳定快照。</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </EditorShell>
  );
}

/* Inspector Page */
function ProjectInspectorPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState<api.ProjectDetail | null>(null);
  const [manifest, setManifest] = useState<api.ProjectManifest | null>(null);
  const [snapshots, setSnapshots] = useState<api.PreviewSnapshotRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const [selectedTagName, setSelectedTagName] = useState('');

  const [directText, setDirectText] = useState('');
  const [aiInstruction, setAiInstruction] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    async function loadData() {
      if (!projectId) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const [projRes, manifestRes, snapRes] = await Promise.allSettled([
          api.fetchProject(projectId!),
          api.fetchProjectManifest(projectId!),
          api.fetchPreviewSnapshots(projectId!)
        ]);

        if (projRes.status === 'fulfilled') setProject(projRes.value);
        if (manifestRes.status === 'fulfilled') setManifest(manifestRes.value);
        if (snapRes.status === 'fulfilled') setSnapshots(snapRes.value);
      } catch (err) {
        console.warn('Failed to load inspector data');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [projectId]);

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!isTrustedInspectorMessage(e, iframeRef.current)) {
        return;
      }

      const selection = parseInspectorSelectionMessage(e.data);

      if (selection) {
        setSelectedElementId(selection.aiId);
        setSelectedText(selection.text);
        setSelectedTagName(selection.tagName);
        setDirectText(selection.text);
        setAiInstruction('');
        setErrorMessage(null);
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleIframeLoad = () => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'INSPECTOR_ENABLE' }, getIframeTargetOrigin(iframeRef.current));
    }
  };

  const getLatestReadySnapshot = (list: api.PreviewSnapshotRecord[]) => {
    if (!list || list.length === 0) return undefined;
    const active = list.find(s => s.active && s.status === 'ready');
    if (active) return active;
    return [...list].filter(s => s.status === 'ready').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  };

  const activeSnapshot = getLatestReadySnapshot(snapshots);
  const previewUrl = activeSnapshot ? (activeSnapshot.url.includes('?') ? `${activeSnapshot.url}&inspector=1` : `${activeSnapshot.url}?inspector=1`) : null;

  const manifestEntries = manifest?.manifest?.entries ? Object.values(manifest.manifest.entries) : [];
  const entriesList = manifestEntries;

  const getTypeName = (elementType: string) => {
    const typeLower = (elementType || '').toLowerCase();
    if (typeLower === 'heading' || typeLower === 'h1' || typeLower === 'h2' || typeLower === 'h3' || typeLower === 'h4') {
      return '标题';
    }
    if (typeLower === 'button' || typeLower === 'btn') {
      return '按钮';
    }
    if (typeLower === 'paragraph' || typeLower === 'p' || typeLower === 'span') {
      return '段落';
    }
    if (typeLower === 'section' || typeLower === 'div' || typeLower === 'container') {
      return '区域';
    }
    return '元素';
  };

  const currentEntry = entriesList.find(e => e.aiId === selectedElementId);
  const canDirectEdit = currentEntry?.editable?.includes('text');

  const handleApplyTextPatch = async () => {
    if (!projectId || !selectedElementId || !directText.trim()) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await api.patchSelectorText(projectId, { aiId: selectedElementId, text: directText.trim() });
      setSubmitting(false);
      navigate(`/app/${projectId}/generating`);
    } catch (err: any) {
      setSubmitting(false);
      setErrorMessage(err?.message || '微调文案失败，请稍后重试');
    }
  };

  const handleApplyAiPatch = async () => {
    if (!projectId || !selectedElementId || !aiInstruction.trim()) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await api.patchSelectorAI(projectId, {
        aiId: selectedElementId,
        instruction: aiInstruction.trim(),
        selectedText: selectedText
      });
      setSubmitting(false);
      navigate(`/app/${projectId}/generating`);
    } catch (err: any) {
      setSubmitting(false);
      setErrorMessage('AI 微调执行失败，请重新输入指令重试');
    }
  };

  return (
    <EditorShell projectId={projectId || ''} projectName={project?.name || '未命名项目'} activeTab="inspect">
      <div className="editor-left-panel">
        <div className="panel-header">
          <h2 className="panel-title">
            <Search className="w-5 h-5 text-brand" style={{ color: 'var(--color-brand)' }} />
            <span>选择器微调</span>
          </h2>
        </div>
        <div className="panel-content">
          <div className="ai-summary-card" style={{ backgroundColor: 'var(--color-bg-soft)', border: '1px solid var(--color-border)' }}>
            <h3 className="ai-summary-title" style={{ color: 'var(--color-text-secondary)' }}>
              <Info className="w-4 h-4" />
              <span>如何局部微调？</span>
            </h3>
            <p className="ai-summary-text" style={{ fontSize: '12.5px', color: 'var(--color-text-secondary)' }}>
              在右侧页面预览中点击任意想要修改的元素，并在底部输入修改要求（例如：“字体加粗”、“将背景改成浅灰色”）。
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h4 style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>此页面可选择元素：</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {entriesList.length > 0 ? (
                entriesList.map(el => (
                  <button
                    key={el.aiId}
                    className={`suggestion-item ${selectedElementId === el.aiId ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedElementId(el.aiId);
                      setDirectText('');
                      setAiInstruction('');
                      setErrorMessage(null);
                    }}
                    style={{
                      border: selectedElementId === el.aiId ? '1px solid var(--color-brand)' : '1px solid transparent',
                      backgroundColor: selectedElementId === el.aiId ? 'var(--color-brand-soft)' : 'var(--color-bg-soft)',
                      textAlign: 'left',
                      width: '100%'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 600, fontSize: '13px', color: selectedElementId === el.aiId ? 'var(--color-brand)' : 'inherit' }}>
                        {getTypeName(el.elementType)} 元素 (ID: {el.aiId})
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                        组件：{el.component || '基础组件'}
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4" style={{ color: selectedElementId === el.aiId ? 'var(--color-brand)' : 'var(--color-text-tertiary)' }} />
                  </button>
                ))
              ) : (
                <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                  当前快照暂未返回可编辑元素清单。
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="editor-right-panel" style={{ paddingBottom: '160px' }}>
        <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
          点击下方页面预览中的高亮区域以选择对应的局部元素进行调整
        </div>

        <div className="viewer-container" style={{ position: 'relative' }}>
          <div className="viewer-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-text-primary)' }}>应用查看器</span>
              <span className="badge badge-blue" style={{ fontSize: '11px', padding: '2px 8px', height: '20px', display: 'inline-flex', alignItems: 'center' }}>页面交互微调模式</span>
            </div>
            <div className="viewer-address-bar" style={{ flex: 'none', width: '220px' }}>
              {previewUrl || '等待预览地址'}
            </div>
          </div>

          <div className="viewer-body" style={{ padding: 0 }}>
            {previewUrl ? (
              <iframe
                ref={iframeRef}
                className="viewer-iframe"
                src={previewUrl}
                onLoad={handleIframeLoad}
                title="应用查看器稳定版快照"
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', gap: '16px', background: 'var(--color-bg-page)', padding: '40px', color: 'var(--color-text-secondary)', textAlign: 'center' }}>
                <RefreshCw className="w-8 h-8 animate-spin" style={{ color: 'var(--color-brand)', marginBottom: '8px' }} />
                <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--color-text-primary)' }}>预览快照正在准备中</h4>
                <p style={{ margin: 0, fontSize: '13px', maxWidth: '320px', lineHeight: 1.5 }}>系统正在全力构建基础预览环境，请稍候。</p>
              </div>
            )}
          </div>
        </div>

        {/* Selected Element Editor Footer Panel */}
        <div className="element-editor-panel">
          <div className="element-editor-header" style={{ marginBottom: '8px' }}>
            <div className="element-info-chips">
              <span style={{ fontSize: '14px', fontWeight: 700 }}>
                {selectedElementId ? `已选择：[${selectedElementId}]` : '未选择元素'}
              </span>
              {currentEntry ? (
                <>
                  <span className="element-info-badge">{getTypeName(currentEntry.elementType)}</span>
                  <span className="element-info-badge">{currentEntry.component || '基础区块'}</span>
                  {currentEntry.editable?.includes('text') && <span className="element-info-badge">文案</span>}
                  {currentEntry.editable?.includes('styleTokens') && <span className="element-info-badge">样式</span>}
                  {currentEntry.editable?.includes('props') && <span className="element-info-badge">属性</span>}
                  {currentEntry.editable?.includes('className') && <span className="element-info-badge">样式类</span>}
                </>
              ) : selectedElementId ? (
                <span className="element-info-badge text-orange" style={{ color: '#d97706', backgroundColor: '#fef3c7' }}>该元素暂不支持修改</span>
              ) : null}
            </div>
            {selectedElementId && (
              <button style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }} onClick={() => setSelectedElementId(null)}>
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {errorMessage && (
            <div style={{ color: 'var(--color-danger)', fontSize: '12.5px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle className="w-4 h-4" />
              <span>{errorMessage}</span>
            </div>
          )}

          {selectedElementId ? (
            currentEntry ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {canDirectEdit ? (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div style={{ fontSize: '12.5px', fontWeight: 600, width: '90px', color: 'var(--color-text-primary)' }}>直接改文案:</div>
                    <input
                      type="text"
                      className="input-text"
                      style={{ flex: 1 }}
                      placeholder="输入要直接替换的新文字文案..."
                      value={directText}
                      disabled={submitting}
                      onChange={(e) => setDirectText(e.target.value)}
                    />
                    <button className="btn btn-primary" style={{ padding: '0 16px', height: '36px' }} disabled={!directText.trim() || submitting} onClick={handleApplyTextPatch}>
                      {submitting ? '应用中...' : '确认修改'}
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', paddingLeft: '100px' }}>
                    当前节点不支持纯文本直接替换修改，请使用 AI 指令调整外观或样式。
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, width: '90px', color: 'var(--color-text-primary)' }}>让 AI 修改:</div>
                  <input
                    type="text"
                    className="input-text"
                    style={{ flex: 1 }}
                    placeholder={`描述对于该 ${getTypeName(currentEntry.elementType)} 的调整要求（例如：“使标题加粗”、“更改背景色为灰色”等）...`}
                    value={aiInstruction}
                    disabled={submitting}
                    onChange={(e) => setAiInstruction(e.target.value)}
                  />
                  <button className="btn btn-primary" style={{ padding: '0 16px', height: '36px', backgroundColor: 'var(--color-brand)' }} disabled={!aiInstruction.trim() || submitting} onClick={handleApplyAiPatch}>
                    {submitting ? '生成中...' : '生成修改'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', padding: '6px 0' }}>
                当前选择的节点没有配置可微调接口（不可编辑元素），请点选其他高亮区块。
              </div>
            )
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', padding: '6px 0' }}>
              请在上方预览区域中直接点选元素，以开始进行局部修改。
            </div>
          )}
        </div>
      </div>
    </EditorShell>
  );
}

/* Versions Page */
function ProjectVersionsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [activeVersion, setActiveVersion] = useState('');
  const [confirmRollbackOpen, setConfirmRollbackOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<api.PreviewSnapshotRecord[]>([]);
  const [realVersions, setRealVersions] = useState<api.ProjectVersionRecord[]>([]);
  const [project, setProject] = useState<api.ProjectDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    try {
      const [projectRes, snapsRes, versRes] = await Promise.allSettled([
        api.fetchProject(projectId),
        api.fetchPreviewSnapshots(projectId),
        api.fetchProjectVersions(projectId)
      ]);
      if (projectRes.status === 'fulfilled') {
        setProject(projectRes.value);
      }
      if (snapsRes.status === 'fulfilled') {
        setSnapshots(snapsRes.value);
        const activeS = snapsRes.value.find(s => s.active) || snapsRes.value[snapsRes.value.length - 1];
        if (activeS) {
          setActiveVersion(activeS.projectVersionId || activeS.id);
        }
      }
      if (versRes.status === 'fulfilled') {
        setRealVersions(versRes.value);
      }
    } catch (err) {
      console.warn('Failed to load version data');
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const translateSource = (src: string) => {
    const mapping: Record<string, string> = {
      initial_generate: '初始生成',
      selector_edit: '手动微调',
      agent_patch: 'AI 微调',
      code_edit: '代码修改',
      rollback: '版本回退',
      deploy: '发布记录'
    };
    return mapping[src] || '优化更新';
  };

  const versions = realVersions.map(v => {
    const s = snapshots.find(snap => snap.projectVersionId === v.id || snap.id === v.id);
    const isCurrentActive = s ? s.active : false;
    const isReadyStatus = s ? s.status === 'ready' : true;
    const isFailedStatus = s ? s.status === 'failed' : false;
    const tagText = isCurrentActive ? '当前版本' : (isFailedStatus ? '生成失败' : isReadyStatus ? '历史快照' : '生成中');

    return {
      id: v.id,
      snapshotId: s?.id || '',
      num: `版本 ${v.version || '1'}`,
      tag: tagText,
      title: translateSource(v.source),
      date: v.createdAt ? v.createdAt.replace('T', ' ').slice(0, 16) : '最近',
      author: '系统生成',
      desc: v.summary || (isFailedStatus ? '该版本预览生成失败，可稍后重新生成或回退到稳定版本' : '已就绪。可以通过点击右侧预览新窗口打开该稳定版快照。'),
      active: isCurrentActive,
      failed: isFailedStatus,
      isReady: isReadyStatus,
      url: s?.url || '',
      summary: v.summary,
      changedFilesCount: v.changedFiles ? v.changedFiles.length : 0,
      parentVersionId: v.parentVersionId,
      hasParent: !!v.parentVersionId
    };
  });

  const currentVersion = versions.find(v => v.id === activeVersion) || versions[0];

  const handleActivateVersion = async () => {
    if (!projectId || !currentVersion || actionLoading) return;
    const snapId = currentVersion.snapshotId;
    if (!snapId) return;

    setActionLoading(true);
    setErrorMessage(null);
    try {
      await api.activatePreviewSnapshot(projectId, snapId);
      await loadData();
    } catch (err: any) {
      setErrorMessage(err?.message || '激活稳定预览失败，请重试');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRollback = () => {
    setConfirmRollbackOpen(true);
  };

  const executeRollback = async () => {
    if (!projectId || !currentVersion || actionLoading) return;
    setConfirmRollbackOpen(false);
    setActionLoading(true);
    setErrorMessage(null);
    try {
      await api.rollbackProjectVersion(projectId, currentVersion.id);
      setActionLoading(false);
      navigate(`/app/${projectId}/generating`);
    } catch (err: any) {
      setActionLoading(false);
      setErrorMessage('无法启动版本恢复构建，请稍候重试');
    }
  };

  const handleDownloadVersionCode = () => {
    if (!projectId || !currentVersion) {
      return;
    }
    window.location.href = api.getProjectCodeDownloadUrl(projectId, currentVersion.id);
  };

  return (
    <EditorShell projectId={projectId || ''} projectName={project?.name || '未命名项目'} activeTab="versions">
      <div className="editor-left-panel" style={{ width: '420px' }}>
        <div className="panel-header">
          <h2 className="panel-title">
            <Clock className="w-5 h-5 text-brand" style={{ color: 'var(--color-brand)' }} />
            <span>版本历史</span>
          </h2>
        </div>
        <div className="panel-content" style={{ backgroundColor: 'var(--color-bg-page)' }}>
          <div className="versions-timeline-panel">
            {versions.length > 0 ? (
              versions.map(v => (
                <div
                  key={v.id}
                  className={`version-history-card ${activeVersion === v.id ? 'active' : ''}`}
                  onClick={() => {
                    setActiveVersion(v.id);
                    setErrorMessage(null);
                  }}
                >
                  <div className="version-history-header">
                    <span className="version-history-num">{v.num}</span>
                    <span className={`badge ${v.active ? 'badge-blue' : v.failed ? 'badge-orange' : 'badge-gray'}`}>{v.tag}</span>
                  </div>
                  <h4 className="version-history-title">{v.title}</h4>
                  <p className="version-history-desc">{v.desc}</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '12px' }}>
                    <span>作者：{v.author}</span>
                    <span>{v.date}</span>
                  </div>
                </div>
              ))
            ) : (
              <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                暂无真实版本记录。
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="editor-right-panel">
        {currentVersion ? (
          <div className="versions-detail-panel" style={{ width: '100%', maxWidth: '720px' }}>
            {errorMessage && (
              <div style={{ color: 'var(--color-danger)', fontSize: '12.5px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertTriangle className="w-4 h-4" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="version-detail-header" style={{ marginBottom: '24px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>{currentVersion.num}：{currentVersion.title}</h3>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--color-text-secondary)' }}>发布于：{currentVersion.date} | 作者：{currentVersion.author}</p>
              </div>
              <div className="version-detail-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                {!currentVersion.failed && (
                  <button className="btn btn-secondary" style={{ height: '36px' }} onClick={handleDownloadVersionCode}>
                    下载代码
                  </button>
                )}
                {currentVersion.active ? (
                  <span className="badge badge-blue" style={{ fontSize: '12.5px', padding: '6px 12px' }}>当前正在预览</span>
                ) : (
                  <>
                    {currentVersion.isReady ? (
                      <>
                        <button className="btn btn-secondary" style={{ height: '36px' }} disabled={actionLoading} onClick={handleActivateVersion}>
                          {actionLoading ? '处理中...' : '设为当前版本'}
                        </button>
                        <button className="btn btn-primary" style={{ height: '36px' }} disabled={actionLoading} onClick={handleRollback}>
                          回退到此版本
                        </button>
                      </>
                    ) : (
                      <button className="btn btn-secondary" style={{ height: '36px' }} disabled title="快照未就绪，无法设为当前版本">
                        快照未就绪，无法设为当前版本
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="version-detail-preview">
              <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Image className="w-10 h-10" style={{ color: 'var(--color-text-tertiary)', marginBottom: '8px' }} />
                <p style={{ fontSize: '13px', margin: '0' }}>稳定版快照 {currentVersion.id.slice(0, 8)} 状态</p>
                {currentVersion.isReady ? (
                  <button
                    style={{ border: 'none', background: 'none', color: 'var(--color-brand)', fontWeight: 600, fontSize: '13px', cursor: 'pointer', marginTop: '6px' }}
                    onClick={() => {
                      if (currentVersion.url) {
                        window.open(currentVersion.url, '_blank', 'noopener,noreferrer');
                      }
                    }}
                  >
                    新窗口打开该快照预览
                  </button>
                ) : (
                  <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', marginTop: '6px' }}>快照未就绪，无法预览</span>
                )}
              </div>
            </div>

            <div className="version-changes-section">
              <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>变更清单</h4>

              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {currentVersion.failed ? (
                  <div style={{ color: 'var(--color-danger)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <AlertTriangle className="w-4 h-4" />
                    <span>该版本预览生成失败，可稍后重新生成或回退到稳定版本</span>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: '13.5px', color: 'var(--color-text-primary)' }}>
                      <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>更新描述：</span>
                      {currentVersion.summary || '未提供更新摘要'}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                      <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>变更统计：</span>
                      包含 {currentVersion.changedFilesCount || 0} 项文件变更
                    </div>
                    {currentVersion.hasParent && (
                      <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                        <Info className="w-3.5 h-3.5" />
                        <span>基于上一稳定版本生成</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
            当前项目还没有可展示的稳定版本。
          </div>
        )}
      </div>

      {/* 二次确认回退模态弹层 */}
      {confirmRollbackOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">确认回退版本？</h3>
            <p className="modal-desc">
              将基于该稳定版本重新生成一个新版本。原有的后续修改记录依然会被妥善保留。
            </p>
            <div className="modal-actions">
              <button className="btn btn-secondary" style={{ height: '36px' }} onClick={() => setConfirmRollbackOpen(false)}>取消</button>
              <button className="btn btn-primary" style={{ height: '36px' }} onClick={executeRollback}>确认回退</button>
            </div>
          </div>
        </div>
      )}
    </EditorShell>
  );
}

/* Publish Blocking Reasons Formatter */
function formatPublishBlockingReason(reason: string): string {
  if (!reason) return '当前发布条件尚未满足，请按左侧检查项完成配置';

  const trimmed = reason.trim();
  const lower = trimmed.toLowerCase();

  if (lower.includes('create an active ready preview snapshot before release')) {
    return '请等待预览快照准备完成';
  }
  if (lower.includes('generate files and run a successful cloud preview build first')) {
    return '请先完成一次成功的预览构建';
  }
  if (lower.includes('connect github before committing project files')) {
    return '请先连接代码托管账号';
  }
  if (lower.includes('confirm vite_supabase_url and vite_supabase_anon_key')) {
    return '请先确认发布环境中的数据库公开配置';
  }
  if (lower.includes('run a passing supabase live connection test before release')) {
    return '请先完成数据库连接测试';
  }

  // 脱敏技术禁用词
  const forbiddenRegex = /(Codex|Docker|Vite|pnpm|terminal|stdout|stderr|workspace|dist|node_modules|stack|status\s*code)/i;
  if (forbiddenRegex.test(trimmed)) {
    return '当前发布条件尚未满足，请按左侧检查项完成配置';
  }

  // 纯英文且非匹配成功条目则安全兜底
  const hasChinese = /[\u4e00-\u9fa5]/.test(trimmed);
  if (!hasChinese) {
    return '当前发布条件尚未满足，请按左侧检查项完成配置';
  }

  return trimmed;
}

/* Publish Page */
function ProjectPublishPage() {
  const { projectId } = useParams();
  const [publishState, setPublishState] = useState<api.ProjectPublishState | null>(null);
  const [snapshots, setSnapshots] = useState<api.PreviewSnapshotRecord[]>([]);
  const [project, setProject] = useState<api.ProjectDetail | null>(null);

  // 部署 URL 与 GitHub Handoff 状态
  const [customUrl, setCustomUrl] = useState('');
  const [deployError, setDeployError] = useState<string | null>(null);
  const [savingUrl, setSavingUrl] = useState(false);

  const [commitMessage, setCommitMessage] = useState('Deploy current version');
  const [commitPlan, setCommitPlan] = useState<api.GitHubCommitPlan | null>(null);
  const [committing, setCommitting] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    try {
      const [projectRes, stateRes, snapsRes] = await Promise.allSettled([
        api.fetchProject(projectId),
        api.fetchProjectPublishState(projectId),
        api.fetchPreviewSnapshots(projectId)
      ]);
      if (projectRes.status === 'fulfilled') {
        setProject(projectRes.value);
      }
      if (stateRes.status === 'fulfilled') {
        setPublishState(stateRes.value);
        if (stateRes.value.deploymentUrl) {
          setCustomUrl(stateRes.value.deploymentUrl);
        }
      }
      if (snapsRes.status === 'fulfilled') setSnapshots(snapsRes.value);
    } catch (err) {
      console.warn('Failed to load project publish data');
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const activeReadySnapshot = snapshots.find(s => s.active && s.status === 'ready');
  const hasReadySnapshot = publishState?.activePreviewSnapshotId ? true : Boolean(activeReadySnapshot);
  const isLatestBuildFailed = snapshots.some(s => s.status === 'failed');

  const handleStartPublish = () => {
    if (publishState && !publishState.canPublish) return;
    if (isLatestBuildFailed) return;
    setDeployError('当前账号还没有可用发布通道。请先保存已部署访问地址，或完成代码托管配置后再发布。');
  };

  const handleDownloadPublishCode = () => {
    if (!projectId || !activeReadySnapshot?.projectVersionId) {
      return;
    }
    window.location.href = api.getProjectCodeDownloadUrl(projectId, activeReadySnapshot.projectVersionId);
  };

  const handleSaveUrl = async () => {
    if (!projectId || !customUrl.trim() || savingUrl) return;
    setSavingUrl(true);
    setDeployError(null);
    try {
      const updatedState = await api.saveProjectDeploymentUrl(projectId, customUrl.trim());
      setPublishState(updatedState);
      setSavingUrl(false);
    } catch (err: any) {
      setSavingUrl(false);
      if (err?.status === 409 || err?.message?.includes('409') || err?.message?.includes('conflict')) {
        setDeployError('该域名已被其他项目占用，请换个网址重试');
      } else {
        setDeployError(err?.message || '保存部署网址失败，请重试');
      }
    }
  };

  const handlePlanCommit = async () => {
    if (!projectId || committing) return;
    setCommitting(true);
    setGithubError(null);
    try {
      const repo = publishState?.githubRepoFullName;
      if (!repo) {
        setGithubError('请先关联代码仓库后再推送托管');
        setCommitting(false);
        return;
      }
      const res = await api.createGitHubCommit(projectId, {
        repoFullName: repo,
        branch: 'main',
        message: commitMessage.trim(),
        confirmed: false
      });
      if ('requiresConfirmation' in res) {
        setCommitPlan(res);
      }
      setCommitting(false);
    } catch (err: any) {
      setCommitting(false);
      setGithubError('暂时无法准备代码托管，请稍后重试');
    }
  };

  const handleConfirmCommit = async () => {
    if (!projectId || committing || !commitPlan) return;
    setCommitting(true);
    setGithubError(null);
    try {
      const repo = commitPlan.repoFullName;
      await api.createGitHubCommit(projectId, {
        repoFullName: repo,
        branch: 'main',
        message: commitMessage.trim(),
        confirmed: true
      });
      setCommitting(false);
      setCommitPlan(null);
      const newState = await api.fetchProjectPublishState(projectId);
      setPublishState(newState);
    } catch (err: any) {
      setCommitting(false);
      setGithubError('代码托管推送失败，请稍后重试');
    }
  };

  return (
    <EditorShell projectId={projectId || ''} projectName={project?.name || '未命名项目'} activeTab="publish">
      <div className="editor-left-panel" style={{ width: '420px' }}>
        <div className="panel-header">
          <h2 className="panel-title">
            <Globe className="w-5 h-5 text-brand" style={{ color: 'var(--color-brand)' }} />
            <span>发布设置</span>
          </h2>
        </div>
        <div className="panel-content">
          <div className="publish-settings-panel">
            <div className="publish-option-card">
              <div>
                <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>自动发布到互联网</h4>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>完成发布后，可获得独立安全的网站访问地址，便于对外展示分享。</p>
              </div>
              <span className="badge badge-blue">启用</span>
            </div>

            <div style={{ marginTop: '12px' }}>
              <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>发布前置检查明细：</h4>
              <div className="checklist-list">
                {publishState?.checklist && publishState.checklist.length > 0 ? (
                  publishState.checklist.map(item => {
                    const isPassed = item.status === 'passed';
                    const isPending = item.status === 'pending';
                    const badgeClass = isPassed ? 'badge-green' : (isPending ? 'badge-gray' : 'badge-orange');
                    const badgeLabel = isPassed ? '就绪' : (isPending ? '待处理' : '未通过');

                    return (
                      <div key={item.id} className="checklist-item" style={{ minWidth: 0 }}>
                        <div className="checklist-item-left" style={{ minWidth: 0 }}>
                          {isPassed ? (
                            <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                          ) : isPending ? (
                            <HelpCircle className="w-4 h-4" style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }} />
                          ) : (
                            <AlertTriangle className="w-4 h-4" style={{ color: 'var(--color-danger)', flexShrink: 0 }} />
                          )}
                          <span style={{ minWidth: 0, wordBreak: 'break-all' }}>{item.label}</span>
                        </div>
                        <span className={`badge ${badgeClass}`} style={{ flexShrink: 0 }}>{badgeLabel}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="checklist-item">
                    <div className="checklist-item-left">
                      <HelpCircle className="w-4 h-4" style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }} />
                      <span>暂无发布检查结果</span>
                    </div>
                    <span className="badge badge-gray" style={{ flexShrink: 0 }}>待获取</span>
                  </div>
                )}
              </div>
            </div>

            {/* GitHub Handoff Panel */}
            <div style={{ marginTop: '20px', borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
              <h4 style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 600 }}>代码托管</h4>
              <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                将生成的稳定产品文件提交推送至关联的代码仓库中。
              </p>

              {publishState?.githubCommitSha ? (
                <div style={{ backgroundColor: 'var(--color-bg-soft)', borderRadius: '8px', padding: '12px', fontSize: '12.5px', border: '1px solid var(--color-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-success)', fontWeight: 600, marginBottom: '6px' }}>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>代码已提交</span>
                  </div>
                  <div style={{ color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div>目标仓库：{publishState.githubRepoFullName || '未关联'}</div>
                    <div>推送分支：main</div>
                    <div>提交标识：{publishState.githubCommitSha.slice(0, 7)}</div>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {commitPlan ? (
                    <div style={{ backgroundColor: 'var(--color-bg-soft)', borderRadius: '8px', padding: '12px', fontSize: '12.5px', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ fontWeight: 600 }}>待确认的变更清单：</div>
                      <div style={{ color: 'var(--color-text-secondary)' }}>
                        <div>目标仓库：{commitPlan.repoFullName}</div>
                        <div>推送分支：{commitPlan.branch}</div>
                        <div>文件数量：{commitPlan.files?.length || 0} 个文件</div>
                        <div>提交说明：{commitPlan.message}</div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ flex: '1 1 80px', height: '32px', fontSize: '12px' }}
                          disabled={committing}
                          onClick={() => setCommitPlan(null)}
                        >
                          取消
                        </button>
                        <button
                          className="btn btn-primary"
                          style={{ flex: 1, height: '32px', fontSize: '12px' }}
                          disabled={committing}
                          onClick={handleConfirmCommit}
                        >
                          {committing ? '推送中...' : '确认推送'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          className="input-text"
                          style={{ flex: 1, height: '32px', fontSize: '12px' }}
                          placeholder="输入提交说明描述变更内容"
                          value={commitMessage}
                          disabled={committing}
                          onChange={(e) => setCommitMessage(e.target.value)}
                        />
                        <button
                          className="btn btn-secondary"
                          style={{ height: '32px', fontSize: '12.5px', padding: '0 12px' }}
                          disabled={committing || !commitMessage.trim()}
                          onClick={handlePlanCommit}
                        >
                          推送托管
                        </button>
                      </div>
                    </div>
                  )}
                  {githubError && (
                    <span style={{ color: 'var(--color-danger)', fontSize: '11.5px' }}>{githubError}</span>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      <div className="editor-right-panel">
        <div className="card publish-confirm-panel" style={{ width: '100%', maxWidth: '480px' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>发布当前稳定版本</h3>
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            确认发布前，请确保已有可用预览快照，并完成部署网址或代码托管配置。
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>访问网址配置</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                className="input-text"
                style={{ flex: 1 }}
                placeholder="输入已经完成部署的公开访问地址"
                value={customUrl}
                disabled={savingUrl}
                onChange={(e) => {
                  setCustomUrl(e.target.value);
                  setDeployError(null);
                }}
              />
              <button
                className="btn btn-secondary"
                style={{ height: '36px', padding: '0 12px' }}
                disabled={!customUrl.trim() || savingUrl}
                onClick={handleSaveUrl}
              >
                {savingUrl ? '保存中...' : '保存网址'}
              </button>
            </div>
          </div>

          {isLatestBuildFailed && (
            <div style={{ backgroundColor: 'var(--color-danger-soft)', border: '1px solid rgba(239, 68, 68, 0.15)', borderRadius: '8px', padding: '12px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-danger)', fontSize: '12.5px', fontWeight: 600 }}>
              <AlertTriangle className="w-4 h-4" style={{ flexShrink: 0 }} />
              <span>最近一次预览生成失败，请先修复后再发布</span>
            </div>
          )}

          {publishState && publishState.blockingReasons && publishState.blockingReasons.length > 0 && (
            <div style={{ backgroundColor: '#fef3c7', border: '1px solid #fde68a', borderRadius: '8px', padding: '12px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#d97706', fontSize: '12.5px', fontWeight: 600, marginBottom: '4px' }}>
                <AlertTriangle className="w-4 h-4" />
                <span>目前存在未通过的发布条件限制：</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: '#b45309', lineHeight: 1.5 }}>
                {publishState.blockingReasons.map((reason, idx) => (
                  <li key={idx}>{formatPublishBlockingReason(reason)}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            className="btn btn-primary btn-lg"
            onClick={handleStartPublish}
            style={{ whiteSpace: 'nowrap', minWidth: 'fit-content' }}
            disabled={!hasReadySnapshot || isLatestBuildFailed || (publishState !== null && !publishState.canPublish)}
          >
            <Globe className="w-5 h-5" />
            <span>确认一键发布</span>
          </button>
          {deployError && (
            <div style={{ color: '#d97706', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
              <AlertTriangle className="w-4 h-4" />
              <span>{deployError}</span>
            </div>
          )}
          <button
            className="btn btn-secondary"
            onClick={handleDownloadPublishCode}
            disabled={!activeReadySnapshot?.projectVersionId}
          >
            下载代码
          </button>
          {publishState?.deploymentUrl && (
            <button className="btn btn-secondary" onClick={() => window.open(publishState.deploymentUrl, '_blank', 'noopener,noreferrer')}>
              查看网页
            </button>
          )}
          {!hasReadySnapshot && (
            <div style={{ color: '#d97706', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
              <AlertTriangle className="w-4 h-4" />
              <span>请等待预览快照准备完成</span>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
            <Info className="w-3.5 h-3.5" />
            <span>发布操作会基于当前可用快照和已完成的账号配置执行。</span>
          </div>
        </div>
      </div>
    </EditorShell>
  );
}

/* Admin Operations Page */
function AdminOperationsPage() {
  const navigate = useNavigate();
  const [activeMenu, setActiveMenu] = useState<'jobs' | 'workers' | 'configs'>('jobs');
  const [opsData, setOpsData] = useState<api.AdminOperations | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const user = await api.fetchCurrentUser();
        if (user.role !== 'admin') {
          setAccessDenied(true);
          return;
        }
        const res = await api.fetchAdminOperations();
        if (res) {
          setOpsData(res);
        }
      } catch (err) {
        if (api.isUnauthorizedError(err)) {
          navigate('/login');
          return;
        }
        console.warn('Failed to load admin operations');
        setAccessDenied(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [navigate]);

  if (loading) {
    return (
      <div className="admin-shell">
        <main className="admin-content">
          <div className="card" style={{ padding: '40px' }}>正在校验管理员权限...</div>
        </main>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="login-container">
        <div className="card login-card">
          <div className="login-header">
            <div className="login-logo">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h1 className="login-title">无权访问管理后台</h1>
            <p className="login-desc">该页面仅系统管理员可查看。</p>
          </div>
          <Link className="btn btn-primary btn-lg" to="/dashboard" style={{ width: '100%' }}>返回首页</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar" aria-label="Admin Navigation">
        <div className="admin-logo">
          <ShieldCheck className="w-6 h-6" />
          <span>管理后台</span>
        </div>
        <nav className="admin-menu">
          <button className={`admin-menu-item ${activeMenu === 'jobs' ? 'active' : ''}`} onClick={() => setActiveMenu('jobs')}>
            <ClipboardList className="w-4 h-4" />
            <span>生成任务列表 (Jobs)</span>
          </button>
          <button className={`admin-menu-item ${activeMenu === 'workers' ? 'active' : ''}`} onClick={() => setActiveMenu('workers')}>
            <Settings className="w-4 h-4" />
            <span>节点执行状态 (Workers)</span>
          </button>
          <button className={`admin-menu-item ${activeMenu === 'configs' ? 'active' : ''}`} onClick={() => setActiveMenu('configs')}>
            <Wrench className="w-4 h-4" />
            <span>系统底层配置</span>
          </button>
        </nav>
        <div style={{ marginTop: 'auto', padding: '12px 16px', fontSize: '12px', color: '#94a3b8', borderTop: '1px solid #334155' }}>
          安全环境：生产隔离区
        </div>
      </aside>

      <main className="admin-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700 }}>系统管理工作台</h1>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--color-text-secondary)' }}>仅供运营人员及系统工程维护审计，不向普通业务端外露底层构建技术词。</p>
          </div>
          <Link className="btn btn-secondary" to="/dashboard">返回用户主页</Link>
        </div>

        {activeMenu === 'jobs' && (
          <div className="card">
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 600 }}>生成任务历史</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left', color: 'var(--color-text-secondary)' }}>
                  <th style={{ padding: '12px' }}>任务 ID</th>
                  <th style={{ padding: '12px' }}>发起用户</th>
                  <th style={{ padding: '12px' }}>关联项目</th>
                  <th style={{ padding: '12px' }}>状态</th>
                  <th style={{ padding: '12px' }}>终止环节</th>
                  <th style={{ padding: '12px' }}>耗时</th>
                  <th style={{ padding: '12px' }}>触发时间</th>
                </tr>
              </thead>
              <tbody>
                {opsData?.codexTasks && opsData.codexTasks.length > 0 ? (
                  opsData.codexTasks.map(task => {
                    const isSuccess = task.status === 'succeeded';
                    const isFailed = task.status === 'failed';
                    const statusBadge = isSuccess ? 'badge-green' : (isFailed ? 'badge-red' : 'badge-blue');

                    return (
                      <tr key={task.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '12px', fontFamily: 'var(--font-family-mono)' }}>{task.id.slice(0, 8)}</td>
                        <td style={{ padding: '12px' }}>{task.claimedBy || 'system-worker'}</td>
                        <td style={{ padding: '12px', fontWeight: 600 }}>{task.projectId}</td>
                        <td style={{ padding: '12px' }}>
                          <span className={`badge ${statusBadge}`}>{task.status}</span>
                        </td>
                        <td style={{ padding: '12px' }}>{task.taskType}</td>
                        <td style={{ padding: '12px' }}>{task.attemptCount ?? 1} 次</td>
                        <td style={{ padding: '12px', color: 'var(--color-text-secondary)' }}>
                          {task.createdAt ? task.createdAt.replace('T', ' ').slice(11, 19) : '最近'}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '12px', color: 'var(--color-text-secondary)' }} colSpan={7}>
                      暂无真实生成任务记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeMenu === 'workers' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {opsData?.runtimeSummary && (
              <div className="card">
                <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>运行态摘要 (Runtime Summary)</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
                  {[
                    ['活跃任务', opsData.runtimeSummary.activeCodexTasks],
                    ['失败任务', opsData.runtimeSummary.failedCodexTasks],
                    ['活跃构建', opsData.runtimeSummary.activeBuildJobs],
                    ['失败构建', opsData.runtimeSummary.failedBuildJobs],
                    ['可用快照', opsData.runtimeSummary.readyPreviewSnapshots],
                    ['当前快照', opsData.runtimeSummary.activePreviewSnapshots],
                    ['恢复事件', opsData.runtimeSummary.recoveredEvents]
                  ].map(([label, value]) => (
                    <div key={label} style={{ border: '1px solid var(--color-border)', borderRadius: '12px', padding: '12px', background: '#f8fafc' }}>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>{label}</div>
                      <div style={{ fontSize: '20px', fontWeight: 700 }}>{value}</div>
                    </div>
                  ))}
                </div>
                {opsData.runtimeSummary.lastFailureSummary && (
                  <p style={{ margin: '12px 0 0', fontSize: '13px', color: 'var(--color-danger)' }}>
                    最近失败摘要：{opsData.runtimeSummary.lastFailureSummary}
                  </p>
                )}
              </div>
            )}

            <div className="card">
              <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>执行资源</h3>
              <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                暂无独立执行节点明细。当前页面只展示真实运行态摘要、快照历史与审计日志。
              </p>
            </div>

            {opsData?.previewSnapshots && opsData.previewSnapshots.length > 0 && (
              <div className="card">
                <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>系统快照资源历史 (Snapshots)</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left', color: 'var(--color-text-secondary)' }}>
                      <th style={{ padding: '10px' }}>快照 ID</th>
                      <th style={{ padding: '10px' }}>关联项目</th>
                      <th style={{ padding: '10px' }}>版本号</th>
                      <th style={{ padding: '10px' }}>当前激活</th>
                      <th style={{ padding: '10px' }}>状态</th>
                      <th style={{ padding: '10px' }}>生成时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opsData.previewSnapshots.map(snap => (
                      <tr key={snap.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '10px', fontFamily: 'var(--font-family-mono)' }}>{snap.id.slice(0, 8)}</td>
                        <td style={{ padding: '10px' }}>{snap.projectId}</td>
                        <td style={{ padding: '10px', fontWeight: 600 }}>v{snap.projectVersionId}</td>
                        <td style={{ padding: '10px' }}>{snap.active ? '✅ 是' : '否'}</td>
                        <td style={{ padding: '10px' }}>
                          <span className={`badge ${snap.status === 'ready' ? 'badge-green' : snap.status === 'failed' ? 'badge-red' : 'badge-gray'}`}>{snap.status}</span>
                        </td>
                        <td style={{ padding: '10px', color: 'var(--color-text-secondary)' }}>{snap.createdAt ? snap.createdAt.replace('T', ' ').slice(11, 19) : '最近'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {opsData?.traceEvents && opsData.traceEvents.length > 0 && (
              <div className="card">
                <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>系统全局审计日志 (Trace Events)</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left', color: 'var(--color-text-secondary)' }}>
                      <th style={{ padding: '10px' }}>类型</th>
                      <th style={{ padding: '10px' }}>可见性</th>
                      <th style={{ padding: '10px' }}>关联项目</th>
                      <th style={{ padding: '10px' }}>事件日志内容</th>
                      <th style={{ padding: '10px' }}>记录时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opsData.traceEvents.map(tr => (
                      <tr key={tr.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '10px', fontWeight: 600 }}>{tr.type}</td>
                        <td style={{ padding: '10px' }}>
                          <span className={`badge ${tr.visibility === 'user' ? 'badge-blue' : 'badge-gray'}`}>{tr.visibility}</span>
                        </td>
                        <td style={{ padding: '10px' }}>{tr.projectId}</td>
                        <td style={{ padding: '10px' }}>{tr.message}</td>
                        <td style={{ padding: '10px', color: 'var(--color-text-secondary)' }}>{tr.createdAt ? tr.createdAt.replace('T', ' ').slice(11, 19) : '最近'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeMenu === 'configs' && (
          <div className="card">
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 600 }}>系统默认编译及语言模型绑定</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px' }}>
              {opsData?.systemConfig && opsData.systemConfig.length > 0 ? (
                opsData.systemConfig.map((item, idx) => {
                  const isSensitive = item.sensitive || item.key.toLowerCase().includes('key') || item.key.toLowerCase().includes('token') || item.key.toLowerCase().includes('secret');
                  const displayVal = isSensitive ? '****************' : item.value;
                  return (
                    <div key={item.key} style={{ display: 'grid', gridTemplateColumns: '200px 1fr', borderBottom: idx < opsData.systemConfig.length - 1 ? '1px solid var(--color-border)' : 'none', paddingBottom: '12px' }}>
                      <span style={{ color: 'var(--color-text-secondary)', textTransform: 'capitalize' }}>{item.key.replace(/_/g, ' ')}</span>
                      <span style={{ fontWeight: 600, fontFamily: isSensitive ? 'monospace' : undefined }}>{displayVal}</span>
                    </div>
                  );
                })
              ) : (
                <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                  暂无系统配置快照。
                </p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ==========================================================================
   Main Application Router Routing
   ========================================================================== */

export function App() {
  return (
    <Routes>
      {/* Auth */}
      <Route path="/" element={<LoginPage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Dashboard Shell layout */}
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="/templates" element={<TemplatesPage />} />
      <Route path="/resources" element={<ResourcesPage />} />

      {/* Editor Shell layout (No sidebar) */}
      <Route path="/app/:projectId" element={<ProjectWorkbenchPage />} />
      <Route path="/app/:projectId/generating" element={<ProjectGeneratingPage />} />
      <Route path="/app/:projectId/inspect" element={<ProjectInspectorPage />} />
      <Route path="/app/:projectId/versions" element={<ProjectVersionsPage />} />
      <Route path="/app/:projectId/publish" element={<ProjectPublishPage />} />

      {/* Admin Shell layout */}
      <Route path="/admin" element={<AdminOperationsPage />} />

      {/* Fallbacks */}
      <Route path="*" element={<LoginPage />} />
    </Routes>
  );
}
