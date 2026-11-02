import type { AuditEntry, CurrentUser, Permission, Role, Session, User, UserStatus } from './entities'
import type { ListQuery, Page } from './pagination'
import type { PermissionCode } from './permissions'
import type { CustomField, FieldConfig, FieldOption, FieldType, FieldValue, OptionColor, TaskType, TaskTypeDetail, TaskTypeIcon, TranslatedLocale, TypeTexts } from './task-config'
import type { Area, LookupItem, StatusCategory, TaskPriority, TaskStatus } from './workflow'
import type { Attachment, ProjectFile } from './attachments'
import type { AppNotification } from './notifications'
import type { Board } from './kanban'
import type { BacklogView } from './backlog'
import type { ForkInput, LinkOption, TaskRelation, TaskRelations } from './relations'
import type { Report, ReportMetric, ReportQuery, ReportTask } from './reports'
import type { ExecutiveDashboard, ExecutiveQuery } from './executive'
import type { Milestone, MilestoneInput, Timeline } from './timeline'
import type { DocDraft, DocFile, DocMoveTarget, DocPage, DocRecent, DocSearchResult, DocSpace, DocSpaceDetail, DocSpaceInput, DocVersion, DocVersionDetail, RichContent } from './docs'
import type { Sprint, SprintInput } from './sprints'
import type { LibraryIcon } from './icons'
import type {
  DependencyRule,
  Plan,
  PlanBulkInput,
  PlanBulkResult,
  PlanGroup,
  PlanGroupInput,
  PlanGroupMove,
  PlanImportResult,
  PlanImportRow,
  PlanItem,
  PlanItemInput,
  PlanItemMove,
  PlanLink,
  PlanLinkKind,
  PlanResource,
  PlanResourceInput,
  PlanStatus,
  PlanStatusInput,
} from './plan'
import type { PlanFile, PlanUpdate, PlanUpdateInput, PlanUpdates } from './plan-updates'
import type { IssueInput, JournalEntry, JournalInput, PlanIssue, PlanIssues, PlanJournal, PlanReport } from './plan-management'
import type { ColumnTypePreview, PlanColumn, PlanColumnInput } from './plan-columns'
import type { Tag, TaskComment, TaskDetail, TaskInput, TaskSummary } from './tasks'
import type { Urgency } from './urgency'
import type { CharterItem, CharterItemInput, CharterKind, CharterMeasurement, MeasurementInput, ProjectCharter } from './charter'
import type {
  MemberRole,
  Project,
  ProjectCover,
  ProjectIcon,
  ProjectMember,
  ProjectPriority,
  ProjectStatus,
  ProjectView,
  UserSummary,
} from './projects'
import type { Language } from '@/core/i18n'
import type { BrandingSlot, PasswordPolicy, PlatformInfo, PlatformSettings, PlatformSettingsValues } from './platform'
import type { EmailSettingsPatch, EmailSettingsView, FlushResult, OutboxSummary, ResetTokenCheck } from './email'
import type { ApiToken, ApiTokenExpiry, CreatedApiToken } from './api-tokens'
import type { CreatedWebhook, Webhook, WebhookCatalog, WebhookDelivery, WebhookInput } from './webhooks'
import type { ThemePreference } from '@/core/theme/theme'
import type { ProjectFilterScreen, ProjectFilterSettings } from './project-filter'

/**
 * Contratos de acesso a dados. A apresentação depende apenas destas interfaces;
 * as implementações HTTP ficam em src/data e podem ser trocadas sem afetar a UI.
 */

export interface LoginCredentials {
  email: string
  password: string
  remember: boolean
}

export interface AuthRepository {
  login(credentials: LoginCredentials): Promise<void>
  logout(): Promise<void>
  /** Retorna null quando não há sessão válida. */
  me(): Promise<CurrentUser | null>
  listSessions(): Promise<Session[]>
  revokeSession(id: string): Promise<{ current: boolean }>
  /** Encerra todas as sessões do usuário, exceto a atual. */
  revokeOtherSessions(): Promise<{ revoked: number }>
  changePassword(currentPassword: string, newPassword: string): Promise<{ otherSessionsRevoked: number }>
  /** Exigências vigentes para senhas (Configurador geral). */
  passwordPolicy(): Promise<PasswordPolicy>
  /** "Esqueci minha senha": responde igual exista ou não a conta. */
  requestPasswordReset(email: string): Promise<void>
  /** Confere o link de senha/convite (e traz as exigências da senha). */
  checkResetToken(token: string): Promise<ResetTokenCheck>
  confirmPasswordReset(token: string, password: string): Promise<{ purpose: 'reset' | 'invite' }>
}

/** Preferências da pessoa guardadas no servidor (valem em qualquer navegador). */
export interface PreferenceRepository {
  /** Configurador do filtro de projetos da tela; sem nada salvo, o padrão. */
  getProjectFilter(screen: ProjectFilterScreen): Promise<ProjectFilterSettings>
  /** Salva (null = volta ao padrão) e devolve o que ficou gravado. */
  saveProjectFilter(screen: ProjectFilterScreen, settings: ProjectFilterSettings | null): Promise<ProjectFilterSettings>
}

/** Webhooks (integrations.manage): cadastro, segredo, teste e entregas. */
export interface WebhookRepository {
  list(): Promise<Webhook[]>
  catalog(): Promise<WebhookCatalog>
  create(input: WebhookInput): Promise<CreatedWebhook>
  update(id: string, input: Partial<WebhookInput>): Promise<Webhook>
  remove(id: string): Promise<void>
  rotateSecret(id: string): Promise<{ secret: string }>
  test(id: string): Promise<WebhookDelivery>
  deliveries(id: string): Promise<WebhookDelivery[]>
  redeliver(deliveryId: string): Promise<WebhookDelivery>
}

/** Tokens de API: os da pessoa (Minha conta) e, com integrations.manage, os de todos. */
export interface ApiTokenRepository {
  listMine(): Promise<ApiToken[]>
  create(name: string, expiresInDays: ApiTokenExpiry): Promise<CreatedApiToken>
  revoke(id: string): Promise<ApiToken>
  /** Mostra de novo o valor de um token meu (fica no histórico). */
  reveal(id: string): Promise<CreatedApiToken>
  listAll(): Promise<ApiToken[]>
  revokeAny(id: string): Promise<ApiToken>
}

/** E-mail (integrations.manage): configurações do SMTP, teste e fila de saída. */
export interface EmailRepository {
  getSettings(): Promise<EmailSettingsView>
  updateSettings(patch: EmailSettingsPatch): Promise<EmailSettingsView>
  sendTest(to?: string): Promise<{ to: string }>
  outbox(): Promise<OutboxSummary>
  flush(): Promise<FlushResult>
}

/** Configurador geral: identidade pública e configurações da plataforma (platform.manage). */
export interface PlatformRepository {
  /** Público (sem login): nome, logo e ícone. */
  getInfo(): Promise<PlatformInfo>
  getSettings(): Promise<PlatformSettings>
  updateSettings(patch: Partial<PlatformSettingsValues>): Promise<PlatformSettings>
  /** Quantos registros do histórico a nova retenção apagaria (não grava). */
  previewRetention(months: number): Promise<{ auditToDelete: number }>
  uploadBranding(slot: BrandingSlot, file: File): Promise<PlatformSettings>
  removeBranding(slot: BrandingSlot): Promise<PlatformSettings>
  /** Aplica a retenção agora (mesma regra da rotina diária). */
  runRetention(): Promise<{ removed: number }>
}

export interface CreateUserData {
  name: string
  email: string
  /** Dispensada com `sendInvite` (a pessoa cria a dela pelo link do e-mail). */
  password?: string
  roleId: string
  locale: Language
  sendInvite?: boolean
}

export interface UpdateUserData {
  name?: string
  email?: string
  roleId?: string
  locale?: Language
  theme?: ThemePreference
  emailNotifications?: boolean
}

export interface UserRepository {
  list(query: ListQuery): Promise<Page<User>>
  get(id: string): Promise<User>
  create(data: CreateUserData): Promise<User>
  update(id: string, data: UpdateUserData): Promise<User>
  setStatus(id: string, status: UserStatus): Promise<User>
  resetPassword(id: string, password: string): Promise<void>
  /** Reenvia o convite por e-mail (quem ainda não entrou). */
  resendInvite(id: string): Promise<void>
  history(id: string, query: Pick<ListQuery, 'page' | 'perPage'>): Promise<Page<AuditEntry>>
  /** Foto do usuário (substitui a anterior). */
  uploadAvatar(id: string, file: File): Promise<User>
  /** Remove a foto (volta às iniciais). */
  removeAvatar(id: string): Promise<User>
}

export interface RoleData {
  code: string
  name: string
  description: string
  permissions?: PermissionCode[]
}

export interface RoleRepository {
  list(): Promise<Role[]>
  listPermissions(): Promise<Permission[]>
  create(data: RoleData): Promise<Role>
  update(id: string, data: Pick<RoleData, 'name' | 'description'>): Promise<Role>
  updatePermissions(id: string, permissions: PermissionCode[]): Promise<Role>
  remove(id: string): Promise<void>
}

export interface AuditQuery {
  page: number
  perPage: number
  filters: Record<string, string>
}

export interface AuditRepository {
  list(query: AuditQuery): Promise<Page<AuditEntry>>
}

export interface ProjectListQuery extends ListQuery {
  view: ProjectView
}

/** Datas no formato AAAA-MM-DD (somente data). */
export interface ProjectData {
  name: string
  description: string
  icon: ProjectIcon
  cover: ProjectCover
  status: ProjectStatus
  priority: ProjectPriority
  /** null = sem urgência. */
  urgency: Urgency | null
  /** Área responsável ativa (null limpa; ausente = não muda). */
  areaId?: string | null
  startDate: string | null
  dueDate: string | null
}

export interface ProjectRepository {
  list(query: ProjectListQuery): Promise<Page<Project>>
  get(id: string): Promise<Project>
  create(data: ProjectData & { key: string }): Promise<Project>
  update(id: string, data: Partial<ProjectData>): Promise<Project>
  archive(id: string): Promise<Project>
  unarchive(id: string): Promise<Project>
  remove(id: string): Promise<void>
  transferOwnership(id: string, userId: string): Promise<Project>
  listMembers(id: string): Promise<ProjectMember[]>
  addMember(id: string, userId: string, role: MemberRole): Promise<ProjectMember[]>
  updateMemberRole(id: string, userId: string, role: MemberRole): Promise<ProjectMember[]>
  removeMember(id: string, userId: string): Promise<void>
  memberCandidates(id: string, search: string): Promise<UserSummary[]>
  history(id: string, query: Pick<ListQuery, 'page' | 'perPage'>): Promise<Page<AuditEntry>>
}

export interface FieldOptionInput {
  id?: string
  label: string
  color: OptionColor
  isActive: boolean
  isDefault: boolean
}

export interface CustomFieldInput {
  label: string
  name?: string
  type?: FieldType
  description: string
  config: FieldConfig
  defaultValue?: FieldValue
  searchable: boolean
  filterable: boolean
  sortable: boolean
  options?: FieldOptionInput[]
}

export interface CustomFieldRepository {
  list(query?: { search?: string; type?: FieldType }): Promise<CustomField[]>
  get(id: string): Promise<CustomField>
  create(data: CustomFieldInput): Promise<CustomField>
  update(id: string, data: Partial<CustomFieldInput>): Promise<CustomField>
  remove(id: string): Promise<void>
  /** "Adicionar opção" pela tarefa: cria no fim (ou devolve a de mesmo rótulo, reativada se preciso). */
  addOption(fieldId: string, label: string): Promise<FieldOption>
}

export interface TaskTypeInput {
  key?: string
  /** Original (pt-BR). */
  name: string
  description: string
  /** Traduções opcionais; substituem as anteriores (vazio = usa o original). */
  translations?: Partial<Record<TranslatedLocale, Partial<TypeTexts>>>
  icon: TaskTypeIcon
  color: OptionColor
  isActive?: boolean
}

export interface TaskTypeFieldInput {
  fieldId: string
  required: boolean
  visible: boolean
  showOnCard: boolean
  /** Status em que o campo passa a ser exigido (além de `required`). */
  requiredStatusIds: string[]
}

export interface TaskTypeRepository {
  list(options?: { includeInactive?: boolean }): Promise<TaskType[]>
  get(id: string): Promise<TaskTypeDetail>
  create(data: TaskTypeInput & { key: string }): Promise<TaskTypeDetail>
  update(id: string, data: Partial<TaskTypeInput>): Promise<TaskTypeDetail>
  remove(id: string): Promise<void>
  reorder(ids: string[]): Promise<TaskType[]>
  setFields(id: string, fields: TaskTypeFieldInput[]): Promise<TaskTypeDetail>
  history(id: string): Promise<Page<AuditEntry>>
}

export interface LookupInput {
  name: string
  description: string
  color: OptionColor
  isActive?: boolean
  isDefault?: boolean
  /** Só em status. */
  category?: StatusCategory
  wipLimit?: number
  allowedNext?: string[]
}

/** Status e prioridades (mesmo contrato; ver domain/workflow.ts). */
export interface LookupRepository<T extends LookupItem = LookupItem> {
  list(options?: { includeInactive?: boolean }): Promise<T[]>
  create(data: LookupInput & { key: string }): Promise<T>
  update(id: string, data: Partial<LookupInput>): Promise<T>
  remove(id: string): Promise<void>
  reorder(ids: string[]): Promise<T[]>
}

/** Filtros extras da listagem de tarefas (além de busca, ordenação e `filters` da tabela). */
export interface TaskListOptions {
  projectId?: string
  /** Só as tarefas vinculadas a este elemento da Gestão. */
  planItemId?: string
}

export interface TaskRepository {
  list(query: ListQuery, options?: TaskListOptions): Promise<Page<TaskSummary>>
  get(id: string): Promise<TaskDetail>
  create(data: TaskInput & { projectId: string; taskTypeId: string; title: string }): Promise<TaskDetail>
  update(id: string, data: TaskInput): Promise<TaskDetail>
  /** Liga/desliga a tarefa no informe do projeto (não exige os obrigatórios do status). */
  setInReport(id: string, inReport: boolean): Promise<TaskDetail>
  /** Troca a urgência (semáforo; null = sem urgência), sem exigir os obrigatórios do status. */
  setUrgency(id: string, urgency: Urgency | null): Promise<TaskDetail>
  /** Área responsável direto da lista (não exige os obrigatórios do status); null limpa. */
  setArea(id: string, areaId: string | null): Promise<TaskDetail>
  remove(id: string): Promise<void>
  history(id: string): Promise<Page<AuditEntry>>
}

export interface AttachmentRepository {
  list(taskId: string): Promise<Attachment[]>
  /** Um arquivo por vez; `field` = campo de imagem/arquivo; `commentId` = anexo do comentário. */
  upload(taskId: string, file: File, options?: { field?: string; commentId?: string }): Promise<Attachment[]>
  remove(id: string): Promise<void>
}

/** Arquivos do projeto (aba Arquivos): um arquivo por envio. */
export interface ProjectFileRepository {
  list(projectId: string): Promise<ProjectFile[]>
  upload(projectId: string, file: File): Promise<ProjectFile[]>
  remove(id: string): Promise<void>
}

export interface NotificationRepository {
  list(query: { page: number; perPage: number; unreadOnly?: boolean }): Promise<Page<AppNotification>>
  unreadCount(): Promise<number>
  markRead(id: string): Promise<void>
  markAllRead(): Promise<number>
}

/** Biblioteca de ícones da plataforma (regras §25). */
export interface IconLibraryRepository {
  list(): Promise<LibraryIcon[]>
  /** Importa da galeria (nomes do Lucide); devolve a biblioteca. */
  importIcons(names: string[]): Promise<LibraryIcon[]>
  remove(name: string): Promise<void>
}

export interface TagRepository {
  list(): Promise<Tag[]>
  create(data: { name: string; color: OptionColor }): Promise<Tag>
  update(id: string, data: { name?: string; color?: OptionColor }): Promise<Tag>
  remove(id: string): Promise<void>
}

export interface CommentRepository {
  list(taskId: string): Promise<TaskComment[]>
  /** `content` no formato salvo (menções `@[Nome](id)`). */
  create(taskId: string, content: string): Promise<TaskComment>
  update(id: string, content: string): Promise<TaskComment>
  remove(id: string): Promise<void>
  /** Pessoas que podem ser mencionadas na tarefa. */
  mentionCandidates(taskId: string): Promise<UserSummary[]>
}

/** Quadro Kanban do projeto. */
export interface BoardRepository {
  get(projectId: string): Promise<Board>
  /** Quadro de todos os projetos que a pessoa vê (cada card traz o projeto e se pode movê-lo). */
  /** Quadro de todos os projetos; `projectIds` restringe (configurador do filtro de projetos). */
  getAll(projectIds?: string[]): Promise<Board>
  /** Move o card para o status, entre prevId (acima) e nextId (abaixo). */
  move(taskId: string, target: { statusId: string; prevId?: string; nextId?: string }): Promise<TaskDetail>
}

/** Indicadores e relatórios (período sempre explícito). */
export interface ReportRepository {
  get(query: ReportQuery): Promise<Report>
  /** Detalhamento de um indicador: as tarefas por trás do número (mesmo período e filtros). */
  listTasks(query: ReportQuery, metric: ReportMetric, page: { page: number; perPage: number }): Promise<Page<ReportTask>>
}

/** Painel executivo: Gestão de projetos + Kanban de atividades consolidados (permissão executive.view). */
export interface ExecutiveRepository {
  get(query: ExecutiveQuery): Promise<ExecutiveDashboard>
}

/** Timeline do projeto (tarefas com datas, dependências, sprints e marcos numa chamada). */
export interface TimelineRepository {
  get(projectId: string): Promise<Timeline>
}

/** Marcos do projeto. */
export interface MilestoneRepository {
  list(projectId: string): Promise<Milestone[]>
  create(projectId: string, input: MilestoneInput): Promise<Milestone>
  update(id: string, input: MilestoneInput): Promise<Milestone>
  remove(id: string): Promise<void>
}

/** Ficha do projeto: objetivo geral, itens com o avanço calculado e medições dos resultados. */
export interface CharterRepository {
  get(projectId: string): Promise<ProjectCharter>
  saveObjective(projectId: string, objective: string): Promise<ProjectCharter>
  createItem(projectId: string, input: CharterItemInput): Promise<CharterItem>
  updateItem(id: string, input: CharterItemInput): Promise<CharterItem>
  removeItem(id: string): Promise<void>
  reorder(projectId: string, kind: CharterKind, ids: string[]): Promise<ProjectCharter>
  measurements(itemId: string): Promise<CharterMeasurement[]>
  addMeasurement(itemId: string, input: MeasurementInput): Promise<CharterItem>
}

/** Quadro do projeto (Gerenciamento de Projetos): grupos, elementos e etiquetas próprias. */
export interface PlanRepository {
  get(projectId: string): Promise<Plan>
  createGroup(projectId: string, input: PlanGroupInput): Promise<PlanGroup>
  updateGroup(id: string, input: PlanGroupInput): Promise<PlanGroup>
  moveGroup(id: string, target: PlanGroupMove): Promise<PlanGroup>
  duplicateGroup(id: string): Promise<PlanGroup>
  deleteGroup(id: string): Promise<{ deleted: number; items: number }>
  createItem(projectId: string, input: PlanItemInput): Promise<PlanItem>
  updateItem(id: string, input: PlanItemInput): Promise<PlanItem>
  deleteItem(id: string): Promise<{ deleted: number }>
  createStatus(projectId: string, input: PlanStatusInput): Promise<PlanStatus>
  updateStatus(id: string, input: PlanStatusInput): Promise<PlanStatus>
  deleteStatus(id: string): Promise<{ deleted: boolean; items: number }>
  createResource(projectId: string, input: PlanResourceInput): Promise<PlanResource>
  updateResource(id: string, input: PlanResourceInput): Promise<PlanResource>
  deleteResource(id: string): Promise<{ deleted: boolean; items: number }>
  moveItem(id: string, target: PlanItemMove): Promise<PlanItem>
  duplicateItem(id: string): Promise<PlanItem>
  bulk(projectId: string, input: PlanBulkInput): Promise<PlanBulkResult>
  createLink(itemId: string, input: { kind: PlanLinkKind; itemId: string }): Promise<PlanLink>
  deleteLink(id: string): Promise<void>
  updateSettings(projectId: string, input: { dependencyRule: DependencyRule }): Promise<{ dependencyRule: DependencyRule }>
  importItems(projectId: string, rows: PlanImportRow[]): Promise<PlanImportResult>
  // painel do elemento (GP-3)
  listUpdates(itemId: string): Promise<PlanUpdates>
  /** Com `files`, as imagens/arquivos seguem junto (tudo ou nada). */
  createUpdate(itemId: string, input: PlanUpdateInput): Promise<PlanUpdate>
  editUpdate(id: string, content: string): Promise<PlanUpdate>
  deleteUpdate(id: string): Promise<void>
  mentionCandidates(itemId: string): Promise<UserSummary[]>
  /** O autor anexa mais à atualização. */
  addUpdateFiles(updateId: string, files: File[]): Promise<PlanFile[]>
  deleteFile(id: string): Promise<void>
  history(itemId: string): Promise<Page<AuditEntry>>
  // visões e gestão (GP-4)
  saveBaseline(projectId: string): Promise<{ savedAt: Date | null; items: number }>
  clearBaseline(projectId: string): Promise<void>
  listJournal(projectId: string): Promise<PlanJournal>
  createJournalEntry(projectId: string, input: JournalInput): Promise<JournalEntry>
  updateJournalEntry(id: string, input: JournalInput): Promise<JournalEntry>
  deleteJournalEntry(id: string): Promise<void>
  listIssues(projectId: string): Promise<PlanIssues>
  createIssue(projectId: string, input: IssueInput): Promise<PlanIssue>
  updateIssue(id: string, input: IssueInput): Promise<PlanIssue>
  deleteIssue(id: string): Promise<void>
  /** `tzOffset`: minutos (Date#getTimezoneOffset) — "hoje" no fuso de quem consulta. */
  report(projectId: string, tzOffset: number): Promise<PlanReport>
  // colunas personalizadas (GP-5; o valor da célula vai no updateItem, `custom`)
  createColumn(projectId: string, input: PlanColumnInput): Promise<PlanColumn>
  updateColumn(id: string, input: PlanColumnInput): Promise<PlanColumn>
  /** Quantos valores convertem e quantos se perdem (nada é gravado). */
  previewColumnType(id: string, input: PlanColumnInput): Promise<ColumnTypePreview>
  changeColumnType(id: string, input: PlanColumnInput): Promise<PlanColumn>
  duplicateColumn(id: string): Promise<PlanColumn>
  deleteColumn(id: string): Promise<{ values: number }>
}

/** Documentação: espaços, páginas (rascunho/publicação/versões), árvore, busca e arquivos. */
export interface DocsRepository {
  listSpaces(): Promise<DocSpace[]>
  getSpace(key: string): Promise<DocSpaceDetail>
  createSpace(input: DocSpaceInput): Promise<DocSpace>
  updateSpace(id: string, input: DocSpaceInput): Promise<DocSpace>
  deleteSpace(id: string): Promise<void>
  createPage(spaceId: string, input: { title: string; parentId?: string | null }): Promise<DocPage>
  getPage(id: string): Promise<DocPage>
  deletePage(id: string): Promise<number>
  getDraft(id: string): Promise<DocDraft>
  saveDraft(id: string, input: { title: string; content: RichContent }): Promise<Date | null>
  discardDraft(id: string): Promise<void>
  publish(id: string, input?: { title?: string; content?: RichContent }): Promise<DocPage>
  move(id: string, target: DocMoveTarget): Promise<DocPage>
  listVersions(id: string): Promise<DocVersion[]>
  getVersion(id: string, version: number): Promise<DocVersionDetail>
  restoreVersion(id: string, version: number): Promise<DocPage>
  uploadFiles(pageId: string, files: File[]): Promise<DocFile[]>
  search(q: string): Promise<DocSearchResult[]>
  recent(): Promise<DocRecent[]>
}

/** Relacionamentos, subtarefas e fork. */
export interface RelationRepository {
  list(taskId: string): Promise<TaskRelations>
  /** `type` do ponto de vista da tarefa `taskId` (pai/filho são tratados pela edição da tarefa). */
  create(taskId: string, input: { type: Exclude<LinkOption, 'parent' | 'child'>; targetId: string }): Promise<TaskRelation>
  remove(relationId: string): Promise<void>
  fork(taskId: string, input: ForkInput): Promise<TaskDetail>
}

/** Backlog do projeto (priorização e planejamento em sprints). */
export interface BacklogRepository {
  get(projectId: string): Promise<BacklogView>
  /** Coloca entre prevId e nextId; `sprintId` presente troca a sprint (null = sem sprint). */
  rank(taskId: string, target: { prevId?: string; nextId?: string; sprintId?: string | null }): Promise<TaskDetail>
}

export interface SprintRepository {
  list(projectId: string, options?: { includeClosed?: boolean }): Promise<Sprint[]>
  create(projectId: string, data: SprintInput & { name: string }): Promise<Sprint>
  /** Ao encerrar, `returnedCount` = itens devolvidos ao backlog sem sprint. */
  update(id: string, data: SprintInput): Promise<Sprint & { returnedCount?: number }>
  remove(id: string): Promise<void>
  /** Ordem manual das sprints abertas (lista completa). */
  reorder(projectId: string, ids: string[]): Promise<Sprint[]>
}

export interface Repositories {
  auth: AuthRepository
  users: UserRepository
  roles: RoleRepository
  audit: AuditRepository
  projects: ProjectRepository
  customFields: CustomFieldRepository
  taskTypes: TaskTypeRepository
  statuses: LookupRepository<TaskStatus>
  priorities: LookupRepository<TaskPriority>
  areas: LookupRepository<Area>
  tasks: TaskRepository
  tags: TagRepository
  icons: IconLibraryRepository
  comments: CommentRepository
  attachments: AttachmentRepository
  projectFiles: ProjectFileRepository
  notifications: NotificationRepository
  board: BoardRepository
  backlog: BacklogRepository
  relations: RelationRepository
  reports: ReportRepository
  executive: ExecutiveRepository
  timeline: TimelineRepository
  milestones: MilestoneRepository
  charter: CharterRepository
  plan: PlanRepository
  docs: DocsRepository
  sprints: SprintRepository
  platform: PlatformRepository
  email: EmailRepository
  apiTokens: ApiTokenRepository
  webhooks: WebhookRepository
  preferences: PreferenceRepository
}
