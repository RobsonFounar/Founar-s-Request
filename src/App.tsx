import { useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  collectMissingVariables,
  resolveRequestInput,
} from './lib/environments'
import { importCurl, importOpenApi } from './lib/importers'
import { executeRequest, runLoadTest } from './lib/requestRunner'
import type {
  AuthConfig,
  CollectionItem,
  EnvironmentColor,
  EnvironmentItem,
  ExecuteRequestInput,
  HistoryEntry,
  HttpMethod,
  KeyValueRow,
  LoadTestConfig,
  LoadTestResult,
  RequestBody,
  RequestResponse,
  RequestTab,
  SavedRequestItem,
} from './types'

const METHODS: HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]

const TABS_STORAGE_KEY = 'runner.tabs'
const ACTIVE_TAB_STORAGE_KEY = 'runner.activeTabId'
const HISTORY_STORAGE_KEY = 'runner.history'
const COLLECTIONS_STORAGE_KEY = 'runner.collections'
const ACTIVE_COLLECTION_STORAGE_KEY = 'runner.activeCollectionId'
const ENVIRONMENTS_STORAGE_KEY = 'runner.environments'
const ACTIVE_ENVIRONMENT_STORAGE_KEY = 'runner.activeEnvironmentId'
const HISTORY_LIMIT = 20
const DEFAULT_LOAD_TEST_CONFIG: LoadTestConfig = {
  totalRequests: 20,
  concurrency: 5,
}
const ENVIRONMENT_COLOR_OPTIONS: Array<{
  value: EnvironmentColor
  label: string
}> = [
  { value: 'verde', label: 'Verde' },
  { value: 'vermelho', label: 'Vermelho' },
  { value: 'amarelo', label: 'Amarelo' },
  { value: 'branco', label: 'Branco' },
  { value: 'lilas', label: 'Lilas' },
]

const createRow = (key = '', value = ''): KeyValueRow => ({
  id: crypto.randomUUID(),
  key,
  value,
  enabled: true,
})

const createDefaultTab = (index: number): RequestTab => ({
  id: crypto.randomUUID(),
  name: `Request ${index}`,
  method: 'GET',
  url: '',
  headers: [createRow()],
  queryParams: [createRow()],
  auth: { type: 'none' },
  body: { mode: 'none' },
})

const createDefaultEnvironment = (index: number): EnvironmentItem => ({
  id: crypto.randomUUID(),
  name: index === 1 ? 'Default' : `Environment ${index}`,
  color: 'branco',
  variables: [createRow()],
})

const createDefaultCollection = (index: number): CollectionItem => ({
  id: crypto.randomUUID(),
  name: index === 1 ? 'Minha Collection' : `Collection ${index}`,
  requests: [],
})

const readStorage = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)

    if (!raw) {
      return fallback
    }

    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const cloneTab = (tab: RequestTab): RequestTab => ({
  ...tab,
  id: crypto.randomUUID(),
  headers: tab.headers.map((row) => ({ ...row, id: crypto.randomUUID() })),
  queryParams: tab.queryParams.map((row) => ({
    ...row,
    id: crypto.randomUUID(),
  })),
  body:
    tab.body.mode === 'form'
      ? {
          ...tab.body,
          entries: tab.body.entries.map((row) => ({
            ...row,
            id: crypto.randomUUID(),
          })),
        }
      : { ...tab.body },
  response: tab.response ? { ...tab.response } : undefined,
  isSending: false,
  collectionId: undefined,
  savedRequestId: undefined,
})

const buildRequestInput = (tab: RequestTab): ExecuteRequestInput => ({
  method: tab.method,
  url: tab.url,
  headers: tab.headers,
  queryParams: tab.queryParams,
  auth: tab.auth,
  body: tab.body,
})

function App() {
  const [tabs, setTabs] = useState<RequestTab[]>(() => {
    const stored = readStorage<RequestTab[]>(TABS_STORAGE_KEY, [])

    if (stored.length === 0) {
      return [createDefaultTab(1)]
    }

    return stored.map(hydrateTab)
  })
  const [activeTabId, setActiveTabId] = useState(() =>
    readStorage<string>(ACTIVE_TAB_STORAGE_KEY, ''),
  )
  const [history, setHistory] = useState<HistoryEntry[]>(() =>
    readStorage<HistoryEntry[]>(HISTORY_STORAGE_KEY, []).map(hydrateHistoryEntry),
  )
  const [collections, setCollections] = useState<CollectionItem[]>(() => {
    const stored = readStorage<CollectionItem[]>(COLLECTIONS_STORAGE_KEY, [])

    if (stored.length === 0) {
      return [createDefaultCollection(1)]
    }

    return stored.map(hydrateCollection)
  })
  const [activeCollectionId, setActiveCollectionId] = useState(() =>
    readStorage<string>(ACTIVE_COLLECTION_STORAGE_KEY, ''),
  )
  const [curlImportText, setCurlImportText] = useState('')
  const [openApiImportText, setOpenApiImportText] = useState('')
  const [importFeedback, setImportFeedback] = useState<{
    tone: 'success' | 'error'
    message: string
  } | null>(null)
  const [loadTestConfig, setLoadTestConfig] = useState<LoadTestConfig>(
    DEFAULT_LOAD_TEST_CONFIG,
  )
  const [loadTestResult, setLoadTestResult] = useState<LoadTestResult | null>(null)
  const [loadTestFeedback, setLoadTestFeedback] = useState<string | null>(null)
  const [isRunningLoadTest, setIsRunningLoadTest] = useState(false)
  const [environments, setEnvironments] = useState<EnvironmentItem[]>(() => {
    const stored = readStorage<EnvironmentItem[]>(ENVIRONMENTS_STORAGE_KEY, [])

    if (stored.length === 0) {
      return [createDefaultEnvironment(1)]
    }

    return stored.map(hydrateEnvironment)
  })
  const [activeEnvironmentId, setActiveEnvironmentId] = useState(() =>
    readStorage<string>(ACTIVE_ENVIRONMENT_STORAGE_KEY, ''),
  )

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  )
  const activeEnvironment = useMemo(
    () =>
      environments.find((environment) => environment.id === activeEnvironmentId) ??
      environments[0],
    [activeEnvironmentId, environments],
  )
  const activeCollection = useMemo(
    () =>
      collections.find((collection) => collection.id === activeCollectionId) ??
      collections[0],
    [activeCollectionId, collections],
  )
  const activeInput = useMemo(
    () => (activeTab ? buildRequestInput(activeTab) : undefined),
    [activeTab],
  )
  const resolvedInput = useMemo(
    () =>
      activeInput ? resolveRequestInput(activeInput, activeEnvironment) : undefined,
    [activeEnvironment, activeInput],
  )
  const missingVariables = useMemo(
    () =>
      activeInput ? collectMissingVariables(activeInput, activeEnvironment) : [],
    [activeEnvironment, activeInput],
  )

  useEffect(() => {
    const persistedTabs = tabs.map((tab) => ({
      ...tab,
      isSending: false,
    }))

    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(persistedTabs))
  }, [tabs])

  useEffect(() => {
    if (!activeTab) {
      return
    }

    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab.id)
  }, [activeTab])

  useEffect(() => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history))
  }, [history])

  useEffect(() => {
    localStorage.setItem(COLLECTIONS_STORAGE_KEY, JSON.stringify(collections))
  }, [collections])

  useEffect(() => {
    if (!activeCollection) {
      return
    }

    localStorage.setItem(ACTIVE_COLLECTION_STORAGE_KEY, activeCollection.id)
  }, [activeCollection])

  useEffect(() => {
    localStorage.setItem(
      ENVIRONMENTS_STORAGE_KEY,
      JSON.stringify(environments),
    )
  }, [environments])

  useEffect(() => {
    if (!activeEnvironment) {
      return
    }

    localStorage.setItem(ACTIVE_ENVIRONMENT_STORAGE_KEY, activeEnvironment.id)
  }, [activeEnvironment])

  const updateActiveTab = (updater: (tab: RequestTab) => RequestTab) => {
    if (!activeTab) {
      return
    }

    setTabs((currentTabs) =>
      currentTabs.map((tab) => (tab.id === activeTab.id ? updater(tab) : tab)),
    )
  }

  const addTab = (source?: RequestTab) => {
    const nextTab = source ? cloneTab(source) : createDefaultTab(tabs.length + 1)

    setTabs((currentTabs) => [...currentTabs, nextTab])
    setActiveTabId(nextTab.id)
  }

  const closeTab = (tabId: string) => {
    if (tabs.length === 1) {
      const freshTab = createDefaultTab(1)
      setTabs([freshTab])
      setActiveTabId(freshTab.id)
      return
    }

    const currentIndex = tabs.findIndex((tab) => tab.id === tabId)
    const nextTabs = tabs.filter((tab) => tab.id !== tabId)
    const nextActive = nextTabs[Math.max(currentIndex - 1, 0)] ?? nextTabs[0]

    setTabs(nextTabs)
    setActiveTabId(nextActive.id)
  }

  const updateActiveEnvironment = (
    updater: (environment: EnvironmentItem) => EnvironmentItem,
  ) => {
    if (!activeEnvironment) {
      return
    }

    setEnvironments((currentEnvironments) =>
      currentEnvironments.map((environment) =>
        environment.id === activeEnvironment.id ? updater(environment) : environment,
      ),
    )
  }

  const addEnvironment = () => {
    const nextEnvironment = createDefaultEnvironment(environments.length + 1)

    setEnvironments((currentEnvironments) => [
      ...currentEnvironments,
      nextEnvironment,
    ])
    setActiveEnvironmentId(nextEnvironment.id)
  }

  const deleteActiveEnvironment = () => {
    if (!activeEnvironment) {
      return
    }

    if (environments.length === 1) {
      const freshEnvironment = createDefaultEnvironment(1)
      setEnvironments([freshEnvironment])
      setActiveEnvironmentId(freshEnvironment.id)
      return
    }

    const currentIndex = environments.findIndex(
      (environment) => environment.id === activeEnvironment.id,
    )
    const nextEnvironments = environments.filter(
      (environment) => environment.id !== activeEnvironment.id,
    )
    const nextActive =
      nextEnvironments[Math.max(currentIndex - 1, 0)] ?? nextEnvironments[0]

    setEnvironments(nextEnvironments)
    setActiveEnvironmentId(nextActive.id)
  }

  const updateActiveCollection = (
    updater: (collection: CollectionItem) => CollectionItem,
  ) => {
    if (!activeCollection) {
      return
    }

    setCollections((currentCollections) =>
      currentCollections.map((collection) =>
        collection.id === activeCollection.id ? updater(collection) : collection,
      ),
    )
  }

  const addCollection = () => {
    const nextCollection = createDefaultCollection(collections.length + 1)

    setCollections((currentCollections) => [
      ...currentCollections,
      nextCollection,
    ])
    setActiveCollectionId(nextCollection.id)
  }

  const deleteActiveCollection = () => {
    if (!activeCollection) {
      return
    }

    if (collections.length === 1) {
      const freshCollection = createDefaultCollection(1)
      setCollections([freshCollection])
      setActiveCollectionId(freshCollection.id)
      clearCollectionLinks(activeCollection.id)
      return
    }

    const currentIndex = collections.findIndex(
      (collection) => collection.id === activeCollection.id,
    )
    const nextCollections = collections.filter(
      (collection) => collection.id !== activeCollection.id,
    )
    const nextActive =
      nextCollections[Math.max(currentIndex - 1, 0)] ?? nextCollections[0]

    setCollections(nextCollections)
    setActiveCollectionId(nextActive.id)
    clearCollectionLinks(activeCollection.id)
  }

  const saveActiveTabToCollection = () => {
    if (!activeTab || !activeCollection) {
      return
    }

    const now = new Date().toISOString()
    const shouldUpdateExisting =
      activeTab.collectionId === activeCollection.id &&
      Boolean(activeTab.savedRequestId) &&
      activeCollection.requests.some(
        (request) => request.id === activeTab.savedRequestId,
      )
    const savedRequestId = shouldUpdateExisting
      ? (activeTab.savedRequestId as string)
      : crypto.randomUUID()
    const baseSavedRequest = createSavedRequestFromTab(
      {
        ...activeTab,
        savedRequestId,
      },
      activeCollection.id,
      now,
    )

    setCollections((currentCollections) =>
      currentCollections.map((collection) => {
        if (collection.id !== activeCollection.id) {
          return collection
        }

        if (shouldUpdateExisting) {
          return {
            ...collection,
            requests: collection.requests.map((request) =>
              request.id === savedRequestId
                ? {
                    ...baseSavedRequest,
                  }
                : request,
            ),
          }
        }

        return {
          ...collection,
          requests: [baseSavedRequest, ...collection.requests],
        }
      }),
    )

    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.id === activeTab.id
          ? {
              ...tab,
              collectionId: activeCollection.id,
              savedRequestId,
            }
          : tab,
      ),
    )
  }

  const openSavedRequest = (
    collectionId: string,
    savedRequest: SavedRequestItem,
  ) => {
    const existingTab = tabs.find(
      (tab) =>
        tab.collectionId === collectionId &&
        tab.savedRequestId === savedRequest.id,
    )

    if (existingTab) {
      setActiveTabId(existingTab.id)
      return
    }

    const nextTab = createTabFromSavedRequest(savedRequest, collectionId)

    setTabs((currentTabs) => [...currentTabs, nextTab])
    setActiveTabId(nextTab.id)
  }

  const deleteSavedRequest = (collectionId: string, savedRequestId: string) => {
    setCollections((currentCollections) =>
      currentCollections.map((collection) =>
        collection.id === collectionId
          ? {
              ...collection,
              requests: collection.requests.filter(
                (request) => request.id !== savedRequestId,
              ),
            }
          : collection,
      ),
    )

    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.collectionId === collectionId && tab.savedRequestId === savedRequestId
          ? {
              ...tab,
              collectionId: undefined,
              savedRequestId: undefined,
            }
          : tab,
      ),
    )
  }

  const importCurlIntoActiveTab = () => {
    if (!activeTab) {
      return
    }

    try {
      const importedTab = importCurl(curlImportText, activeTab)

      setTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === activeTab.id
            ? {
                ...importedTab,
                id: tab.id,
                collectionId: tab.collectionId,
                savedRequestId: tab.savedRequestId,
              }
            : tab,
        ),
      )

      setImportFeedback({
        tone: 'success',
        message: 'cURL importado na aba atual com sucesso.',
      })
    } catch (error) {
      setImportFeedback({
        tone: 'error',
        message:
          error instanceof Error ? error.message : 'Falha ao importar o cURL.',
      })
    }
  }

  const importOpenApiToCollections = () => {
    try {
      const result = importOpenApi(openApiImportText)
      const collectionId = crypto.randomUUID()
      const importedRequests = result.requests.map((request) => {
        const savedRequestId = crypto.randomUUID()

        return createSavedRequestFromTab(
          {
            ...request,
            collectionId,
            savedRequestId,
          },
          collectionId,
          new Date().toISOString(),
        )
      })
      const importedCollection: CollectionItem = {
        id: collectionId,
        name: result.collectionName,
        requests: importedRequests,
      }

      setCollections((currentCollections) => [
        importedCollection,
        ...currentCollections,
      ])
      setActiveCollectionId(collectionId)

      if (importedRequests[0]) {
        const nextTab = createTabFromSavedRequest(importedRequests[0], collectionId)

        setTabs((currentTabs) => [...currentTabs, nextTab])
        setActiveTabId(nextTab.id)
      }

      setImportFeedback({
        tone: 'success',
        message: `OpenAPI importado em "${result.collectionName}" com ${importedRequests.length} request(s).`,
      })
    } catch (error) {
      setImportFeedback({
        tone: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Falha ao importar a especificacao OpenAPI.',
      })
    }
  }

  const loadOpenApiFile = async (file?: File) => {
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      setOpenApiImportText(text)
      setImportFeedback({
        tone: 'success',
        message: `Arquivo "${file.name}" carregado para importacao.`,
      })
    } catch {
      setImportFeedback({
        tone: 'error',
        message: 'Nao foi possivel ler o arquivo OpenAPI selecionado.',
      })
    }
  }

  const clearCollectionLinks = (collectionId: string) => {
    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.collectionId === collectionId
          ? {
              ...tab,
              collectionId: undefined,
              savedRequestId: undefined,
            }
          : tab,
      ),
    )
  }

  const updateLoadTestConfig = (
    key: keyof LoadTestConfig,
    value: number,
  ) => {
    setLoadTestConfig((currentConfig) => ({
      ...currentConfig,
      [key]:
        key === 'concurrency'
          ? clampNumber(value, 1, 50)
          : clampNumber(value, 1, 1000),
    }))
  }

  const sendRequest = async () => {
    if (!activeTab) {
      return
    }

    const requestInput = buildRequestInput(activeTab)
    const unresolvedVariables = collectMissingVariables(
      requestInput,
      activeEnvironment,
    )

    if (unresolvedVariables.length > 0) {
      const missingResponse: RequestResponse = {
        ok: false,
        status: 400,
        statusText: 'Missing Variables',
        durationMs: 0,
        headers: [],
        body: '',
        receivedAt: new Date().toISOString(),
        error: `Defina as variaveis antes de enviar: ${unresolvedVariables.join(', ')}`,
      }

      setTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === activeTab.id
            ? {
                ...tab,
                response: missingResponse,
                isSending: false,
              }
            : tab,
        ),
      )
      return
    }

    updateActiveTab((tab) => ({ ...tab, isSending: true }))

    const payload = resolveRequestInput(requestInput, activeEnvironment)

    try {
      const response = await executeRequest(payload)
      const nextHistoryEntry = createHistoryEntry(
        activeTab,
        response,
        activeEnvironment,
        payload.url,
      )

      setTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === activeTab.id
            ? {
                ...tab,
                response,
                isSending: false,
              }
            : tab,
        ),
      )

      setHistory((currentHistory) =>
        [nextHistoryEntry, ...currentHistory].slice(0, HISTORY_LIMIT),
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Falha ao executar request.'
      const fallbackResponse: RequestResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        durationMs: 0,
        headers: [],
        body: '',
        receivedAt: new Date().toISOString(),
        error: message,
      }

      setTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === activeTab.id
            ? {
                ...tab,
                response: fallbackResponse,
                isSending: false,
              }
            : tab,
        ),
      )
    }
  }

  const executeLoadTestForActiveTab = async () => {
    if (!activeTab) {
      return
    }

    const requestInput = buildRequestInput(activeTab)
    const unresolvedVariables = collectMissingVariables(
      requestInput,
      activeEnvironment,
    )

    if (unresolvedVariables.length > 0) {
      setLoadTestFeedback(
        `Defina as variaveis antes de iniciar a carga: ${unresolvedVariables.join(', ')}`,
      )
      return
    }

    setIsRunningLoadTest(true)
    setLoadTestFeedback(null)

    try {
      const payload = resolveRequestInput(requestInput, activeEnvironment)
      const result = await runLoadTest(payload, loadTestConfig)
      setLoadTestResult(result)
    } catch (error) {
      setLoadTestFeedback(
        error instanceof Error
          ? error.message
          : 'Falha ao executar o teste de carga.',
      )
    } finally {
      setIsRunningLoadTest(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Founar Request · Beta</p>
          <h1>Cliente de APIs com requests, collections e testes</h1>
          <p className="subtle">
            Primeira base do Founar Request para enviar requests HTTP, organizar
            fluxos e validar APIs em um unico lugar.
          </p>
        </div>
        <div className="header-actions">
          <button className="ghost-button" type="button" onClick={() => addTab()}>
            Nova aba
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={sendRequest}
            disabled={!activeTab || activeTab.isSending}
          >
            {activeTab?.isSending ? 'Enviando...' : 'Enviar request'}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          {activeCollection && (
            <section className="panel">
              <CollectionsEditor
                activeCollection={activeCollection}
                activeTab={activeTab}
                collections={collections}
                onAdd={addCollection}
                onChange={(collection) =>
                  updateActiveCollection(() => collection)
                }
                onDelete={deleteActiveCollection}
                onDeleteSavedRequest={deleteSavedRequest}
                onOpenSavedRequest={openSavedRequest}
                onSaveActiveTab={saveActiveTabToCollection}
                onSelect={setActiveCollectionId}
              />
            </section>
          )}

          {activeEnvironment && (
            <section className="panel">
              <EnvironmentEditor
                activeEnvironment={activeEnvironment}
                environments={environments}
                onAdd={addEnvironment}
                onChange={(environment) =>
                  updateActiveEnvironment(() => environment)
                }
                onDelete={deleteActiveEnvironment}
                onSelect={setActiveEnvironmentId}
              />
            </section>
          )}

          <section className="panel">
            <ImportToolsEditor
              curlImportText={curlImportText}
              feedback={importFeedback}
              onCurlImport={importCurlIntoActiveTab}
              onCurlImportTextChange={setCurlImportText}
              onOpenApiFileSelected={loadOpenApiFile}
              onOpenApiImport={importOpenApiToCollections}
              onOpenApiImportTextChange={setOpenApiImportText}
              openApiImportText={openApiImportText}
            />
          </section>

          <div className="sidebar-section">
            <h2>Historico</h2>
            <p className="subtle">
              Ultimas execucoes para reabrir ou repetir um fluxo.
            </p>
          </div>

          <div className="history-list">
            {history.length === 0 ? (
              <div className="empty-card">
                As requests executadas vao aparecer aqui.
              </div>
            ) : (
              history.map((entry) => (
                <button
                  className="history-item"
                  key={entry.id}
                  type="button"
                  onClick={() => addTab(entry.tabSnapshot)}
                >
                  <div className="history-item__top">
                    <span className={`method-chip method-chip--${entry.method.toLowerCase()}`}>
                      {entry.method}
                    </span>
                    <span
                      className={`status-pill ${getStatusToneClass(entry.status)}`}
                    >
                      {entry.status}
                    </span>
                  </div>
                  <strong title={entry.url}>{entry.url || 'URL vazia'}</strong>
                  <span className="history-meta">
                    {entry.durationMs} ms · {formatDate(entry.executedAt)}
                    {entry.environmentName ? ` · ${entry.environmentName}` : ''}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="main-panel">
          <div className="tab-strip">
            {tabs.map((tab) => (
              <div
                className={`tab-pill ${tab.id === activeTab?.id ? 'is-active' : ''}`}
                key={tab.id}
              >
                <button type="button" onClick={() => setActiveTabId(tab.id)}>
                  {tab.name}
                </button>
                <span className="tab-pill__close">
                  <button type="button" onClick={() => closeTab(tab.id)}>
                    x
                  </button>
                </span>
              </div>
            ))}
          </div>

          {activeTab && (
            <>
              <section className="panel request-panel">
                <div className="request-topbar">
                  <div className="request-context request-context--top">
                    <span className="request-context-pill">
                      <span className="request-context-pill__label">
                        Environment ativo:{' '}
                      </span>
                      <span
                        className={`request-context-pill__value environment-color-text environment-color-text--${activeEnvironment?.color ?? 'branco'}`}
                      >
                        {activeEnvironment?.name ?? 'Nenhum'}
                      </span>
                    </span>
                    <span className="request-context-pill">
                      <span className="request-context-pill__label">
                        Collection:{' '}
                      </span>
                      <span className="request-context-pill__value environment-color-text environment-color-text--branco">
                        {activeCollection?.name ?? 'Nenhuma'}
                      </span>
                    </span>
                  </div>
                </div>

                <label className="request-name-row">
                  <span className="request-name-row__label">Nome da aba</span>
                  <input
                    className="request-name-row__input"
                    type="text"
                    value={activeTab.name}
                    onChange={(event) =>
                      updateActiveTab((tab) => ({
                        ...tab,
                        name: event.target.value,
                      }))
                    }
                  />
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => addTab(activeTab)}
                  >
                    Duplicar aba
                  </button>
                </label>

                <div className="request-row">
                  <select
                    className="method-select"
                    value={activeTab.method}
                    onChange={(event) =>
                      updateActiveTab((tab) => ({
                        ...tab,
                        method: event.target.value as HttpMethod,
                      }))
                    }
                  >
                    {METHODS.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>

                  <input
                    className="url-input"
                    type="text"
                    placeholder="https://api.exemplo.com/v1/users"
                    value={activeTab.url}
                    onChange={(event) =>
                      updateActiveTab((tab) => ({
                        ...tab,
                        url: event.target.value,
                      }))
                    }
                  />
                </div>

                <div className="request-context">
                  {activeTab.savedRequestId && activeTab.collectionId && (
                    <span className="subtle">
                      Vinculada a uma request salva.
                    </span>
                  )}
                  {resolvedInput && resolvedInput.url !== activeTab.url && (
                    <span className="subtle">
                      URL resolvida: {resolvedInput.url}
                    </span>
                  )}
                </div>

                {missingVariables.length > 0 && (
                  <div className="warning-banner">
                    Variaveis ausentes: {missingVariables.join(', ')}
                  </div>
                )}

                <div className="request-actions-row">
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={saveActiveTabToCollection}
                    disabled={!activeCollection}
                  >
                    {activeTab.savedRequestId &&
                    activeTab.collectionId === activeCollection?.id
                      ? 'Atualizar request salva'
                      : 'Salvar Request na Collection'}
                  </button>
                </div>
              </section>

              <div className="content-grid">
                <div className="stack">
                  <section className="panel">
                    <h2>Autenticacao</h2>
                    <AuthEditor
                      auth={activeTab.auth}
                      onChange={(auth) =>
                        updateActiveTab((tab) => ({
                          ...tab,
                          auth,
                        }))
                      }
                    />
                  </section>

                  <section className="panel">
                    <KeyValueEditor
                      title="Query params"
                      rows={activeTab.queryParams}
                      onChange={(rows) =>
                        updateActiveTab((tab) => ({
                          ...tab,
                          queryParams: rows,
                        }))
                      }
                    />
                  </section>

                  <section className="panel">
                    <KeyValueEditor
                      title="Headers"
                      rows={activeTab.headers}
                      onChange={(rows) =>
                        updateActiveTab((tab) => ({
                          ...tab,
                          headers: rows,
                        }))
                      }
                    />
                  </section>

                  <section className="panel">
                    <h2>Body</h2>
                    <BodyEditor
                      body={activeTab.body}
                      onChange={(body) =>
                        updateActiveTab((tab) => ({
                          ...tab,
                          body,
                        }))
                      }
                    />
                  </section>
                </div>

                <div className="stack">
                  <section className="panel response-panel">
                    <div className="response-header">
                      <div>
                        <h2>Resposta</h2>
                        <p className="subtle">
                          Status e resposta da ultima execucao da aba atual.
                        </p>
                      </div>
                      {activeTab.response && (
                        <div className="response-meta">
                          <span
                            className={`status-pill ${getStatusToneClass(activeTab.response.status)}`}
                          >
                            {activeTab.response.status}{' '}
                            {activeTab.response.statusText}
                          </span>
                          <span>{activeTab.response.durationMs} ms</span>
                        </div>
                      )}
                    </div>

                    {activeTab.response ? (
                      <div className="response-body">
                        {activeTab.response.error && (
                          <div className="response-error">
                            {activeTab.response.error}
                          </div>
                        )}

                        <div className="response-actions">
                          <button
                            className="ghost-button ghost-button--compact"
                            type="button"
                            onClick={() =>
                              updateActiveTab((tab) => ({
                                ...tab,
                                response: undefined,
                              }))
                            }
                          >
                            Limpar resposta
                          </button>
                        </div>

                        <div className="response-section">
                          <pre>{activeTab.response.body || 'Resposta sem body.'}</pre>
                        </div>
                      </div>
                    ) : (
                      <div className="empty-card">
                        Envie uma request para visualizar a resposta aqui.
                      </div>
                    )}
                  </section>

                  <section className="panel">
                    <LoadTestEditor
                      config={loadTestConfig}
                      feedback={loadTestFeedback}
                      isRunning={isRunningLoadTest}
                      onChange={updateLoadTestConfig}
                      onRun={executeLoadTestForActiveTab}
                      result={loadTestResult}
                    />
                  </section>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

type LoadTestEditorProps = {
  config: LoadTestConfig
  result: LoadTestResult | null
  feedback: string | null
  isRunning: boolean
  onRun: () => void
  onChange: (key: keyof LoadTestConfig, value: number) => void
}

function LoadTestEditor({
  config,
  result,
  feedback,
  isRunning,
  onRun,
  onChange,
}: LoadTestEditorProps) {
  return (
    <div className="stack gap-sm">
      <div className="response-header">
        <div>
          <h2>Teste de carga</h2>
          <p className="subtle">
            Executa varias chamadas da request atual com concorrencia controlada.
          </p>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={onRun}
          disabled={isRunning}
        >
          {isRunning ? 'Executando carga...' : 'Iniciar carga'}
        </button>
      </div>

      <div className="field-grid">
        <label className="field">
          <span>Total de requests</span>
          <input
            type="number"
            min={1}
            max={1000}
            value={config.totalRequests}
            onChange={(event) =>
              onChange('totalRequests', Number(event.target.value || 0))
            }
          />
        </label>

        <label className="field">
          <span>Concorrencia</span>
          <input
            type="number"
            min={1}
            max={50}
            value={config.concurrency}
            onChange={(event) =>
              onChange('concurrency', Number(event.target.value || 0))
            }
          />
        </label>
      </div>

      <p className="subtle helper-text">
        Use com cuidado em APIs reais. Este MVP foi pensado para validacao rapida,
        nao para testes distribuidos pesados.
      </p>

      {feedback && <div className="import-feedback import-feedback--error">{feedback}</div>}

      {result ? (
        <div className="stack gap-sm">
          <div className="load-test-metrics">
            <div className="metric-card">
              <span className="metric-card__label">Sucesso</span>
              <strong>{result.successfulRequests}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-card__label">Falhas</span>
              <strong>{result.failedRequests}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-card__label">Req/s</span>
              <strong>{formatMetric(result.requestsPerSecond)}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-card__label">Duracao</span>
              <strong>{result.totalDurationMs} ms</strong>
            </div>
            <div className="metric-card">
              <span className="metric-card__label">P50</span>
              <strong>{result.p50LatencyMs} ms</strong>
            </div>
            <div className="metric-card">
              <span className="metric-card__label">P95</span>
              <strong>{result.p95LatencyMs} ms</strong>
            </div>
          </div>

          <div className="field-grid">
            <div className="metric-inline">
              <span className="metric-card__label">Min / Medio / Max</span>
              <strong>
                {result.minLatencyMs} / {formatMetric(result.avgLatencyMs)} /{' '}
                {result.maxLatencyMs} ms
              </strong>
            </div>
            <div className="metric-inline">
              <span className="metric-card__label">Executado em</span>
              <strong>{formatDate(result.startedAt)}</strong>
            </div>
          </div>

          <div className="response-section">
            <h3>Status retornados</h3>
            <div className="status-counts">
              {result.statusCounts.map((statusCount) => (
                <div className="status-count-chip" key={statusCount.label}>
                  <span>{statusCount.label}</span>
                  <strong>{statusCount.count}</strong>
                </div>
              ))}
            </div>
          </div>

          {result.errorSamples.length > 0 && (
            <div className="response-section">
              <h3>Erros observados</h3>
              <div className="error-sample-list">
                {result.errorSamples.map((errorSample) => (
                  <div className="response-error" key={errorSample}>
                    {errorSample}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="empty-card compact-card">
          Execute um teste para visualizar throughput e latencias.
        </div>
      )}
    </div>
  )
}

type AuthEditorProps = {
  auth: AuthConfig
  onChange: (auth: AuthConfig) => void
}

function AuthEditor({ auth, onChange }: AuthEditorProps) {
  return (
    <div className="stack gap-sm">
      <label className="field">
        <span>Tipo</span>
        <select
          value={auth.type}
          onChange={(event) => {
            const nextType = event.target.value as AuthConfig['type']

            if (nextType === 'bearer') {
              onChange({ type: 'bearer', token: '' })
              return
            }

            if (nextType === 'basic') {
              onChange({ type: 'basic', username: '', password: '' })
              return
            }

            if (nextType === 'apiKey') {
              onChange({ type: 'apiKey', key: '', value: '', addTo: 'header' })
              return
            }

            onChange({ type: 'none' })
          }}
        >
          <option value="none">Sem auth</option>
          <option value="bearer">Bearer token</option>
          <option value="basic">Basic auth</option>
          <option value="apiKey">API key</option>
        </select>
      </label>

      {auth.type === 'bearer' && (
        <label className="field">
          <span>Token</span>
          <input
            type="password"
            value={auth.token}
            onChange={(event) =>
              onChange({ ...auth, token: event.target.value })
            }
          />
        </label>
      )}

      {auth.type === 'basic' && (
        <div className="field-grid">
          <label className="field">
            <span>Usuario</span>
            <input
              type="text"
              value={auth.username}
              onChange={(event) =>
                onChange({ ...auth, username: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Senha</span>
            <input
              type="password"
              value={auth.password}
              onChange={(event) =>
                onChange({ ...auth, password: event.target.value })
              }
            />
          </label>
        </div>
      )}

      {auth.type === 'apiKey' && (
        <div className="field-grid">
          <label className="field">
            <span>Chave</span>
            <input
              type="text"
              value={auth.key}
              onChange={(event) => onChange({ ...auth, key: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Valor</span>
            <input
              type="password"
              value={auth.value}
              onChange={(event) =>
                onChange({ ...auth, value: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Adicionar em</span>
            <select
              value={auth.addTo}
              onChange={(event) =>
                onChange({
                  ...auth,
                  addTo: event.target.value as 'header' | 'query',
                })
              }
            >
              <option value="header">Header</option>
              <option value="query">Query param</option>
            </select>
          </label>
        </div>
      )}
    </div>
  )
}

type BodyEditorProps = {
  body: RequestBody
  onChange: (body: RequestBody) => void
}

function BodyEditor({ body, onChange }: BodyEditorProps) {
  return (
    <div className="stack gap-sm">
      <label className="field">
        <span>Modo</span>
        <select
          value={body.mode}
          onChange={(event) => {
            const mode = event.target.value as RequestBody['mode']

            if (mode === 'json' || mode === 'text') {
              onChange({ mode, content: '' })
              return
            }

            if (mode === 'form') {
              onChange({ mode: 'form', entries: [createRow()] })
              return
            }

            onChange({ mode: 'none' })
          }}
        >
          <option value="none">Sem body</option>
          <option value="json">JSON</option>
          <option value="text">Texto</option>
          <option value="form">Form URL Encoded</option>
        </select>
      </label>

      {(body.mode === 'json' || body.mode === 'text') && (
        <label className="field">
          <span>Conteudo</span>
          <textarea
            rows={12}
            value={body.content}
            onChange={(event) =>
              onChange({ ...body, content: event.target.value })
            }
          />
        </label>
      )}

      {body.mode === 'form' && (
        <KeyValueEditor
          title="Campos"
          rows={body.entries}
          onChange={(rows) => onChange({ mode: 'form', entries: rows })}
        />
      )}
    </div>
  )
}

type KeyValueEditorProps = {
  title: string
  rows: KeyValueRow[]
  onChange: (rows: KeyValueRow[]) => void
}

function KeyValueEditor({ title, rows, onChange }: KeyValueEditorProps) {
  return (
    <div className="stack gap-sm">
      <div className="section-heading">
        <h2>{title}</h2>
        <button
          className="ghost-button"
          type="button"
          onClick={() => onChange([...rows, createRow()])}
        >
          Adicionar
        </button>
      </div>

      <div className="kv-list">
        {rows.map((row) => (
          <div className="kv-row" key={row.id}>
            <label className="toggle">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(event) =>
                  onChange(
                    rows.map((current) =>
                      current.id === row.id
                        ? { ...current, enabled: event.target.checked }
                        : current,
                    ),
                  )
                }
              />
              <span>Ativo</span>
            </label>

            <input
              type="text"
              placeholder="chave"
              value={row.key}
              onChange={(event) =>
                onChange(
                  rows.map((current) =>
                    current.id === row.id
                      ? { ...current, key: event.target.value }
                      : current,
                  ),
                )
              }
            />
            <input
              type="text"
              placeholder="valor"
              value={row.value}
              onChange={(event) =>
                onChange(
                  rows.map((current) =>
                    current.id === row.id
                      ? { ...current, value: event.target.value }
                      : current,
                  ),
                )
              }
            />
            <button
              className="danger-button"
              type="button"
              onClick={() => {
                const nextRows = rows.filter((current) => current.id !== row.id)
                onChange(nextRows.length === 0 ? [createRow()] : nextRows)
              }}
            >
              Remover
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

type EnvironmentEditorProps = {
  environments: EnvironmentItem[]
  activeEnvironment: EnvironmentItem
  onSelect: (environmentId: string) => void
  onAdd: () => void
  onDelete: () => void
  onChange: (environment: EnvironmentItem) => void
}

function EnvironmentEditor({
  environments,
  activeEnvironment,
  onSelect,
  onAdd,
  onDelete,
  onChange,
}: EnvironmentEditorProps) {
  const activeEnvironmentColorLabel = getEnvironmentColorLabel(
    activeEnvironment.color,
  )

  return (
    <div className="stack gap-sm">
      <div className="section-heading">
        <h2>Environments</h2>
        <div className="field-actions">
          <button className="ghost-button" type="button" onClick={onAdd}>
            Novo
          </button>
          <button className="danger-button" type="button" onClick={onDelete}>
            Remover
          </button>
        </div>
      </div>

      <label className="field">
        <span>Selecionado</span>
        <select
          value={activeEnvironment.id}
          onChange={(event) => onSelect(event.target.value)}
        >
          {environments.map((environment) => (
            <option key={environment.id} value={environment.id}>
              {environment.name}
            </option>
          ))}
        </select>
      </label>

      <div className="field-grid">
        <label className="field">
          <span>Nome</span>
          <input
            type="text"
            value={activeEnvironment.name}
            onChange={(event) =>
              onChange({
                ...activeEnvironment,
                name: event.target.value,
              })
            }
          />
        </label>

        <label className="field">
          <span>Cor do ambiente</span>
          <select
            className={`environment-color-select environment-color-text--${activeEnvironment.color}`}
            value={activeEnvironment.color}
            onChange={(event) =>
              onChange({
                ...activeEnvironment,
                color: event.target.value as EnvironmentColor,
              })
            }
          >
            {ENVIRONMENT_COLOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="field-preview">
            Cor atual:{' '}
            <span
              className={`environment-color-text environment-color-text--${activeEnvironment.color}`}
            >
              {activeEnvironmentColorLabel}
            </span>
          </span>
        </label>
      </div>

      <p className="subtle helper-text">
        Use variaveis com o formato <code>{'{{baseUrl}}'}</code> em URL, headers,
        body e auth.
      </p>

      <EnvironmentVariablesEditor
        rows={activeEnvironment.variables}
        onChange={(rows) =>
          onChange({
            ...activeEnvironment,
            variables: rows,
          })
        }
      />
    </div>
  )
}

type CollectionsEditorProps = {
  collections: CollectionItem[]
  activeCollection: CollectionItem
  activeTab?: RequestTab
  onSelect: (collectionId: string) => void
  onAdd: () => void
  onDelete: () => void
  onSaveActiveTab: () => void
  onOpenSavedRequest: (collectionId: string, savedRequest: SavedRequestItem) => void
  onDeleteSavedRequest: (collectionId: string, savedRequestId: string) => void
  onChange: (collection: CollectionItem) => void
}

function CollectionsEditor({
  collections,
  activeCollection,
  activeTab,
  onSelect,
  onAdd,
  onDelete,
  onSaveActiveTab,
  onOpenSavedRequest,
  onDeleteSavedRequest,
  onChange,
}: CollectionsEditorProps) {
  return (
    <div className="stack gap-sm">
      <div className="section-heading">
        <h2>Collections</h2>
        <div className="field-actions">
          <button className="ghost-button" type="button" onClick={onAdd}>
            Nova
          </button>
          <button className="danger-button" type="button" onClick={onDelete}>
            Remover
          </button>
        </div>
      </div>

      <label className="field">
        <span>Collection ativa</span>
        <select
          value={activeCollection.id}
          onChange={(event) => onSelect(event.target.value)}
        >
          {collections.map((collection) => (
            <option key={collection.id} value={collection.id}>
              {collection.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Nome da collection</span>
        <input
          type="text"
          value={activeCollection.name}
          onChange={(event) =>
            onChange({
              ...activeCollection,
              name: event.target.value,
            })
          }
        />
      </label>

      <div className="collection-summary">
        <span className="info-pill">
          {activeCollection.requests.length} request
          {activeCollection.requests.length === 1 ? '' : 's'} salva
          {activeCollection.requests.length === 1 ? '' : 's'}
        </span>
        {activeTab && (
          <button className="ghost-button" type="button" onClick={onSaveActiveTab}>
            {activeTab.savedRequestId &&
            activeTab.collectionId === activeCollection.id
              ? 'Atualizar atual'
              : 'Salvar aba atual'}
          </button>
        )}
      </div>

      <div className="saved-requests-list">
        {activeCollection.requests.length === 0 ? (
          <div className="empty-card compact-card">
            Salve a aba atual para criar a primeira request da collection.
          </div>
        ) : (
          activeCollection.requests.map((savedRequest) => (
            <div className="saved-request-card" key={savedRequest.id}>
              <button
                className="saved-request-card__content"
                type="button"
                onClick={() => onOpenSavedRequest(activeCollection.id, savedRequest)}
              >
                <div className="history-item__top">
                  <span
                    className={`method-chip method-chip--${savedRequest.request.method.toLowerCase()}`}
                  >
                    {savedRequest.request.method}
                  </span>
                  <span className="subtle saved-request-date">
                    {formatDate(savedRequest.updatedAt)}
                  </span>
                </div>
                <strong>{savedRequest.name}</strong>
                <span className="saved-request-url" title={savedRequest.request.url}>
                  {savedRequest.request.url || 'URL vazia'}
                </span>
              </button>

              <button
                className="danger-button"
                type="button"
                onClick={() =>
                  onDeleteSavedRequest(activeCollection.id, savedRequest.id)
                }
              >
                Excluir
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

type ImportToolsEditorProps = {
  curlImportText: string
  openApiImportText: string
  feedback: {
    tone: 'success' | 'error'
    message: string
  } | null
  onCurlImportTextChange: (value: string) => void
  onOpenApiImportTextChange: (value: string) => void
  onCurlImport: () => void
  onOpenApiImport: () => void
  onOpenApiFileSelected: (file?: File) => Promise<void>
}

function ImportToolsEditor({
  curlImportText,
  openApiImportText,
  feedback,
  onCurlImportTextChange,
  onOpenApiImportTextChange,
  onCurlImport,
  onOpenApiImport,
  onOpenApiFileSelected,
}: ImportToolsEditorProps) {
  return (
    <div className="stack gap-sm">
      <div className="section-heading">
        <h2>Importacao</h2>
      </div>

      {feedback && (
        <div
          className={`import-feedback import-feedback--${feedback.tone}`}
        >
          {feedback.message}
        </div>
      )}

      <div className="import-block">
        <div>
          <h3>Importar cURL</h3>
          <p className="subtle helper-text">
            Cole um comando cURL para preencher a aba atual.
          </p>
        </div>

        <label className="field">
          <span>Comando cURL</span>
          <textarea
            rows={5}
            placeholder='curl -X GET "https://api.exemplo.com/users" -H "Authorization: Bearer token"'
            value={curlImportText}
            onChange={(event) => onCurlImportTextChange(event.target.value)}
          />
        </label>

        <button className="ghost-button" type="button" onClick={onCurlImport}>
          Importar cURL na aba atual
        </button>
      </div>

      <div className="import-block">
        <div>
          <h3>Importar OpenAPI</h3>
          <p className="subtle helper-text">
            Cole JSON/YAML ou carregue um arquivo para gerar uma nova collection.
          </p>
        </div>

        <label className="field">
          <span>Arquivo da especificacao</span>
          <input
            type="file"
            accept=".json,.yaml,.yml,application/json,text/yaml,text/x-yaml"
            onChange={(event) => void onOpenApiFileSelected(event.target.files?.[0])}
          />
        </label>

        <label className="field">
          <span>Conteudo OpenAPI</span>
          <textarea
            rows={8}
            placeholder="openapi: 3.0.0"
            value={openApiImportText}
            onChange={(event) => onOpenApiImportTextChange(event.target.value)}
          />
        </label>

        <button className="ghost-button" type="button" onClick={onOpenApiImport}>
          Importar OpenAPI em nova collection
        </button>
      </div>
    </div>
  )
}

type EnvironmentVariablesEditorProps = {
  rows: KeyValueRow[]
  onChange: (rows: KeyValueRow[]) => void
}

function EnvironmentVariablesEditor({
  rows,
  onChange,
}: EnvironmentVariablesEditorProps) {
  return (
    <div className="stack gap-sm">
      <div className="section-heading">
        <div>
          <h2>Variaveis</h2>
          <p className="subtle helper-text">
            Defina valores reutilizaveis para trocar de ambiente sem editar a
            request inteira.
          </p>
        </div>
        <button
          className="ghost-button"
          type="button"
          onClick={() => onChange([...rows, createRow()])}
        >
          Adicionar variavel
        </button>
      </div>

      <div className="environment-variables-list">
        {rows.map((row) => {
          const previewName = row.key.trim() || 'nomeDaVariavel'
          const previewValue = row.value.trim() || 'Sem valor definido'

          return (
            <div className="environment-variable-card" key={row.id}>
              <div className="environment-variable-card__header">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(event) =>
                      onChange(
                        rows.map((current) =>
                          current.id === row.id
                            ? { ...current, enabled: event.target.checked }
                            : current,
                        ),
                      )
                    }
                  />
                  <span>{row.enabled ? 'Variavel ativa' : 'Variavel inativa'}</span>
                </label>

                <button
                  className="danger-button"
                  type="button"
                  onClick={() => {
                    const nextRows = rows.filter((current) => current.id !== row.id)
                    onChange(nextRows.length === 0 ? [createRow()] : nextRows)
                  }}
                >
                  Remover
                </button>
              </div>

              <div className="environment-variable-card__fields">
                <label className="field">
                  <span>Nome da variavel</span>
                  <span className="field-preview">
                    Nome atual: <code>{`{{${previewName}}}`}</code>
                  </span>
                  <input
                    type="text"
                    placeholder="ex: baseUrl"
                    value={row.key}
                    onChange={(event) =>
                      onChange(
                        rows.map((current) =>
                          current.id === row.id
                            ? { ...current, key: event.target.value }
                            : current,
                        ),
                      )
                    }
                  />
                </label>

                <label className="field">
                  <span>Valor</span>
                  <span className="field-preview">Valor atual: {previewValue}</span>
                  <input
                    type="text"
                    placeholder="ex: https://api.exemplo.com"
                    value={row.value}
                    onChange={(event) =>
                      onChange(
                        rows.map((current) =>
                          current.id === row.id
                            ? { ...current, value: event.target.value }
                            : current,
                        ),
                      )
                    }
                  />
                </label>
              </div>

              <p className="subtle helper-text">
                Uso na request: <code>{`{{${previewName}}}`}</code>
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function createHistoryEntry(
  tab: RequestTab,
  response: RequestResponse,
  environment: EnvironmentItem | undefined,
  resolvedUrl: string,
): HistoryEntry {
  return {
    id: crypto.randomUUID(),
    executedAt: response.receivedAt,
    method: tab.method,
    url: tab.url,
    resolvedUrl,
    status: response.status,
    durationMs: response.durationMs,
    environmentName: environment?.name,
    tabSnapshot: {
      ...cloneTab(tab),
      response,
    },
  }
}

function createSavedRequestFromTab(
  tab: RequestTab,
  collectionId: string,
  updatedAt: string,
): SavedRequestItem {
  const savedRequestId = tab.savedRequestId ?? crypto.randomUUID()

  return {
    id: savedRequestId,
    name: tab.name.trim() || 'Request sem nome',
    updatedAt,
    request: {
      ...sanitizeTabForSave(tab),
      collectionId,
      savedRequestId,
    },
  }
}

function sanitizeTabForSave(tab: RequestTab): RequestTab {
  return {
    ...cloneTab(tab),
    name: tab.name.trim() || 'Request sem nome',
    response: undefined,
    isSending: false,
    collectionId: tab.collectionId,
    savedRequestId: tab.savedRequestId,
  }
}

function createTabFromSavedRequest(
  savedRequest: SavedRequestItem,
  collectionId: string,
): RequestTab {
  return {
    ...hydrateTab(savedRequest.request),
    id: crypto.randomUUID(),
    name: savedRequest.name,
    response: undefined,
    isSending: false,
    collectionId,
    savedRequestId: savedRequest.id,
  }
}

function hydrateTab(raw: RequestTab): RequestTab {
  return {
    id: raw.id ?? crypto.randomUUID(),
    name: raw.name ?? 'Request',
    method: (raw.method ?? 'GET') as HttpMethod,
    url: raw.url ?? '',
    headers:
      raw.headers?.map((row) => ({
        ...row,
        id: row.id ?? crypto.randomUUID(),
        enabled: row.enabled ?? true,
      })) ?? [createRow()],
    queryParams:
      raw.queryParams?.map((row) => ({
        ...row,
        id: row.id ?? crypto.randomUUID(),
        enabled: row.enabled ?? true,
      })) ?? [createRow()],
    auth: hydrateAuth(raw.auth),
    body: hydrateBody(raw.body),
    response: raw.response,
    isSending: false,
    collectionId: raw.collectionId,
    savedRequestId: raw.savedRequestId,
  }
}

function hydrateHistoryEntry(raw: HistoryEntry): HistoryEntry {
  return {
    ...raw,
    tabSnapshot: hydrateTab(raw.tabSnapshot),
  }
}

function hydrateEnvironment(raw: EnvironmentItem): EnvironmentItem {
  return {
    id: raw.id ?? crypto.randomUUID(),
    name: raw.name ?? 'Environment',
    color: raw.color ?? 'branco',
    variables:
      raw.variables?.map((row) => ({
        ...row,
        id: row.id ?? crypto.randomUUID(),
        enabled: row.enabled ?? true,
      })) ?? [createRow()],
  }
}

function hydrateCollection(raw: CollectionItem): CollectionItem {
  return {
    id: raw.id ?? crypto.randomUUID(),
    name: raw.name ?? 'Collection',
    requests:
      raw.requests?.map((savedRequest) => ({
        id: savedRequest.id ?? crypto.randomUUID(),
        name: savedRequest.name ?? 'Request salva',
        updatedAt: savedRequest.updatedAt ?? new Date().toISOString(),
        request: hydrateTab(savedRequest.request),
      })) ?? [],
  }
}

function hydrateAuth(auth: AuthConfig | undefined): AuthConfig {
  if (!auth) {
    return { type: 'none' }
  }

  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', token: auth.token ?? '' }
    case 'basic':
      return {
        type: 'basic',
        username: auth.username ?? '',
        password: auth.password ?? '',
      }
    case 'apiKey':
      return {
        type: 'apiKey',
        key: auth.key ?? '',
        value: auth.value ?? '',
        addTo: auth.addTo ?? 'header',
      }
    default:
      return { type: 'none' }
  }
}

function hydrateBody(body: RequestBody | undefined): RequestBody {
  if (!body) {
    return { mode: 'none' }
  }

  if (body.mode === 'json' || body.mode === 'text') {
    return {
      mode: body.mode,
      content: body.content ?? '',
    }
  }

  if (body.mode === 'form') {
    return {
      mode: 'form',
      entries:
        body.entries?.map((row) => ({
          ...row,
          id: row.id ?? crypto.randomUUID(),
          enabled: row.enabled ?? true,
        })) ?? [createRow()],
    }
  }

  return { mode: 'none' }
}

function getStatusToneClass(status: number) {
  if (status >= 200 && status < 300) {
    return 'status-pill--success'
  }

  if (status >= 400) {
    return 'status-pill--error'
  }

  return 'status-pill--neutral'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(value))
}

function formatMetric(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 2,
  }).format(value)
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function getEnvironmentColorLabel(color: EnvironmentColor) {
  return (
    ENVIRONMENT_COLOR_OPTIONS.find((option) => option.value === color)?.label ??
    'Branco'
  )
}

export default App
